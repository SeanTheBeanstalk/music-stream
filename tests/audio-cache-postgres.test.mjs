import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createAudioCacheRepository } from "../lib/server/audio-cache-repository.ts";
import { createMusicRepository } from "../lib/server/music-repository.ts";

// Isolated database only; apply migrations 0001 and 0002 first.
test(
  "durable fills deduplicate plays, fence stale workers, reserve capacity, retry, publish, and evict",
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async () => {
    const database = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 6,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
    });
    const cache = createAudioCacheRepository(database);
    const music = createMusicRepository(database);
    const ids = Array.from({ length: 3 }, () =>
      randomBytes(8).toString("base64url")
    );
    const media = {
      mimeType: "audio/webm",
      codec: "opus",
      container: "webm",
      byteSize: 100,
      duration: 3,
      checksum: "test-sha256",
    };
    const sql = (query, params) => database.query(query, params);
    const due = (job) =>
      sql(
        "UPDATE public.cache_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
        [job.id]
      );
    try {
      await assert.rejects(cache.enqueue("bad; id"), /Invalid video ID/);
      const enqueued = await Promise.all(
        Array.from({ length: 8 }, () => cache.enqueue(ids[0]))
      );
      assert.equal(enqueued.filter(Boolean).length, 1);
      const claims = await Promise.all([
        cache.claim("one", 1000, 400),
        cache.claim("two", 1000, 400),
      ]);
      assert.equal(claims.filter(Boolean).length, 1);
      const first = claims.find(Boolean);
      assert.equal(await cache.renew(first), true);
      assert.equal(await cache.enqueue(ids[0]), false);
      assert.equal(await music.getReadyAsset(ids[0]), null);
      await sql(
        "UPDATE public.cache_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
        [first.id]
      );
      assert.equal(await cache.renew(first), false);
      assert.equal(await cache.publish(first, media, 30), false);
      assert.equal(await cache.claim("recovery", 1000, 400), null);
      await due(first);
      const second = await cache.claim("recovery", 1000, 400);
      assert.equal(second.id, first.id);
      assert.notEqual(second.lease_token, first.lease_token);
      assert.equal(second.attempt_count, 2);
      // Stale failure cannot disturb a replacement lease.
      await cache.fail(first);
      assert.equal(await cache.renew(second), true);
      assert.equal(await cache.publish(first, media, 30), false);
      assert.equal(await cache.publish(second, media, 30), true);
      assert.equal(
        (await music.getReadyAsset(ids[0])).object_key,
        second.object_key
      );
      assert.equal(await cache.enqueue(ids[0]), false);
      const stored = (
        await sql("SELECT * FROM public.audio_assets WHERE video_id=$1", [
          ids[0],
        ])
      ).rows[0];
      assert.equal(stored.checksum, media.checksum);
      assert.equal(stored.duration_seconds, 3);
      assert.equal(stored.byte_size, "100");
      assert.equal(
        (
          await sql(
            "SELECT state,lease_token FROM public.cache_jobs WHERE id=$1",
            [first.id]
          )
        ).rows[0].state,
        "completed"
      );

      // A live/ready object is never an orphan; an abandoned upload is eventually cleaned.
      await sql(
        "UPDATE public.cache_objects SET cleanup_after=now()-interval '1 second' WHERE audio_asset_id=$1",
        [first.audio_asset_id]
      );
      const orphans = await cache.cleanupCandidates();
      assert.deepEqual(
        orphans.map((row) => row.object_key),
        [first.object_key]
      );
      await cache.forgetObject(first.object_key);

      await cache.enqueue(ids[1]);
      assert.equal(await cache.claim("capacity", 400, 400), null); // 100 ready + 400 reservation exceeds budget
      assert.equal(
        (await music.getReadyAsset(ids[0])).object_key,
        second.object_key
      ); // recent access protected
      await sql(
        "UPDATE public.audio_assets SET last_accessed_at=now()-interval '1 hour' WHERE id=$1",
        [second.audio_asset_id]
      );
      assert.equal(await cache.claim("capacity", 400, 400), null);
      assert.equal(await music.getReadyAsset(ids[0]), null);
      assert.deepEqual(
        (await cache.cleanupCandidates()).map((row) => row.object_key),
        [second.object_key]
      );
      await cache.forgetObject(second.object_key);
      const retry = await cache.claim("capacity", 400, 400);
      assert.equal(retry.video_id, ids[1]);
      await cache.fail(retry);
      assert.equal(await cache.claim("backoff", 10000, 400), null);
      await due(retry);
      const retry2 = await cache.claim("retry", 10000, 400);
      await cache.fail(retry2);
      await due(retry2);
      const retry3 = await cache.claim("retry", 10000, 400);
      await cache.fail(retry3);
      assert.equal(
        (
          await sql(
            "SELECT state,attempt_count,last_error FROM public.cache_jobs WHERE id=$1",
            [retry.id]
          )
        ).rows[0].state,
        "failed"
      );
      assert.equal(await cache.enqueue(ids[1]), false); // terminal cooldown
      await due(retry3);
      assert.equal(await cache.enqueue(ids[1]), true);

      // Two independent sources cannot over-reserve the remaining budget.
      await cache.enqueue(ids[2]);
      const capacity = await Promise.all([
        cache.claim("a", 1600, 400),
        cache.claim("b", 1600, 400),
      ]);
      assert.equal(capacity.filter(Boolean).length, 1); // 3 failed reservations + one new reservation
    } finally {
      const sourceIds = [ids];
      await sql(
        "DELETE FROM public.cache_objects WHERE audio_asset_id IN (SELECT id FROM public.audio_assets WHERE video_id=ANY($1::text[]))",
        sourceIds
      );
      await sql(
        "DELETE FROM public.cache_jobs WHERE audio_asset_id IN (SELECT id FROM public.audio_assets WHERE video_id=ANY($1::text[]))",
        sourceIds
      );
      await sql(
        "DELETE FROM public.audio_assets WHERE video_id=ANY($1::text[])",
        sourceIds
      );
      await sql(
        "DELETE FROM public.youtube_sources WHERE video_id=ANY($1::text[])",
        sourceIds
      );
      await database.end();
    }
  }
);
