import "server-only";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { isVideoId } from "../music/track.ts";
import { AUDIO_PROFILE } from "./music-repository.ts";

export interface CacheClaim {
  id: string;
  audio_asset_id: string;
  video_id: string;
  lease_token: string;
  object_key: string;
  attempt_count: number;
}
export interface AudioDescriptor {
  mimeType: string;
  codec: string;
  container: string;
  byteSize: number;
  duration: number;
  checksum: string;
}

export function createAudioCacheRepository(
  database: Pick<pg.Pool, "query" | "connect">
) {
  async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>) {
    const client = await database.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }

  async function enqueue(videoId: string) {
    if (!isVideoId(videoId)) throw new Error("Invalid video ID.");
    return transaction(async (client) => {
      await client.query(
        `INSERT INTO public.youtube_sources(video_id,canonical_url)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [videoId, `https://www.youtube.com/watch?v=${videoId}`]
      );
      await client.query(
        `INSERT INTO public.audio_assets(video_id,profile_key)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [videoId, AUDIO_PROFILE]
      );
      const asset = await client.query<{
        id: string;
        usable: boolean;
        state: string;
      }>(
        `SELECT id,state,(state='ready' AND (expires_at IS NULL OR expires_at>now())) AS usable
         FROM public.audio_assets WHERE video_id=$1 AND profile_key=$2 FOR UPDATE`,
        [videoId, AUDIO_PROFILE]
      );
      const row = asset.rows[0];
      if (row.usable || row.state === "deleting") return false;
      const job = await client.query(
        `INSERT INTO public.cache_jobs(audio_asset_id)
        SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM public.cache_jobs
          WHERE audio_asset_id=$1 AND (state IN ('queued','running') OR next_attempt_at>now()))
        ON CONFLICT DO NOTHING RETURNING id`,
        [row.id]
      );
      if (!job.rowCount) return false;
      await client.query(
        `UPDATE public.audio_assets SET state='pending',updated_at=now() WHERE id=$1`,
        [row.id]
      );
      return true;
    });
  }

  async function claim(owner: string, maxBytes: number, maxFileBytes: number) {
    return transaction(async (client) => {
      // Serialize capacity reservations across all worker processes.
      await client.query("SELECT pg_advisory_xact_lock(71923501)");
      await client.query(`WITH recovered AS (
        UPDATE public.cache_jobs SET state=CASE WHEN attempt_count>=3 THEN 'failed' ELSE 'queued' END,
          lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
          next_attempt_at=now()+CASE WHEN attempt_count>=3 THEN interval '1 hour' ELSE interval '1 minute' END,
          last_error='Worker lease expired',updated_at=now()
        WHERE state='running' AND lease_expires_at<now() RETURNING audio_asset_id,state)
        UPDATE public.audio_assets a SET state=CASE WHEN r.state='failed' THEN 'failed' ELSE 'pending' END,
          updated_at=now() FROM recovered r WHERE a.id=r.audio_asset_id`);
      const due =
        await client.query<CacheClaim>(`SELECT j.id,j.audio_asset_id,a.video_id,j.attempt_count
        FROM public.cache_jobs j JOIN public.audio_assets a ON a.id=j.audio_asset_id
        WHERE j.state='queued' AND j.next_attempt_at<=now()
        ORDER BY j.next_attempt_at,j.created_at FOR UPDATE OF j,a SKIP LOCKED LIMIT 1`);
      if (!due.rows[0]) return null;
      const usage = await client.query<{ bytes: string }>(
        "SELECT coalesce(sum(byte_size),0) AS bytes FROM public.cache_objects"
      );
      if (Number(usage.rows[0].bytes) + maxFileBytes > maxBytes) {
        // Cleanup deletes the object before its capacity becomes available.
        await client.query(`UPDATE public.audio_assets SET state='deleting',updated_at=now()
          WHERE id=(SELECT a.id FROM public.audio_assets a WHERE a.state='ready'
            AND coalesce(a.last_accessed_at,a.created_at)<now()-interval '10 minutes'
            AND NOT EXISTS (SELECT 1 FROM public.cache_jobs j WHERE j.audio_asset_id=a.id AND j.state IN ('queued','running'))
            ORDER BY a.last_accessed_at NULLS FIRST,a.created_at LIMIT 1 FOR UPDATE SKIP LOCKED)`);
        return null;
      }
      const row = due.rows[0];
      const token = randomUUID();
      const key = `audio/${row.video_id}/${AUDIO_PROFILE}/${token}`;
      await client.query(
        `UPDATE public.cache_jobs SET state='running',attempt_count=attempt_count+1,
        lease_owner=$2,lease_token=$3,lease_expires_at=now()+interval '60 seconds',updated_at=now() WHERE id=$1`,
        [row.id, owner, token]
      );
      await client.query(
        `UPDATE public.audio_assets SET state='downloading',updated_at=now() WHERE id=$1`,
        [row.audio_asset_id]
      );
      await client.query(
        `INSERT INTO public.cache_objects(object_key,audio_asset_id,job_id,lease_token,byte_size)
        VALUES ($1,$2,$3,$4,$5)`,
        [key, row.audio_asset_id, row.id, token, maxFileBytes]
      );
      return {
        ...row,
        lease_token: token,
        object_key: key,
        attempt_count: row.attempt_count + 1,
      };
    });
  }

  async function renew(job: CacheClaim) {
    const result = await database.query(
      `UPDATE public.cache_jobs SET lease_expires_at=now()+interval '60 seconds',updated_at=now()
      WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_expires_at>now()`,
      [job.id, job.lease_token]
    );
    return result.rowCount === 1;
  }

  async function publish(
    job: CacheClaim,
    media: AudioDescriptor,
    retentionDays: number
  ) {
    return transaction(async (client) => {
      const lease = await client.query(
        `SELECT id FROM public.cache_jobs
        WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_expires_at>now() FOR UPDATE`,
        [job.id, job.lease_token]
      );
      if (!lease.rowCount) return false;
      const reservation = await client.query(
        `UPDATE public.cache_objects SET byte_size=$2
        WHERE object_key=$1 AND lease_token=$3 AND byte_size >= $2 RETURNING object_key`,
        [job.object_key, media.byteSize, job.lease_token]
      );
      if (!reservation.rowCount) throw new Error("Invalid cache reservation.");
      await client.query(
        `UPDATE public.audio_assets SET state='ready',object_key=$2,mime_type=$3,
        codec=$4,container=$5,byte_size=$6,duration_seconds=$7,checksum=$8,
        last_accessed_at=now(),expires_at=now()+$9*interval '1 day',updated_at=now() WHERE id=$1`,
        [
          job.audio_asset_id,
          job.object_key,
          media.mimeType,
          media.codec,
          media.container,
          media.byteSize,
          media.duration,
          media.checksum,
          retentionDays,
        ]
      );
      await client.query(
        `UPDATE public.cache_jobs SET state='completed',lease_owner=NULL,lease_token=NULL,
        lease_expires_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1`,
        [job.id]
      );
      return true;
    });
  }

  async function fail(job: CacheClaim) {
    await database.query(
      `WITH failed AS (
      UPDATE public.cache_jobs SET state=CASE WHEN attempt_count>=3 THEN 'failed' ELSE 'queued' END,
        next_attempt_at=now()+CASE WHEN attempt_count>=3 THEN interval '1 hour'
          ELSE attempt_count*interval '30 seconds' END,
        lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error='Audio cache fill failed',updated_at=now()
      WHERE id=$1 AND state='running' AND lease_token=$2 RETURNING audio_asset_id,state)
      UPDATE public.audio_assets a SET state=CASE WHEN f.state='failed' THEN 'failed' ELSE 'pending' END,
        updated_at=now() FROM failed f WHERE a.id=f.audio_asset_id`,
      [job.id, job.lease_token]
    );
  }

  async function cleanupCandidates() {
    await database.query(`UPDATE public.audio_assets SET state='deleting',updated_at=now()
      WHERE state='ready' AND expires_at<=now()
        AND coalesce(last_accessed_at,created_at)<now()-interval '10 minutes'`);
    const result = await database.query<{
      object_key: string;
    }>(`SELECT o.object_key FROM public.cache_objects o
      WHERE o.cleanup_after<=now()
        AND NOT EXISTS (SELECT 1 FROM public.audio_assets a WHERE a.object_key=o.object_key AND a.state='ready')
        AND NOT EXISTS (SELECT 1 FROM public.audio_assets a WHERE a.object_key=o.object_key
          AND coalesce(a.last_accessed_at,a.created_at)>now()-interval '10 minutes')
        AND NOT EXISTS (SELECT 1 FROM public.cache_jobs j WHERE j.id=o.job_id AND j.state='running'
          AND j.lease_token=o.lease_token AND j.lease_expires_at>now())
      ORDER BY o.cleanup_after LIMIT 20`);
    return result.rows;
  }

  async function forgetObject(key: string) {
    await transaction(async (client) => {
      await client.query(
        `UPDATE public.audio_assets SET state='evicted',object_key=NULL,updated_at=now()
        WHERE object_key=$1 AND state='deleting'`,
        [key]
      );
      await client.query(
        "DELETE FROM public.cache_objects WHERE object_key=$1",
        [key]
      );
    });
  }

  return {
    enqueue,
    claim,
    renew,
    publish,
    fail,
    cleanupCandidates,
    forgetObject,
  };
}
export type AudioCacheRepository = ReturnType<
  typeof createAudioCacheRepository
>;
