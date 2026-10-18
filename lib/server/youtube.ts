import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
export class YoutubeError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}
let active = 0;
const MAX_OUTPUT = 2 * 1024 * 1024;
// Used only by Node route handlers. Arguments never pass through a shell.
export async function runYoutube(
  args: string[],
  signal: AbortSignal
): Promise<string> {
  if (signal.aborted) throw new YoutubeError("Request cancelled.", 499);
  if (active >= 4)
    throw new YoutubeError("Search is busy. Try again shortly.", 503);
  active++;
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(
        /* turbopackIgnore: true */
        process.env.YT_DLP_PATH || "yt-dlp",
        [
          "--ignore-config",
          "--no-playlist",
          "--no-warnings",
          "--socket-timeout",
          "10",
          "--retries",
          "1",
          ...args,
        ],
        { windowsHide: true, shell: false }
      );
      let output = "";
      const decoder = new StringDecoder("utf8");
      let bytes = 0;
      let failure: Error | undefined;
      const stop = (error: Error) => {
        failure ??= error;
        child.kill("SIGKILL");
      };
      const cancel = () => stop(new YoutubeError("Request cancelled.", 499));
      const timer = setTimeout(
        () =>
          stop(
            new YoutubeError(
              "YouTube took too long to respond. Try again.",
              504
            )
          ),
        30_000
      );
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT)
          stop(new YoutubeError("YouTube returned too much data."));
        else output += decoder.write(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT)
          stop(new YoutubeError("YouTube returned too much data."));
      });
      child.on("error", () => {
        failure ??= new YoutubeError(
          "YouTube service is unavailable. Check the server's yt-dlp installation.",
          503
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        if (failure) reject(failure);
        else if (code !== 0)
          reject(
            new YoutubeError(
              "This track is unavailable or YouTube could not be reached."
            )
          );
        else resolve(output + decoder.end());
      });
    });
  } finally {
    active--;
  }
}
export function youtubeErrorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof YoutubeError
          ? error.message
          : "YouTube returned an unexpected response. Try again.",
    },
    {
      status: error instanceof YoutubeError ? error.status : 502,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
