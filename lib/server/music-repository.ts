import "server-only";
import type pg from "pg";
import type { CatalogTrack, Storefront } from "../music/catalog.ts";
import { normalizeTrack, type Track } from "../music/track.ts";

export const AUDIO_PROFILE = "original-audio-v1";
export interface ReadyAsset {
  id: string;
  object_key: string;
  mime_type: string;
  byte_size: string;
}

// Only server-normalized provider metadata enters these methods, never request JSON.
export function createMusicRepository(
  database: Pick<pg.Pool, "query" | "connect">
) {
  async function saveCatalog(track: CatalogTrack) {
    await database.query(
      `INSERT INTO public.catalog_tracks
        (provider, provider_track_id, storefront, title, artist_id, artist_name,
         album_id, album_name, duration_ms, artwork_url, store_url, metadata, fetched_at, refresh_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now() + interval '24 hours')
       ON CONFLICT (provider, provider_track_id, storefront) DO UPDATE SET
         title=EXCLUDED.title, artist_id=EXCLUDED.artist_id, artist_name=EXCLUDED.artist_name,
         album_id=EXCLUDED.album_id, album_name=EXCLUDED.album_name, duration_ms=EXCLUDED.duration_ms,
         artwork_url=EXCLUDED.artwork_url, store_url=EXCLUDED.store_url, metadata=EXCLUDED.metadata,
         fetched_at=EXCLUDED.fetched_at, refresh_after=EXCLUDED.refresh_after`,
      [
        track.provider,
        String(track.trackId),
        track.country,
        track.title,
        track.artist.id,
        track.artist.name,
        track.album.id,
        track.album.name,
        track.duration === null
          ? null
          : Math.min(2147483647, Math.round(track.duration * 1000)),
        track.artwork,
        track.storeUrl,
        JSON.stringify(track),
      ]
    );
  }

  async function getCatalog(id: number, country: Storefront, fresh = true) {
    const result = await database.query<{ metadata: CatalogTrack }>(
      `SELECT metadata FROM public.catalog_tracks
       WHERE provider='itunes' AND provider_track_id=$1 AND storefront=$2
         AND (NOT $3::boolean OR refresh_after > now())`,
      [String(id), country, fresh]
    );
    return result.rows[0]?.metadata ?? null;
  }

  async function saveSource(
    track: Track,
    queryable: Pick<pg.Pool, "query"> = database
  ) {
    await queryable.query(
      `INSERT INTO public.youtube_sources
        (video_id, canonical_url, upload_title, uploader, duration_seconds, metadata_fetched_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (video_id) DO UPDATE SET upload_title=EXCLUDED.upload_title,
         uploader=EXCLUDED.uploader, duration_seconds=EXCLUDED.duration_seconds,
         metadata_fetched_at=EXCLUDED.metadata_fetched_at`,
      [
        track.id,
        `https://www.youtube.com/watch?v=${track.id}`,
        track.title,
        track.uploader,
        track.duration,
      ]
    );
  }

  const sourceFields = `s.video_id AS id, s.upload_title AS title, s.uploader, s.duration_seconds AS duration`;
  async function getSource(videoId: string) {
    const result = await database.query(
      `SELECT ${sourceFields} FROM public.youtube_sources s
       WHERE s.video_id=$1 AND s.metadata_fetched_at > now() - interval '24 hours'`,
      [videoId]
    );
    return normalizeTrack(result.rows[0]);
  }
  async function getMapping(id: number, country: Storefront) {
    const result = await database.query(
      `SELECT ${sourceFields} FROM public.track_sources t
       JOIN public.catalog_tracks c ON c.id=t.catalog_track_id
       JOIN public.youtube_sources s ON s.video_id=t.video_id
       WHERE c.provider='itunes' AND c.provider_track_id=$1 AND c.storefront=$2 AND t.is_selected`,
      [String(id), country]
    );
    return normalizeTrack(result.rows[0]);
  }

  async function selectSource(catalog: CatalogTrack, source: Track) {
    const client = await database.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      // Serialize selections across app instances; an existing mapping always wins.
      const result = await client.query<{ id: string }>(
        `SELECT id FROM public.catalog_tracks WHERE provider=$1 AND provider_track_id=$2
         AND storefront=$3 FOR UPDATE`,
        [catalog.provider, String(catalog.trackId), catalog.country]
      );
      if (!result.rows[0])
        throw new Error("Catalog metadata must be saved before matching.");
      const selected = await client.query(
        `SELECT ${sourceFields} FROM public.track_sources t
         JOIN public.youtube_sources s ON s.video_id=t.video_id
         WHERE t.catalog_track_id=$1 AND t.is_selected`,
        [result.rows[0].id]
      );
      const existing = normalizeTrack(selected.rows[0]);
      if (!existing) {
        await saveSource(source, client);
        await client.query(
          `INSERT INTO public.track_sources (catalog_track_id,video_id,is_selected,selected_at,match_evidence)
           VALUES ($1,$2,true,now(),$3)
           ON CONFLICT (catalog_track_id,video_id) DO UPDATE SET is_selected=true,
             selected_at=EXCLUDED.selected_at, match_evidence=EXCLUDED.match_evidence`,
          [
            result.rows[0].id,
            source.id,
            JSON.stringify({
              method: "title-artist-v1",
              title: source.title,
              uploader: source.uploader,
            }),
          ]
        );
      }
      await client.query("COMMIT");
      return existing ?? source;
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

  async function getReadyAsset(videoId: string) {
    const result = await database.query<ReadyAsset>(
      `SELECT id,object_key,mime_type,byte_size FROM public.audio_assets
       WHERE video_id=$1 AND profile_key=$2 AND state='ready'
         AND (expires_at IS NULL OR expires_at > now())`,
      [videoId, AUDIO_PROFILE]
    );
    return result.rows[0] ?? null;
  }
  async function touchAsset(asset: ReadyAsset) {
    await database.query(
      `UPDATE public.audio_assets SET last_accessed_at=now()
       WHERE id=$1 AND object_key=$2 AND state='ready'
         AND (last_accessed_at IS NULL OR last_accessed_at < now() - interval '5 minutes')`,
      [asset.id, asset.object_key]
    );
  }
  async function invalidateAsset(asset: ReadyAsset) {
    await database.query(
      `UPDATE public.audio_assets SET state='evicted',updated_at=now()
       WHERE id=$1 AND object_key=$2 AND state='ready'`,
      [asset.id, asset.object_key]
    );
  }
  return {
    saveCatalog,
    getCatalog,
    saveSource,
    getSource,
    getMapping,
    selectSource,
    getReadyAsset,
    touchAsset,
    invalidateAsset,
  };
}
export type MusicRepository = ReturnType<typeof createMusicRepository>;
