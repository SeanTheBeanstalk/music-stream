import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { readdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { downloadAudio } from "./audio-cache-media.ts";
import {
  uploadAudioFile,
  headAudio,
  getAudio,
  deleteAudio,
} from "./storage.ts";
import type {
  AudioCacheRepository,
  CacheClaim,
} from "./audio-cache-repository.ts";

const defaultStorage = { uploadAudioFile, headAudio, getAudio, deleteAudio };

export async function fillAudioCache(
  job: CacheClaim,
  repository: AudioCacheRepository,
  config: { maxFileBytes: number; retentionDays: number },
  shutdown: AbortSignal,
  download = downloadAudio,
  storage = defaultStorage
) {
  const controller = new AbortController();
  const signal = AbortSignal.any([
    shutdown,
    controller.signal,
    AbortSignal.timeout(10 * 60_000),
  ]);
  const file = join(tmpdir(), `music-cache-${randomUUID()}.audio`);
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      if (!(await repository.renew(job))) controller.abort();
    } catch {
      controller.abort();
    } finally {
      renewing = false;
    }
  }, 15_000);
  try {
    signal.throwIfAborted();
    const media = await download(
      job.video_id,
      file,
      config.maxFileBytes,
      signal
    );
    if (media.byteSize > config.maxFileBytes)
      throw new Error("Audio exceeds reservation.");
    await storage.uploadAudioFile(
      job.object_key,
      file,
      media.byteSize,
      media.mimeType,
      signal
    );
    const head = await storage.headAudio(job.object_key, signal);
    if (
      head.ContentLength !== media.byteSize ||
      head.ContentType !== media.mimeType
    )
      throw new Error("Uploaded audio descriptors differ.");
    // Verify a full read-back hash. R2 ETags are not a general SHA-256 checksum.
    const object = await storage.getAudio(job.object_key, { signal });
    if (!object.Body) throw new Error("Uploaded audio is unreadable.");
    const body = object.Body as Readable;
    const abortRead = () =>
      body.destroy(new Error("Audio cache read cancelled."));
    signal.addEventListener("abort", abortRead, { once: true });
    if (signal.aborted) abortRead();
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of body) {
        signal.throwIfAborted();
        bytes += chunk.length;
        if (bytes > media.byteSize)
          throw new Error("Uploaded audio exceeds expected size.");
        hash.update(chunk);
      }
    } finally {
      signal.removeEventListener("abort", abortRead);
      body.destroy();
    }
    if (bytes !== media.byteSize || hash.digest("hex") !== media.checksum)
      throw new Error("Uploaded audio checksum differs.");
    signal.throwIfAborted();
    if (!(await repository.publish(job, media, config.retentionDays)))
      throw new Error("Cache lease lost.");
    return true;
  } catch {
    // Never log upstream URLs, SDK errors, credentials, or subprocess output.
    console.warn(
      "Audio cache fill failed; playback remains available from the source."
    );
    await repository.fail(job);
    return false;
  } finally {
    clearInterval(heartbeat);
    controller.abort();
    await unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT")
        console.warn("Audio cache temporary file cleanup failed.");
    });
  }
}

// Recover local files left behind by a killed worker. Never recurse or remove
// unrelated files; active jobs have an absolute ten-minute deadline.
export async function cleanupAudioCacheTempFiles() {
  for (const name of await readdir(tmpdir())) {
    if (!/^music-cache-[a-f0-9-]{36}\.audio$/.test(name)) continue;
    const file = join(tmpdir(), name);
    try {
      const info = await stat(file);
      if (info.isFile() && info.mtimeMs < Date.now() - 20 * 60_000)
        await unlink(file);
    } catch {
      /* Another worker may have cleaned the file. */
    }
  }
}

export async function cleanupAudioCache(
  repository: AudioCacheRepository,
  signal: AbortSignal,
  storage = defaultStorage
) {
  for (const object of await repository.cleanupCandidates()) {
    signal.throwIfAborted();
    try {
      await storage.deleteAudio(object.object_key, signal);
      await repository.forgetObject(object.object_key);
    } catch {
      // Keep the reservation and retry on a later pass, including ambiguous deletes.
      console.warn("Audio cache object cleanup will retry.");
    }
  }
}
