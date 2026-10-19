import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  fillAudioCache,
  cleanupAudioCache,
} from "../lib/server/audio-cache-worker.ts";
import {
  mediaDescriptor,
  downloadAudio,
} from "../lib/server/audio-cache-media.ts";
import {
  audioCacheConfig,
  audioCacheEnabled,
} from "../lib/server/audio-cache-config.ts";

const bytes = Buffer.from("verified audio fixture");
const checksum = createHash("sha256").update(bytes).digest("hex");
const media = {
  mimeType: "audio/webm",
  codec: "opus",
  container: "webm",
  byteSize: bytes.length,
  duration: 2,
  checksum,
};
const job = {
  id: "job",
  video_id: "dQw4w9WgXcQ",
  audio_asset_id: "asset",
  lease_token: "lease",
  object_key: "audio/test",
  attempt_count: 1,
};
const config = { maxFileBytes: 1000, retentionDays: 30 };

test("cache configuration stays opt-in and bounds byte limits and worker concurrency", () => {
  assert.equal(audioCacheEnabled(), false);
  assert.equal(audioCacheConfig().concurrency, 1);
  process.env.AUDIO_CACHE_WORKER_CONCURRENCY = "5";
  try {
    assert.throws(audioCacheConfig, /AUDIO_CACHE_WORKER_CONCURRENCY/);
  } finally {
    delete process.env.AUDIO_CACHE_WORKER_CONCURRENCY;
  }
  process.env.AUDIO_CACHE_MAX_FILE_BYTES = "9000000000";
  try {
    assert.throws(audioCacheConfig, /AUDIO_CACHE_MAX_FILE_BYTES/);
  } finally {
    delete process.env.AUDIO_CACHE_MAX_FILE_BYTES;
  }
});

test("media inspection uses measured duration and rejects video, unknown codecs, and invalid duration", () => {
  const probe = (codec, format, duration = "2.5", extra = []) =>
    JSON.stringify({
      streams: [{ codec_type: "audio", codec_name: codec }, ...extra],
      format: { format_name: format, duration },
    });
  assert.equal(
    mediaDescriptor(probe("opus", "matroska,webm"), 10, checksum).mimeType,
    "audio/webm"
  );
  assert.equal(
    mediaDescriptor(probe("aac", "mov,mp4,m4a,3gp,3g2,mj2"), 10, checksum)
      .container,
    "mp4"
  );
  assert.equal(
    mediaDescriptor(probe("pcm_s16le", "wav"), 10, checksum).duration,
    2.5
  );
  assert.throws(
    () => mediaDescriptor(probe("h264", "mp4"), 10, checksum),
    /Unsupported/
  );
  assert.throws(
    () =>
      mediaDescriptor(
        probe("opus", "webm", "2", [{ codec_type: "video" }]),
        10,
        checksum
      ),
    /audio-only/
  );
  for (const duration of ["NaN", "Infinity", "0", "-1", "N/A"])
    assert.throws(
      () => mediaDescriptor(probe("opus", "webm", duration), 10, checksum),
      /Invalid measured/
    );
});

function harness(options = {}) {
  const calls = [];
  let file;
  const repository = {
    renew: async () => true,
    publish: async (_job, descriptor) => {
      calls.push("publish");
      assert.deepEqual(descriptor, media);
      return options.publish !== false;
    },
    fail: async () => {
      calls.push("fail");
    },
  };
  const download = async (_video, path) => {
    file = path;
    calls.push("download");
    await writeFile(path, bytes);
    return media;
  };
  const storage = {
    uploadAudioFile: async (_key, path) => {
      calls.push("upload");
      assert.deepEqual(await readFile(path), bytes);
      if (options.uploadFailure) throw new Error("private upstream details");
    },
    headAudio: async () => {
      calls.push("head");
      return {
        ContentLength: options.badSize ? 999 : bytes.length,
        ContentType: media.mimeType,
      };
    },
    getAudio: async () => {
      calls.push("read");
      return {
        Body: Readable.from([
          options.corrupt ? Buffer.alloc(bytes.length) : bytes,
        ]),
      };
    },
  };
  return {
    calls,
    run: (signal = new AbortController().signal) =>
      fillAudioCache(job, repository, config, signal, download, storage),
    file: () => file,
  };
}

test("publication follows successful upload, HEAD, and full checksum read-back; local file is removed", async () => {
  const h = harness();
  assert.equal(await h.run(), true);
  assert.deepEqual(h.calls, ["download", "upload", "head", "read", "publish"]);
  await assert.rejects(access(h.file()), { code: "ENOENT" });
});

for (const [name, options, expected] of [
  [
    "interrupted upload",
    { uploadFailure: true },
    ["download", "upload", "fail"],
  ],
  [
    "incorrect stored size",
    { badSize: true },
    ["download", "upload", "head", "fail"],
  ],
  [
    "corrupted stored content",
    { corrupt: true },
    ["download", "upload", "head", "read", "fail"],
  ],
  [
    "stale publication lease",
    { publish: false },
    ["download", "upload", "head", "read", "publish", "fail"],
  ],
])
  test(`${name} never publishes a ready asset and removes local audio`, async () => {
    const h = harness(options);
    assert.equal(await h.run(), false);
    assert.deepEqual(h.calls, expected);
    await assert.rejects(access(h.file()), { code: "ENOENT" });
  });

test("worker shutdown prevents starting a download", async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  assert.equal(await h.run(controller.signal), false);
  assert.deepEqual(h.calls, ["fail"]);
});

test("failed deletion retains capacity accounting; successful deletion releases it", async () => {
  const forgotten = [];
  const repository = {
    cleanupCandidates: async () => [
      { object_key: "bad" },
      { object_key: "good" },
    ],
    forgetObject: async (key) => forgotten.push(key),
  };
  await cleanupAudioCache(repository, new AbortController().signal, {
    deleteAudio: async (key) => {
      if (key === "bad") throw new Error("offline");
    },
  });
  assert.deepEqual(forgotten, ["good"]);
});

test("upstream downloads enforce actual byte limits, completeness, trusted URLs, cancellation, and measured metadata", async () => {
  const file = join(tmpdir(), `music-cache-${randomUUID()}.audio`);
  const signal = new AbortController().signal;
  const probe = async () =>
    JSON.stringify({
      streams: [{ codec_type: "audio", codec_name: "opus" }],
      format: { format_name: "webm", duration: "2" },
    });
  const providers = (url, response) => ({
    resolve: async () => url,
    fetch: async () => response,
    probe,
  });
  const url = "https://r1.googlevideo.com/audio";
  try {
    const stored = await downloadAudio(
      job.video_id,
      file,
      100,
      signal,
      providers(
        url,
        new Response(bytes, {
          headers: { "Content-Length": String(bytes.length) },
        })
      )
    );
    assert.deepEqual(await readFile(file), bytes);
    assert.equal(stored.checksum, checksum);
    assert.equal(stored.duration, 2);
    await unlink(file);
    await assert.rejects(
      downloadAudio(
        job.video_id,
        file,
        5,
        signal,
        providers(url, new Response(bytes))
      ),
      /exceeds cache/
    );
    await unlink(file).catch(() => {});
    await assert.rejects(
      downloadAudio(
        job.video_id,
        file,
        100,
        signal,
        providers(
          url,
          new Response(bytes, { headers: { "Content-Length": "50" } })
        )
      ),
      /Incomplete/
    );
    await unlink(file);
    for (const bad of [
      "https://googlevideo.com.evil.invalid/a",
      "http://r1.googlevideo.com/a",
      "https://user:password@r1.googlevideo.com/a",
    ])
      await assert.rejects(
        downloadAudio(
          job.video_id,
          file,
          100,
          signal,
          providers(bad, new Response(bytes))
        ),
        /Invalid audio resource/
      );
    await assert.rejects(
      downloadAudio(
        "bad",
        file,
        100,
        signal,
        providers(url, new Response(bytes))
      ),
      /Invalid video ID/
    );
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      downloadAudio(
        job.video_id,
        file,
        100,
        cancelled.signal,
        providers(url, new Response(bytes))
      ),
      { name: "AbortError" }
    );
  } finally {
    await unlink(file).catch(() => {});
  }
});
