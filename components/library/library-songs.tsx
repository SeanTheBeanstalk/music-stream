"use client";
import { useRef, useState } from "react";
import { TrackActionMenu } from "@/components/music/track-action-menu";
import { useLibrary } from "./library-provider";
import type { Playlist, PlaylistItem } from "@/lib/music/library";
import { formatTime } from "@/lib/music/track";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PlaylistHeader } from "./playlist-header";
import { usePlaylistPlayback } from "./use-playlist-playback";

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
  const playback = usePlaylistPlayback();
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
    <div className="space-y-2">
      <PlaylistHeader
        songs={songs}
        playlist={playlist}
        busy={playback.busy}
        onPlay={(shuffle) => void playback.start(songs, shuffle)}
      />
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {playback.message}
      </p>
      {songs.length === 0 && (
        <p className="border border-dashed p-8 text-muted-foreground">
          {playlist
            ? "This playlist is waiting for its first song. Add music from Search or your liked songs."
            : "Your favorites start here. Like a song from Search to save it to your library."}
        </p>
      )}
      <ol aria-label="Playlist songs" className="space-y-1">
        {songs.map(({ id, track }, index) => (
          <li
            key={id}
            className="grid min-h-12 grid-cols-[1.5rem_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-sm px-2 odd:bg-muted/60 hover:bg-muted sm:gap-4 sm:px-4"
          >
            <span
              aria-hidden="true"
              className="text-right text-sm text-muted-foreground tabular-nums"
            >
              {index + 1}
            </span>
            <button
              className="min-w-0 py-3 text-left text-sm focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
              disabled={playback.busy}
              aria-label={`Play ${track.title}, entry ${index + 1}`}
              onClick={() => void playback.start([{ id, track }], false)}
            >
              <span className="flex items-center gap-2">
                <span className="truncate">{track.title}</span>
                {track.explicitness === "explicit" && (
                  <span
                    aria-label="Explicit"
                    className="rounded-xs bg-muted-foreground px-1 text-[9px] font-bold text-background"
                  >
                    E
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground sm:hidden">
                {track.artist.name ?? "Artist unknown"}
              </span>
            </button>
            <span className="text-sm text-muted-foreground tabular-nums">
              {formatTime(track.duration)}
            </span>
            <TrackActionMenu
              key={`${track.id}:${track.country}`}
              track={track}
              pendingActionRef={pending}
              onResolved={() => {}}
              queueToast={Boolean(playlist)}
              label={`Actions for ${track.title}, entry ${index + 1}`}
              triggerClassName="text-[#fa2448] dark:text-rose-400"
              className="contents"
            >
              {playlist && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={busy || index === 0}
                    aria-label={`Move ${track.title}, entry ${index + 1}, up`}
                    onClick={() => void edit(id, -1)}
                  >
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy || index === songs.length - 1}
                    aria-label={`Move ${track.title}, entry ${index + 1}, down`}
                    onClick={() => void edit(id, 1)}
                  >
                    Move down
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={busy}
                    aria-label={`Remove ${track.title}, entry ${index + 1}, from playlist`}
                    onClick={() => void edit(id)}
                  >
                    Remove from playlist
                  </DropdownMenuItem>
                </>
              )}
            </TrackActionMenu>
          </li>
        ))}
      </ol>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
