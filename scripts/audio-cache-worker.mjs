import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { getDatabase } from "../lib/server/database.ts";
import { getR2Client, getR2Bucket } from "../lib/server/r2.ts";
import {
  audioCacheEnabled,
  audioCacheConfig,
} from "../lib/server/audio-cache-config.ts";
import { createAudioCacheRepository } from "../lib/server/audio-cache-repository.ts";
import {
  fillAudioCache,
  cleanupAudioCache,
  cleanupAudioCacheTempFiles,
} from "../lib/server/audio-cache-worker.ts";

const shutdown = new AbortController();
process.on("SIGINT", () => shutdown.abort());
process.on("SIGTERM", () => shutdown.abort());
let database;
let storageClient;
try {
  if (!audioCacheEnabled())
    throw new Error("Set AUDIO_CACHE_ENABLED=true to run the worker.");
  const config = audioCacheConfig();
  for (const [executable, name] of [
    [process.env.FFPROBE_PATH || "ffprobe", "ffprobe"],
    [process.env.YT_DLP_PATH || "yt-dlp", "yt-dlp"],
  ]) {
    const check = spawnSync(
      executable,
      [name === "ffprobe" ? "-version" : "--version"],
      {
        shell: false,
        windowsHide: true,
        timeout: 10_000,
        stdio: "ignore",
      }
    );
    if (check.error || check.status !== 0)
      throw new Error(
        `${name} is unavailable. Configure its executable path before starting the worker.`
      );
  }
  database = getDatabase();
  if (!database) throw new Error("DATABASE_URL is required.");
  getR2Bucket();
  storageClient = getR2Client();
  await cleanupAudioCacheTempFiles();
  const repository = createAudioCacheRepository(database);
  const owner = `${hostname()}:${process.pid}:${randomUUID()}`;
  const once = process.argv.includes("--once");
  async function runLane(index) {
    do {
      try {
        if (index === 0) await cleanupAudioCache(repository, shutdown.signal);
        if (shutdown.signal.aborted) break;
        const job = await repository.claim(
          owner,
          config.maxBytes,
          config.maxFileBytes
        );
        if (job) {
          const completed = await fillAudioCache(
            job,
            repository,
            config,
            shutdown.signal
          );
          console.log(
            completed
              ? "Audio cache job completed."
              : "Audio cache job scheduled for retry or failed."
          );
        } else if (!once)
          await delay(3000, undefined, { signal: shutdown.signal });
      } catch {
        if (!shutdown.signal.aborted) {
          console.warn("Audio cache worker operation failed.");
          if (once) throw new Error("Worker pass failed.");
          await delay(3000, undefined, { signal: shutdown.signal }).catch(
            () => {}
          );
        }
      }
    } while (!once && !shutdown.signal.aborted);
  }
  console.log(`Audio cache worker started (${config.concurrency} lanes).`);
  const lanes = await Promise.allSettled(
    Array.from({ length: config.concurrency }, (_, index) => runLane(index))
  );
  if (lanes.some((result) => result.status === "rejected"))
    process.exitCode = 1;
} catch (error) {
  console.error(
    error instanceof Error && error.name === "Error"
      ? error.message
      : "Audio cache worker failed."
  );
  process.exitCode = 1;
} finally {
  shutdown.abort();
  await database?.end();
  storageClient?.destroy();
}
