import { getDatabase } from "@/lib/server/database";
import { createLibraryAccount } from "@/lib/server/library-account";
import { LibraryError } from "@/lib/server/library-validation";
import { libraryFailure } from "@/lib/server/library-http";
import { getAudio } from "@/lib/server/storage";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ playlistId: string }> }
) {
  try {
    const { playlistId } = await context.params;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        playlistId
      )
    )
      throw new LibraryError("Invalid playlist.");
    const database = getDatabase();
    if (!database) throw new LibraryError("Library unavailable.", 503);
    const user = await createLibraryAccount(database).current(request);
    if (!user) throw new LibraryError("Sign in to view this cover.", 401);
    const result = await database.query(
      "SELECT cover_image_key FROM public.playlists WHERE id=$1 AND user_id=$2",
      [playlistId, user.id]
    );
    const key = result.rows[0]?.cover_image_key;
    if (!key) throw new LibraryError("Cover not found.", 404);
    const object = await getAudio(key, { signal: request.signal });
    if (!object.Body) throw new LibraryError("Cover unavailable.", 404);
    return new Response(object.Body.transformToWebStream(), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(object.ContentLength === undefined
          ? {}
          : { "Content-Length": String(object.ContentLength) }),
      },
    });
  } catch (error) {
    return libraryFailure(error);
  }
}
