export const STOREFRONTS = {
  US: "United States",
  SG: "Singapore",
  GB: "United Kingdom",
  AU: "Australia",
  CA: "Canada",
  JP: "Japan",
  DE: "Germany",
  FR: "France",
  IN: "India",
};
export type Storefront = keyof typeof STOREFRONTS;
export interface CatalogArtist {
  id: number | null;
  name: string | null;
  provider: "itunes";
  country: Storefront;
}
export interface CatalogAlbum extends CatalogArtist {
  releaseDate: string | null;
}
export interface CatalogTrack {
  id: string;
  trackId: number;
  provider: "itunes";
  country: Storefront;
  title: string;
  artist: CatalogArtist;
  album: CatalogAlbum;
  duration: number | null;
  genre: string | null;
  explicitness: "explicit" | "cleaned" | "notExplicit" | null;
  storeUrl: string | null;
}
export const catalogId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export function storefront(value: string): Storefront | null {
  const code = value.toUpperCase();
  return Object.hasOwn(STOREFRONTS, code) ? (code as Storefront) : null;
}
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
export function normalizeCatalog(
  value: unknown,
  country: Storefront
): CatalogTrack | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = text(row.trackName);
  if (row.kind !== "song" || !catalogId(row.trackId) || !title) return null;
  let storeUrl: string | null = null;
  try {
    const url = new URL(String(row.trackViewUrl));
    if (
      url.protocol === "https:" &&
      ["music.apple.com", "itunes.apple.com"].includes(url.hostname) &&
      !url.username &&
      !url.password
    )
      storeUrl = url.href;
  } catch {}
  return {
    id: `itunes:${row.trackId}`,
    trackId: row.trackId,
    provider: "itunes",
    country,
    title,
    artist: {
      id: catalogId(row.artistId) ? row.artistId : null,
      name: text(row.artistName),
      provider: "itunes",
      country,
    },
    album: {
      id: catalogId(row.collectionId) ? row.collectionId : null,
      name: text(row.collectionName),
      provider: "itunes",
      country,
      releaseDate:
        typeof row.releaseDate === "string" &&
        Number.isFinite(Date.parse(row.releaseDate))
          ? row.releaseDate
          : null,
    },
    duration:
      typeof row.trackTimeMillis === "number" &&
      Number.isFinite(row.trackTimeMillis) &&
      row.trackTimeMillis > 0
        ? row.trackTimeMillis / 1000
        : null,
    genre: text(row.primaryGenreName),
    explicitness: ["explicit", "cleaned", "notExplicit"].includes(
      String(row.trackExplicitness)
    )
      ? (row.trackExplicitness as CatalogTrack["explicitness"])
      : null,
    storeUrl,
  };
}
