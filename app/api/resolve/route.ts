import { catalogId } from "@/lib/music/catalog";
import type { Track } from "@/lib/music/track";
import {
  createPersistentMusic,
  getMusicRepository,
} from "@/lib/server/persistent-music";
import {
  CatalogError,
  catalogErrorResponse,
  requestCountry,
} from "@/lib/server/itunes";
import { createRequestCache } from "@/lib/server/request-cache";
import { YoutubeError, youtubeErrorResponse } from "@/lib/server/youtube";
export const runtime = "nodejs";
const resolved = createRequestCache<Track>(100, 900_000);
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const raw = params.get("id") ?? "";
    const id = Number(raw);
    if (!/^\d+$/.test(raw) || !catalogId(id))
      throw new CatalogError("Enter a valid iTunes track ID.", 400);
    const country = requestCountry(params.get("country"));
    const track = await resolved(
      `${country}:${id}`,
      (signal) =>
        createPersistentMusic(getMusicRepository()).resolve(
          id,
          country,
          signal
        ),
      request.signal
    );
    return Response.json(
      { track },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return error instanceof YoutubeError
      ? youtubeErrorResponse(error)
      : catalogErrorResponse(error, request.signal);
  }
}
