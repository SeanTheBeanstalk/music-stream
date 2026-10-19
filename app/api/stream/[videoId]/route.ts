import { isVideoId } from "@/lib/music/track";
import {
  cachedPlayback,
  r2PlaybackEnabled,
} from "@/lib/server/cached-playback";
import { getMusicRepository } from "@/lib/server/persistent-music";
import {
  runYoutube,
  YoutubeError,
  youtubeErrorResponse,
} from "@/lib/server/youtube";
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
    if (r2PlaybackEnabled()) {
      const cached = await cachedPlayback(
        request,
        videoId,
        getMusicRepository()
      );
      if (cached) return cached;
    }
    // Proxy byte ranges from the audio resource to support browser seeking.
    const output = await runYoutube(
      [
        "--get-url",
        "-f",
        // Use yt-dlp's quality ranking across containers instead of forcing M4A.
        "bestaudio",
        "--",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      request.signal
    );
    const url = new URL(output.trim());
    if (url.protocol !== "https:" || !url.hostname.endsWith(".googlevideo.com"))
      throw new YoutubeError("Invalid audio resource.");
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(120_000),
    ]);
    const headers = new Headers();
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
