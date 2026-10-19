import { MAX_QUERY_LENGTH } from "@/lib/music/track";
import {
  CatalogError,
  catalogErrorResponse,
  requestCountry,
} from "@/lib/server/itunes";
import {
  createPersistentMusic,
  getMusicRepository,
} from "@/lib/server/persistent-music";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const raw = params.get("q") ?? "";
    const query = raw.trim();
    if (
      !query ||
      query.length > MAX_QUERY_LENGTH ||
      /[\x00-\x1f\x7f]/.test(raw)
    )
      throw new CatalogError(
        `Enter a search between 1 and ${MAX_QUERY_LENGTH} characters.`,
        400
      );
    const country = requestCountry(params.get("country"));
    const tracks = await createPersistentMusic(getMusicRepository()).search(
      query,
      country,
      request.signal
    );
    return Response.json(
      { tracks, country },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return catalogErrorResponse(error, request.signal);
  }
}
