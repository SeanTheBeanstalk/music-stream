import type { Track } from "./track.ts";

// Catalog metadata drives display; source fields remain available for inspection
// and streaming. Legacy YouTube-only queue entries retain their own metadata.
export function trackDetails(
  track: Track,
  { showGenreAndYear = true, showExplicitness = true } = {}
) {
  const catalog = track.catalog;
  if (!catalog)
    return {
      title: track.title,
      description: track.uploader ?? "Unknown uploader",
      storeUrl: null,
    };
  return {
    title: catalog.title,
    description: [
      catalog.artist.name ?? "Artist unknown",
      catalog.album.name,
      showGenreAndYear ? catalog.genre : null,
      showGenreAndYear ? catalog.album.releaseDate?.slice(0, 4) : null,
      !showExplicitness
        ? null
        : catalog.explicitness === "explicit"
          ? "Explicit"
          : catalog.explicitness === "cleaned"
            ? "Cleaned"
            : null,
    ]
      .filter(Boolean)
      .join(" · "),
    storeUrl: catalog.storeUrl,
  };
}
