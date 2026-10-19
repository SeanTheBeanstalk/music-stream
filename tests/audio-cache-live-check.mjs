// Explicit live check: isolated migrated Postgres + a short generated WAV in R2.
// Never downloads third-party content or modifies existing application assets.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
import pg from "pg";
import { createAudioCacheRepository } from "../lib/server/audio-cache-repository.ts";
import { createMusicRepository } from "../lib/server/music-repository.ts";
import { fillAudioCache } from "../lib/server/audio-cache-worker.ts";
import { probeFile, mediaDescriptor } from "../lib/server/audio-cache-media.ts";
import { cachedPlayback } from "../lib/server/cached-playback.ts";
import { deleteAudio, headAudio } from "../lib/server/storage.ts";
import { getR2Client } from "../lib/server/r2.ts";

if (!process.env.TEST_DATABASE_URL)
  throw new Error("An isolated TEST_DATABASE_URL is required.");
const database = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 3000,
});
const repository = createAudioCacheRepository(database);
const music = createMusicRepository(database);
const videoId = randomBytes(8).toString("base64url");
let job;
let localFile;
try {
  const pcm = Buffer.alloc(16000 * 2 * 3);
  for (let index = 0; index < pcm.length / 2; index++)
    pcm.writeInt16LE(
      Math.round(3000 * Math.sin((2 * Math.PI * 440 * index) / 16000)),
      index * 2
    );
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  const wav = Buffer.concat([header, pcm]);
  const checksum = createHash("sha256").update(wav).digest("hex");
  assert.equal(await repository.enqueue(videoId), true);
  job = await repository.claim("live-verification", 8_000_000_000, 1_000_000);
  assert.equal(job.video_id, videoId);
  const download = async (_id, file, _limit, signal) => {
    localFile = file;
    await writeFile(file, wav);
    return mediaDescriptor(await probeFile(file, signal), wav.length, checksum);
  };
  const success = await fillAudioCache(
    job,
    repository,
    { maxFileBytes: 1_000_000, retentionDays: 1 },
    new AbortController().signal,
    download
  );
  assert.equal(
    success,
    true,
    "Worker must upload, verify, and publish generated audio"
  );
  const asset = await music.getReadyAsset(videoId);
  assert.equal(asset.object_key, job.object_key);
  console.log(
    "PASS real ffprobe inspection, streaming R2 upload, HEAD, full SHA-256 read-back, and Postgres ready publication"
  );
  const full = await cachedPlayback(
    new Request("https://test.invalid/stream"),
    videoId,
    music
  );
  assert.equal(full.status, 200);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), wav);
  const range = await cachedPlayback(
    new Request("https://test.invalid/stream", {
      headers: { Range: "bytes=100-199" },
    }),
    videoId,
    music
  );
  assert.equal(range.status, 206);
  assert.deepEqual(
    Buffer.from(await range.arrayBuffer()),
    wav.subarray(100, 200)
  );
  assert.equal(await repository.enqueue(videoId), false);
  await assert.rejects(access(localFile), { code: "ENOENT" });
  console.log(
    "PASS full and ranged private playback from the published asset, duplicate-play suppression, and local file cleanup"
  );
} catch (error) {
  console.error(
    `FAIL live audio cache check (${error instanceof Error ? error.name : "unknown error"}).`
  );
  process.exitCode = 1;
} finally {
  try {
    const objects = await database.query(
      "SELECT object_key FROM public.cache_objects WHERE audio_asset_id IN (SELECT id FROM public.audio_assets WHERE video_id=$1)",
      [videoId]
    );
    for (const { object_key: key } of objects.rows) {
      await deleteAudio(key);
      await assert.rejects(
        headAudio(key),
        (error) => error.$metadata?.httpStatusCode === 404
      );
    }
    await database.query(
      "DELETE FROM public.cache_objects WHERE audio_asset_id IN (SELECT id FROM public.audio_assets WHERE video_id=$1)",
      [videoId]
    );
    await database.query(
      "DELETE FROM public.cache_jobs WHERE audio_asset_id IN (SELECT id FROM public.audio_assets WHERE video_id=$1)",
      [videoId]
    );
    await database.query("DELETE FROM public.audio_assets WHERE video_id=$1", [
      videoId,
    ]);
    await database.query(
      "DELETE FROM public.youtube_sources WHERE video_id=$1",
      [videoId]
    );
    console.log("PASS temporary R2 object and database fixtures removed");
  } catch {
    console.error(
      "FAIL live fixture cleanup; rerun cleanup before continuing."
    );
    process.exitCode = 1;
  }
  await database.end();
  getR2Client().destroy();
}
