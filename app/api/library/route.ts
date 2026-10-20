import {
  readPlaylistRequest,
  stagePlaylistCover,
  cleanupPlaylistCovers,
} from "@/lib/server/playlist-covers";
import { getDatabase } from "@/lib/server/database";
import { createLibraryAccount } from "@/lib/server/library-account";
import { createLibraryRepository } from "@/lib/server/library-repository";
import { LibraryError, sameOrigin } from "@/lib/server/library-validation";
import { libraryFailure, libraryResponse } from "@/lib/server/library-http";
import { createMusicRepository } from "@/lib/server/music-repository";
import { catalog } from "@/lib/server/itunes";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const database = getDatabase();
    if (!database)
      return libraryResponse({ user: null, likes: [], playlists: [] });
    const user = await createLibraryAccount(database).current(request);
    if (!user) return libraryResponse({ user: null, likes: [], playlists: [] });
    return libraryResponse(
      await createLibraryRepository(database).read(user.id, user.name)
    );
  } catch (error) {
    return libraryFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const database = getDatabase();
    if (!database)
      throw new LibraryError(
        "Library accounts need a configured PostgreSQL database.",
        503
      );
    const user = await createLibraryAccount(database).current(request);
    if (!user)
      throw new LibraryError("Sign in from Library to save music.", 401);
    const { command, image } = await readPlaylistRequest(request);
    let track = null;
    if (
      command.action === "add" ||
      (command.action === "like" && command.liked)
    ) {
      // Request bodies contain identity only; never trust client-provided metadata or source mappings.
      track =
        (await createMusicRepository(database).getCatalog(
          command.trackId,
          command.country,
          false
        )) ??
        (await catalog.lookup(
          command.trackId,
          command.country,
          request.signal
        ));
    }
    const repository = createLibraryRepository(database);
    // Reject foreign/stale edits before uploading; mutate checks again under lock.
    if (image && command.action === "update") {
      const owned = await database.query(
        "SELECT revision FROM public.playlists WHERE id=$1 AND user_id=$2",
        [command.playlistId, user.id]
      );
      if (!owned.rows[0]) throw new LibraryError("Playlist not found.", 404);
      if (owned.rows[0].revision !== command.revision)
        throw new LibraryError(
          "This playlist changed elsewhere. Review the refreshed playlist and try again.",
          409
        );
    }
    const coverKey = image
      ? await stagePlaylistCover(database, user.id, image, request.signal)
      : undefined;
    // Pending upload cleanup remains delayed if publication fails, because a
    // lost COMMIT response can still mean the transaction committed.
    await repository.mutate(user.id, command, track, coverKey);
    await cleanupPlaylistCovers(database).catch(() => {
      console.warn("Playlist cover cleanup deferred.");
    });
    return libraryResponse(await repository.read(user.id, user.name));
  } catch (error) {
    return libraryFailure(error);
  }
}
