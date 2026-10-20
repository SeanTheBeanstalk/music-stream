import {
  normalizeCatalog,
  storefront,
  type Storefront,
  type CatalogTrack,
} from "../music/catalog.ts";
import { createRequestCache } from "./request-cache.ts";
export class CatalogError extends Error {
  status: number;
  retryAfter: number;
  constructor(message: string, status = 502, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
// Server-only. Divide the upstream budget across the configured worker count.
// Dynamic worker counts require a shared gateway limiter before scaling.
export function createCatalogClient(
  fetcher: typeof fetch = fetch,
  workerCount = 1
) {
  const cached = createRequestCache<CatalogTrack[]>();
  let calls: number[] = [];
  let blockedUntil = 0;
  const allowance = Math.floor(18 / Math.max(1, workerCount));
  async function request(
    path: string,
    params: Record<string, string>,
    country: Storefront,
    signal: AbortSignal
  ) {
    const url = new URL(path, "https://itunes.apple.com");
    url.search = new URLSearchParams({
      ...params,
      country,
      media: "music",
      entity: "song",
      limit: path === "/search" ? "5" : "1",
    }).toString();
    return cached(
      url.href,
      async (sharedSignal) => {
        const now = Date.now();
        calls = calls.filter((time) => time > now - 60_000);
        if (blockedUntil > now || calls.length >= allowance)
          throw new CatalogError(
            "Catalog search is busy. Please retry shortly.",
            429,
            Math.max(
              1,
              Math.ceil(
                (Math.max(blockedUntil, (calls[0] ?? now) + 60_000) - now) /
                  1000
              )
            )
          );
        calls.push(now);
        try {
          const response = await fetcher(url, {
            signal: AbortSignal.any([
              sharedSignal,
              AbortSignal.timeout(10_000),
            ]),
            cache: "no-store",
          });
          if (response.status === 429) {
            const retry = Number(response.headers.get("Retry-After"));
            const seconds =
              Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : 60;
            blockedUntil = Date.now() + seconds * 1000;
            throw new CatalogError(
              "iTunes is limiting requests. Please retry shortly.",
              429,
              seconds
            );
          }
          if (!response.ok)
            throw new CatalogError("iTunes is unavailable. Please try again.");
          const data = await response.json();
          if (!Array.isArray(data.results))
            throw new CatalogError("iTunes returned an unexpected response.");
          const tracks: CatalogTrack[] = data.results
            .slice(0, path === "/search" ? 5 : 1)
            .map((row: unknown) => normalizeCatalog(row, country))
            .filter(
              (track: CatalogTrack | null): track is CatalogTrack =>
                track !== null
            );
          const seenIds = new Set<string>();
          const seenSongs = new Set<string>();
          return tracks.filter((track) => {
            const songKey = track.artist.name
              ? JSON.stringify([
                  track.title.toLowerCase(),
                  track.artist.name.toLowerCase(),
                ])
              : null;
            if (
              seenIds.has(track.id) ||
              (path === "/search" && songKey && seenSongs.has(songKey))
            )
              return false;
            seenIds.add(track.id);
            if (songKey) seenSongs.add(songKey);
            return true;
          });
        } catch (error) {
          if (sharedSignal.aborted) throw error;
          if (error instanceof CatalogError) throw error;
          throw new CatalogError(
            "iTunes could not be reached. Please try again.",
            error instanceof DOMException && error.name === "TimeoutError"
              ? 504
              : 502
          );
        }
      },
      signal
    );
  }
  return {
    search: (query: string, country: Storefront, signal: AbortSignal) =>
      request("/search", { term: query }, country, signal),
    lookup: async (id: number, country: Storefront, signal: AbortSignal) =>
      (await request("/lookup", { id: String(id) }, country, signal)).find(
        (track) => track.trackId === id
      ) ?? null,
  };
}
const workers = Number(process.env.ITUNES_WORKER_COUNT || "1");
export const catalog = createCatalogClient(
  fetch,
  Number.isInteger(workers) && workers > 0 ? workers : 18
);
export function requestCountry(value: string | null) {
  const country = storefront(value ?? process.env.ITUNES_COUNTRY ?? "US");
  if (!country) throw new CatalogError("Choose a supported storefront.", 400);
  return country;
}
export function catalogErrorResponse(error: unknown, signal: AbortSignal) {
  const failure =
    error instanceof CatalogError
      ? error
      : new CatalogError(
          "Catalog request failed. Please retry.",
          signal.aborted ? 499 : 502
        );
  return Response.json(
    { error: failure.message },
    {
      status: failure.status,
      headers: {
        "Cache-Control": "no-store",
        ...(failure.retryAfter
          ? { "Retry-After": String(failure.retryAfter) }
          : {}),
      },
    }
  );
}
