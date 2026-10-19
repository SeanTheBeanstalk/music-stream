import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isVideoId } from "../music/track.ts";
import { runYoutube } from "./youtube.ts";
import type { AudioDescriptor } from "./audio-cache-repository.ts";

export function probeFile(file: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.FFPROBE_PATH || "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        file,
      ],
      { shell: false, windowsHide: true }
    );
    let bytes = 0;
    const chunks: Buffer[] = [];
    let failed = false;
    const stop = () => {
      failed = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(stop, 30_000);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) stop();
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) stop();
    });
    child.on("error", () => {
      failed = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (failed || code !== 0)
        reject(
          new Error("Audio inspection failed. Check ffprobe installation.")
        );
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

export function mediaDescriptor(
  probe: string,
  byteSize: number,
  checksum: string
): AudioDescriptor {
  const data = JSON.parse(probe) as {
    streams?: { codec_type?: string; codec_name?: string; duration?: string }[];
    format?: { format_name?: string; duration?: string };
  };
  const streams = data.streams ?? [];
  const audio = streams.filter((stream) => stream.codec_type === "audio");
  if (
    audio.length !== 1 ||
    streams.some((stream) => stream.codec_type !== "audio")
  )
    throw new Error("Expected an audio-only resource.");
  const codec = audio[0].codec_name;
  const formats = data.format?.format_name?.split(",") ?? [];
  let container: string;
  let mimeType: string;
  if (formats.includes("webm") && (codec === "opus" || codec === "vorbis")) {
    container = "webm";
    mimeType = "audio/webm";
  } else if (formats.includes("mp4") && (codec === "aac" || codec === "alac")) {
    container = "mp4";
    mimeType = "audio/mp4";
  } else if (
    formats.includes("ogg") &&
    (codec === "opus" || codec === "vorbis")
  ) {
    container = "ogg";
    mimeType = "audio/ogg";
  } else if (formats.includes("mp3") && codec === "mp3") {
    container = "mp3";
    mimeType = "audio/mpeg";
  } else if (formats.includes("wav") && codec?.startsWith("pcm_")) {
    container = "wav";
    mimeType = "audio/wav";
  } else throw new Error("Unsupported audio format.");
  const duration = Number(data.format?.duration ?? audio[0].duration);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isSafeInteger(byteSize) ||
    byteSize <= 0
  )
    throw new Error("Invalid measured audio properties.");
  return { codec: codec!, container, mimeType, byteSize, duration, checksum };
}

// Separate bounded download: the listener's request and cancellation never own this work.
export async function downloadAudio(
  videoId: string,
  file: string,
  maxBytes: number,
  signal: AbortSignal,
  providers = { resolve: runYoutube, fetch: globalThis.fetch, probe: probeFile }
) {
  if (!isVideoId(videoId)) throw new Error("Invalid video ID.");
  const output = await providers.resolve(
    [
      "--get-url",
      "-f",
      "bestaudio",
      "--",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    signal
  );
  const url = new URL(output.trim());
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".googlevideo.com") ||
    url.username ||
    url.password
  )
    throw new Error("Invalid audio resource.");
  const upstream = await providers.fetch(url, {
    signal,
    redirect: "error",
    cache: "no-store",
  });
  if (upstream.status !== 200 || !upstream.body) {
    await upstream.body?.cancel();
    throw new Error("Audio download unavailable.");
  }
  const expected = upstream.headers.get("content-length");
  if (expected && (!/^\d+$/.test(expected) || Number(expected) > maxBytes)) {
    await upstream.body.cancel();
    throw new Error("Audio exceeds cache file limit.");
  }
  let byteSize = 0;
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > maxBytes)
        callback(new Error("Audio exceeds cache file limit."));
      else {
        hash.update(chunk);
        callback(null, chunk);
      }
    },
  });
  await pipeline(
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream),
    meter,
    createWriteStream(file, { flags: "wx" }),
    { signal }
  );
  if (expected && byteSize !== Number(expected))
    throw new Error("Incomplete audio download.");
  return mediaDescriptor(
    await providers.probe(file, signal),
    byteSize,
    hash.digest("hex")
  );
}
