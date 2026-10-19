import { isVideoId, normalizeTrack } from "@/lib/music/track";
import { runYoutube, youtubeErrorResponse } from "@/lib/server/youtube";
import {
  getMusicRepository,
  optionalPersistence,
} from "@/lib/server/persistent-music";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  if (!isVideoId(videoId))
    return Response.json({ error: "Invalid video ID." }, { status: 400 });
  try {
    const repository = getMusicRepository();
    const stored =
      repository &&
      (await optionalPersistence(() => repository.getSource(videoId)));
    request.signal.throwIfAborted();
    if (stored)
      return Response.json(
        { track: stored },
        { headers: { "Cache-Control": "no-store" } }
      );
    const output = await runYoutube(
      [
        "--dump-single-json",
        "--skip-download",
        "--",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      request.signal
    );
    const track = normalizeTrack(JSON.parse(output));
    if (track && repository)
      await optionalPersistence(() => repository.saveSource(track));
    request.signal.throwIfAborted();
    return Response.json(
      { track },
      { status: track ? 200 : 404, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return youtubeErrorResponse(error);
  }
}
