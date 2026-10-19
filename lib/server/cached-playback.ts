import "server-only";
import { Readable } from "node:stream";
import { getAudio } from "./storage.ts";
import type { MusicRepository } from "./music-repository.ts";
import { optionalPersistence } from "./persistent-music.ts";

export function r2PlaybackEnabled() {
  return process.env.R2_PLAYBACK_ENABLED === "true";
}

// A null result asks the stream route to use its existing YouTube proxy.
export async function cachedPlayback(
  request: Request,
  videoId: string,
  repository: MusicRepository | null,
  read = getAudio
): Promise<Response | null> {
  if (!repository) return null;
  request.signal.throwIfAborted();
  const asset = await optionalPersistence(() =>
    repository.getReadyAsset(videoId)
  );
  request.signal.throwIfAborted();
  if (!asset) return null;
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const cleanup = () => request.signal.removeEventListener("abort", abort);
  const range = request.headers.get("range") ?? undefined;
  try {
    const object = await read(asset.object_key, {
      range,
      signal: controller.signal,
    });
    if (!object.Body) throw new Error("Empty cached audio response.");
    // R2's Node response is a Readable. toWeb propagates consumer cancellation
    // back to the SDK body without buffering a whole song in the app server.
    const body = object.Body as Readable;
    const stream = (
      Readable.toWeb(body) as ReadableStream<Uint8Array>
    ).getReader();
    const responseBody = new ReadableStream<Uint8Array>({
      async pull(target) {
        try {
          const next = await stream.read();
          if (next.done) {
            cleanup();
            target.close();
          } else target.enqueue(next.value);
        } catch (error) {
          cleanup();
          controller.abort();
          target.error(error);
        }
      },
      async cancel(reason) {
        cleanup();
        controller.abort();
        await stream.cancel(reason);
      },
    });
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
      "Content-Type": asset.mime_type,
    });
    if (object.ContentLength !== undefined)
      headers.set("Content-Length", String(object.ContentLength));
    if (object.ContentRange) headers.set("Content-Range", object.ContentRange);
    // Access accounting is best effort and throttled in SQL. It cannot delay audio.
    void optionalPersistence(() => repository.touchAsset(asset));
    return new Response(responseBody, {
      status: object.ContentRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    cleanup();
    controller.abort();
    request.signal.throwIfAborted();
    const failure = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    if (
      failure.$metadata?.httpStatusCode === 416 ||
      failure.name === "InvalidRange"
    ) {
      return new Response(null, {
        status: 416,
        headers: {
          "Cache-Control": "no-store",
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${asset.byte_size}`,
        },
      });
    }
    if (
      failure.$metadata?.httpStatusCode === 404 ||
      failure.name === "NoSuchKey"
    )
      await optionalPersistence(() => repository.invalidateAsset(asset));
    // Do not evict on transient network, credentials, or service failures.
    return null;
  }
}
