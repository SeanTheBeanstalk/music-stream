import "server-only";
import type pg from "pg";
import type { CatalogTrack } from "../music/catalog.ts";
import type { Library, LibraryCommand } from "../music/library.ts";
import { LibraryError } from "./library-validation.ts";

export function createLibraryRepository(
  database: Pick<pg.Pool, "connect" | "query">
) {
  // A single statement gives a consistent snapshot, including revisions and items.
  async function read(userId: string, name: string): Promise<Library> {
    const result = await database.query(
      `SELECT
      COALESCE((SELECT jsonb_agg(jsonb_build_object('track',c.metadata,'savedAt',l.created_at) ORDER BY l.created_at DESC)
        FROM public.likes l JOIN public.catalog_tracks c ON c.id=l.catalog_track_id WHERE l.user_id=$1),'[]') AS likes,
      COALESCE((SELECT jsonb_agg(p ORDER BY p."updatedAt" DESC) FROM (
        SELECT p.id,p.name,p.description,
          CASE WHEN p.cover_image_key IS NOT NULL THEN '/api/library/covers/' || p.id || '?v=' || p.revision ELSE NULL END AS "coverUrl",
          p.revision,p.updated_at AS "updatedAt",
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'track',c.metadata) ORDER BY i.position)
            FROM public.playlist_items i JOIN public.catalog_tracks c ON c.id=i.catalog_track_id WHERE i.playlist_id=p.id),'[]') AS items
        FROM public.playlists p WHERE p.user_id=$1) p),'[]') AS playlists`,
      [userId]
    );
    return { user: { name }, ...result.rows[0] };
  }
  async function mutate(
    userId: string,
    command: LibraryCommand,
    track: CatalogTrack | null = null,
    coverKey?: string
  ) {
    const client = await database.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      // Serialize per-account limits as well as operations on the same playlist.
      await client.query("SELECT id FROM public.users WHERE id=$1 FOR UPDATE", [
        userId,
      ]);
      let catalogKey: string | undefined;
      if (
        command.action === "add" ||
        (command.action === "like" && command.liked)
      ) {
        if (
          !track ||
          track.trackId !== command.trackId ||
          track.country !== command.country
        )
          throw new LibraryError("Song metadata is unavailable.", 404);
        // Insert trusted server metadata only. Library writes never overwrite shared metadata or mappings.
        await client.query(
          `INSERT INTO public.catalog_tracks
          (provider,provider_track_id,storefront,title,artist_id,artist_name,album_id,album_name,
           duration_ms,artwork_url,store_url,metadata,fetched_at,refresh_after)
          VALUES ('itunes',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now()+interval '24 hours') ON CONFLICT DO NOTHING`,
          [
            String(track.trackId),
            track.country,
            track.title,
            track.artist.id,
            track.artist.name,
            track.album.id,
            track.album.name,
            track.duration === null
              ? null
              : Math.min(2147483647, Math.round(track.duration * 1000)),
            track.artwork,
            track.storeUrl,
            JSON.stringify(track),
          ]
        );
        const row = await client.query(
          "SELECT id FROM public.catalog_tracks WHERE provider='itunes' AND provider_track_id=$1 AND storefront=$2",
          [String(track.trackId), track.country]
        );
        catalogKey = row.rows[0].id;
      }
      if (command.action === "like") {
        if (command.liked)
          await client.query(
            "INSERT INTO public.likes (user_id,catalog_track_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [userId, catalogKey]
          );
        else
          await client.query(
            `DELETE FROM public.likes WHERE user_id=$1 AND catalog_track_id IN
          (SELECT id FROM public.catalog_tracks WHERE provider='itunes' AND provider_track_id=$2 AND storefront=$3)`,
            [userId, String(command.trackId), command.country]
          );
      } else if (command.action === "create") {
        const count = await client.query(
          "SELECT count(*)::int AS count FROM public.playlists WHERE user_id=$1",
          [userId]
        );
        if (count.rows[0].count >= 100)
          throw new LibraryError("You can create up to 100 playlists.");
        await client.query(
          "INSERT INTO public.playlists (user_id,name,description,cover_image_key) VALUES ($1,$2,$3,$4)",
          [userId, command.name, command.description ?? "", coverKey ?? null]
        );
      } else {
        const row = await client.query(
          "SELECT revision FROM public.playlists WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [command.playlistId, userId]
        );
        if (!row.rows[0]) throw new LibraryError("Playlist not found.", 404);
        if (row.rows[0].revision !== command.revision)
          throw new LibraryError(
            "This playlist changed elsewhere. Review the refreshed playlist and try again.",
            409
          );
        if (command.action === "delete") {
          await client.query(
            "DELETE FROM public.playlists WHERE id=$1 AND user_id=$2",
            [command.playlistId, userId]
          );
        } else {
          await client.query("SET CONSTRAINTS playlist_items_order DEFERRED");
          const items = await client.query<{ id: string }>(
            "SELECT id FROM public.playlist_items WHERE playlist_id=$1 ORDER BY position",
            [command.playlistId]
          );
          let ids = items.rows.map((i) => i.id);
          if (command.action === "add") {
            if (ids.length >= 1000)
              throw new LibraryError(
                "A playlist can contain up to 1,000 songs."
              );
            const added = await client.query(
              "INSERT INTO public.playlist_items (playlist_id,catalog_track_id,position) VALUES ($1,$2,$3) RETURNING id",
              [command.playlistId, catalogKey, ids.length]
            );
            ids.push(added.rows[0].id);
          } else if (command.action === "remove") {
            if (!ids.includes(command.itemId))
              throw new LibraryError("Playlist item not found.", 404);
            await client.query(
              "DELETE FROM public.playlist_items WHERE playlist_id=$1 AND id=$2",
              [command.playlistId, command.itemId]
            );
            ids = ids.filter((id) => id !== command.itemId);
          } else if (command.action === "reorder") {
            if (
              ids.length !== command.itemIds.length ||
              command.itemIds.some((id) => !ids.includes(id))
            )
              throw new LibraryError(
                "Order must contain every playlist entry exactly once."
              );
            ids = command.itemIds;
          }
          if (command.action === "remove" || command.action === "reorder") {
            await client.query(
              `UPDATE public.playlist_items i SET position=o.position::int-1
              FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id,position) WHERE i.playlist_id=$1 AND i.id=o.id`,
              [command.playlistId, ids]
            );
          }
          await client.query(
            `UPDATE public.playlists SET name=COALESCE($2,name),
              description=COALESCE($4,description),
              cover_image_key=CASE WHEN $5 THEN $6 ELSE cover_image_key END,
              revision=revision+1,updated_at=now() WHERE id=$1 AND user_id=$3`,
            [
              command.playlistId,
              command.action === "rename" || command.action === "update"
                ? command.name
                : null,
              userId,
              command.action === "update" ? command.description : null,
              command.action === "update" &&
                (coverKey !== undefined || command.removeCover === true),
              coverKey ?? null,
            ]
          );
        }
      }
      if (coverKey)
        await client.query(
          "DELETE FROM public.playlist_cover_cleanup WHERE object_key=$1",
          [coverKey]
        );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }
  return { read, mutate };
}
