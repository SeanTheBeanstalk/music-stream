import { isVideoId, normalizeTrack } from "@/lib/music/track";
import { runYoutube, youtubeErrorResponse } from "@/lib/server/youtube";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  if (!isVideoId(videoId))
    return Response.json({ error: "Invalid video ID." }, { status: 400 });
  try {
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
    return Response.json({ track }, { status: track ? 200 : 404 });
  } catch (error) {
    return youtubeErrorResponse(error);
  }
}
