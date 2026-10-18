import { MAX_QUERY_LENGTH, normalizeTrack } from "@/lib/music/track";
import { runYoutube, youtubeErrorResponse } from "@/lib/server/youtube";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (
    !query ||
    query.length > MAX_QUERY_LENGTH ||
    /[\x00-\x1f\x7f]/.test(query)
  )
    return Response.json(
      { error: `Enter a search between 1 and ${MAX_QUERY_LENGTH} characters.` },
      { status: 400 }
    );
  try {
    const output = await runYoutube(
      [
        "--dump-single-json",
        "--skip-download",
        "--flat-playlist",
        "--",
        `ytsearch1:${query}`,
      ],
      request.signal
    );
    return Response.json(
      { track: normalizeTrack(JSON.parse(output)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return youtubeErrorResponse(error);
  }
}
