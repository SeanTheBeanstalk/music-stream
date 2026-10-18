import type { CatalogTrack } from "./catalog.ts";
import type { Track } from "./track.ts";
const words = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const contains = (haystack: string, needle: string) =>
  ` ${haystack} `.includes(` ${needle} `);
// Keep YouTube search order and select the first title/artist match.
export function matchCandidates(
  catalog: CatalogTrack,
  candidates: Track[]
): Track | null {
  const title = words(catalog.title);
  const artist = words(catalog.artist.name ?? "");
  if (!title || !artist) return null;
  return (
    candidates.find(
      (candidate) =>
        contains(words(candidate.title), title) &&
        contains(
          words(`${candidate.title} ${candidate.uploader ?? ""}`),
          artist
        )
    ) ?? null
  );
}
