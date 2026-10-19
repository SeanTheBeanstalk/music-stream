"use client";
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrackCover } from "@/components/music/track-cover";
import { TrackMetadata } from "@/components/music/track-metadata";
import { TrackActions } from "@/components/search/track-actions";
import { SaveActions } from "./save-actions";
import { useLibrary } from "./library-provider";
import type { Playlist, PlaylistItem } from "@/lib/music/library";

export function LibrarySongs({
  songs,
  playlist,
}: {
  songs: PlaylistItem[];
  playlist?: Playlist;
}) {
  const pending = useRef<AbortController | null>(null);
  const { mutate, busy } = useLibrary();
  const [message, setMessage] = useState("");
  async function edit(itemId: string, direction?: -1 | 1) {
    if (!playlist) return;
    try {
      if (direction) {
        const ids = playlist.items.map((item) => item.id);
        const index = ids.indexOf(itemId);
        const to = index + direction;
        if (to < 0 || to >= ids.length) return;
        [ids[index], ids[to]] = [ids[to], ids[index]];
        await mutate({
          action: "reorder",
          playlistId: playlist.id,
          revision: playlist.revision,
          itemIds: ids,
        });
        setMessage("Playlist order updated.");
      } else {
        await mutate({
          action: "remove",
          playlistId: playlist.id,
          revision: playlist.revision,
          itemId,
        });
        setMessage("Song removed from playlist.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to update playlist."
      );
    }
  }
  return (
    <div className="space-y-4">
      {songs.length === 0 && (
        <p className="border border-dashed p-8 text-muted-foreground">
          {playlist
            ? "This playlist is waiting for its first song. Add music from Search or your liked songs."
            : "Your favorites start here. Like a song from Search to save it to your library."}
        </p>
      )}
      <ol className="space-y-3">
        {songs.map(({ id, track }, index) => (
          <li
            key={id}
            className="grid gap-4 border bg-card p-4 sm:grid-cols-[64px_1fr]"
          >
            <TrackCover src={track.artwork} className="size-16" />
            <div className="min-w-0 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold wrap-break-word">
                    {track.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {track.artist.name ?? "Artist unknown"} ·{" "}
                    {track.album.name ?? "Album unknown"}
                  </p>
                </div>
                <TrackMetadata catalog={track} />
              </div>
              <TrackActions
                key={`${track.id}:${track.country}`}
                track={track}
                pendingActionRef={pending}
                onResolved={() => {}}
              />
              <SaveActions track={track} />
              {playlist && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || index === 0}
                    aria-label={`Move ${track.title}, entry ${index + 1}, up`}
                    onClick={() => void edit(id, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                    Up
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || index === songs.length - 1}
                    aria-label={`Move ${track.title}, entry ${index + 1}, down`}
                    onClick={() => void edit(id, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                    Down
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Remove ${track.title}, entry ${index + 1}, from playlist`}
                    onClick={() => void edit(id)}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
