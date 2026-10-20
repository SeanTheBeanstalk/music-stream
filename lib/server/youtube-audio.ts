import { setTimeout as delay } from "node:timers/promises";
import { isVideoId } from "../music/track.ts";
import { runYoutube, YoutubeError } from "./youtube.ts";

// Extracting a URL does not honor yt-dlp's downloader availability wait.
export async function resolveYoutubeAudio(
  videoId: string,
  signal: AbortSignal,
  runner = runYoutube
) {
  if (!isVideoId(videoId)) throw new YoutubeError("Invalid video ID.", 400);
  try {
    signal.throwIfAborted();
    const output = await runner(
      [
        "--dump-single-json",
        "-f",
        "bestaudio",
        "--",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      signal
    );
    signal.throwIfAborted();
    const data = JSON.parse(output);
    const url = new URL(data.url);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".googlevideo.com") ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      throw new YoutubeError("Invalid audio resource.");

    const headers = new Headers();
    // Forward playback headers, never arbitrary upstream-controlled headers.
    for (const [name, value] of Object.entries(data.http_headers ?? {})) {
      if (
        /^(user-agent|accept|accept-language|origin|referer|sec-fetch-mode)$/i.test(
          name
        ) &&
        typeof value === "string"
      )
        headers.set(name, value);
    }

    if (data.available_at !== undefined && data.available_at !== null) {
      if (
        typeof data.available_at !== "number" ||
        !Number.isFinite(data.available_at)
      )
        throw new YoutubeError("Invalid audio availability time.");
      const waitMs = Math.ceil(data.available_at * 1000 - Date.now());
      if (waitMs > 30_000)
        throw new YoutubeError(
          "Audio is not ready yet. Try playing this track shortly.",
          504
        );
      if (waitMs > 0) await delay(waitMs, undefined, { signal });
    }
    signal.throwIfAborted();
    return { url, headers };
  } catch (error) {
    if (signal.aborted) throw new YoutubeError("Request cancelled.", 499);
    if (error instanceof YoutubeError) throw error;
    throw new YoutubeError("YouTube returned an invalid audio response.");
  }
}
