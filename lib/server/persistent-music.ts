import "server-only";
import type { CatalogTrack, Storefront } from "../music/catalog.ts";
import type { Track } from "../music/track.ts";
import { getDatabase } from "./database.ts";
import {
  createMusicRepository,
  type MusicRepository,
} from "./music-repository.ts";
import { catalog, CatalogError } from "./itunes.ts";
import { resolveSource } from "./resolve-source.ts";

export function getMusicRepository() {
  const database = getDatabase();
  return database ? createMusicRepository(database) : null;
}

// Cache failures must not prevent ordinary catalog search or YouTube playback.
export async function optionalPersistence<T>(
  work: () => Promise<T>
): Promise<T | null> {
  try {
    return await work();
  } catch {
    console.warn(
      "Music persistence unavailable; continuing with the original provider."
    );
    return null;
  }
}

export function createPersistentMusic(
  repository: MusicRepository | null,
  provider = catalog,
  resolver = resolveSource
) {
  async function saveCatalog(track: CatalogTrack) {
    if (repository)
      await optionalPersistence(() => repository.saveCatalog(track));
  }
  async function search(
    query: string,
    country: Storefront,
    signal: AbortSignal
  ) {
    const tracks = await provider.search(query, country, signal);
    await Promise.all(tracks.map(saveCatalog));
    signal.throwIfAborted();
    return tracks;
  }
  async function resolve(
    id: number,
    country: Storefront,
    signal: AbortSignal
  ): Promise<Track> {
    const stored =
      repository &&
      (await optionalPersistence(() => repository.getCatalog(id, country)));
    let metadata = stored;
    if (!metadata) {
      try {
        metadata = await provider.lookup(id, country, signal);
        if (metadata) await saveCatalog(metadata);
      } catch (error) {
        signal.throwIfAborted();
        // Keep saved metadata usable during a temporary catalog outage.
        metadata =
          repository &&
          (await optionalPersistence(() =>
            repository.getCatalog(id, country, false)
          ));
        if (!metadata) throw error;
      }
    }
    signal.throwIfAborted();
    if (!metadata)
      throw new CatalogError(
        "This track is unavailable in the selected storefront.",
        404
      );
    const selected =
      repository &&
      (await optionalPersistence(() => repository.getMapping(id, country)));
    signal.throwIfAborted();
    if (selected) return { ...selected, catalog: metadata };
    if (!metadata.artist.name)
      throw new CatalogError(
        "No confident YouTube match. Try another recording.",
        422
      );
    const candidate = await resolver(metadata, signal);
    signal.throwIfAborted();
    if (!candidate)
      throw new CatalogError(
        "No confident YouTube match. Try another recording or retry.",
        422
      );
    const source = repository
      ? ((await optionalPersistence(() =>
          repository.selectSource(metadata, candidate)
        )) ?? candidate)
      : candidate;
    signal.throwIfAborted();
    return { ...source, catalog: metadata };
  }
  return { search, resolve };
}
