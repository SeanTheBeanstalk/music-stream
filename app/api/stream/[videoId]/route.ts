import { isVideoId } from "@/lib/music/track";
import { enqueueAudioCache } from "@/lib/server/enqueue-audio-cache";
import { audioCacheEnabled } from "@/lib/server/audio-cache-config";
import {
  cachedPlayback,
  r2PlaybackEnabled,
} from "@/lib/server/cached-playback";
import { getMusicRepository } from "@/lib/server/persistent-music";
import { resolveYoutubeAudio } from "@/lib/server/youtube-audio";
import { YoutubeError, youtubeErrorResponse } from "@/lib/server/youtube";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  if (!isVideoId(videoId))
    return Response.json({ error: "Invalid video ID." }, { status: 400 });
  const range = request.headers.get("range");
  if (range && (!/^bytes=\d*-\d*$/.test(range) || range === "bytes=-"))
    return new Response(null, { status: 416 });
  try {
    if (r2PlaybackEnabled() || audioCacheEnabled()) {
      const cached = await cachedPlayback(
        request,
        videoId,
        getMusicRepository()
      );
      if (cached) return cached;
    }
    // Proxy byte ranges from the audio resource to support browser seeking.
    const { url, headers } = await resolveYoutubeAudio(videoId, request.signal);
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(120_000),
    ]);
    if (range) {
      headers.set("Range", range);
    }
    const upstream = await fetch(url, {
      headers,
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!upstream.ok && upstream.status !== 416) {
      await upstream.body?.cancel();
      throw new YoutubeError(
        "Audio is unavailable. Try playing this track again."
      );
    }
    if (upstream.ok && !request.signal.aborted) {
      // Persist the job before returning the stream; an independent process owns
      // downloading/uploading, including after navigation or listener disconnect.
      await enqueueAudioCache(videoId);
    }
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return youtubeErrorResponse(error);
  }
}
