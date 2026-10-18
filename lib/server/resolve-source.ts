import type { CatalogTrack } from "../music/catalog.ts";
import { matchCandidates, playbackSearchQueries } from "../music/matching.ts";
import { normalizeTrack, type Track } from "../music/track.ts";
import { runYoutube } from "./youtube.ts";

async function searchYoutube(
  query: string,
  signal: AbortSignal
): Promise<Track[]> {
  const output = await runYoutube(
    [
      "--dump-single-json",
      "--skip-download",
      "--flat-playlist",
      "--",
      `ytsearch5:${query}`,
    ],
    signal
  );
  const data = JSON.parse(output);
  return Array.isArray(data.entries)
    ? data.entries
        .slice(0, 5)
        .map(normalizeTrack)
        .filter((track: Track | null): track is Track => track !== null)
    : [];
}

export async function resolveSource(
  catalog: CatalogTrack,
  signal: AbortSignal,
  search = searchYoutube
): Promise<Track | null> {
  // At most two searches share cancellation and a total time budget.
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  for (const query of playbackSearchQueries(catalog)) {
    boundedSignal.throwIfAborted();
    const candidates = await search(query, boundedSignal);
    boundedSignal.throwIfAborted();
    const match = matchCandidates(catalog, candidates);
    if (match) return match;
  }
  return null;
}
