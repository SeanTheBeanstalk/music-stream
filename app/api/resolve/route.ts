import { catalogId } from "@/lib/music/catalog";
import { matchCandidates } from "@/lib/music/matching";
import { normalizeTrack, type Track } from "@/lib/music/track";
import {
  catalog,
  CatalogError,
  catalogErrorResponse,
  requestCountry,
} from "@/lib/server/itunes";
import { createRequestCache } from "@/lib/server/request-cache";
import {
  runYoutube,
  YoutubeError,
  youtubeErrorResponse,
} from "@/lib/server/youtube";
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
      async (signal) => {
        const metadata = await catalog.lookup(id, country, signal);
        if (!metadata)
          throw new CatalogError(
            "This track is unavailable in the selected storefront.",
            404
          );
        if (!metadata.artist.name)
          throw new CatalogError(
            "No confident YouTube match. Try another recording.",
            422
          );
        const output = await runYoutube(
          [
            "--dump-single-json",
            "--skip-download",
            "--flat-playlist",
            "--",
            `ytsearch5:${metadata.artist.name} ${metadata.title}`,
          ],
          signal
        );
        const data = JSON.parse(output);
        const candidates: Track[] = Array.isArray(data.entries)
          ? data.entries.slice(0, 5).map(normalizeTrack).filter(Boolean)
          : [];
        const source = matchCandidates(metadata, candidates);
        if (!source)
          throw new CatalogError(
            "No confident YouTube match. Try another recording or retry.",
            422
          );
        return { ...source, catalog: metadata };
      },
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
