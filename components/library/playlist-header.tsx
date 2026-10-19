"use client";

import Link from "next/link";
import { Heart, Play, Plus, Shuffle } from "lucide-react";
import { TrackCover } from "@/components/music/track-cover";
import { Button } from "@/components/ui/button";
import type { Playlist, PlaylistItem } from "@/lib/music/library";
import { PlaylistEditor } from "./playlist-editor";

export function PlaylistHeader({
  songs,
  playlist,
  busy,
  onPlay,
}: {
  songs: PlaylistItem[];
  playlist?: Playlist;
  busy: boolean;
  onPlay: (shuffle: boolean) => void;
}) {
  const duration = songs.reduce(
    (sum, { track }) => sum + (track.duration ?? 0),
    0
  );
  const minutes = Math.round(duration / 60);
  return (
    <header className="flex flex-col gap-6 pb-8 sm:flex-row sm:gap-8">
      {playlist ? (
        <TrackCover
          src={songs[0]?.track.artwork}
          className="size-48 self-center rounded-sm shadow-xl sm:size-56 sm:self-start lg:size-64"
        />
      ) : (
        <div className="flex size-48 shrink-0 items-center justify-center self-center rounded-sm bg-gradient-to-br from-violet-600 to-violet-300 text-white shadow-xl sm:size-56 sm:self-start lg:size-64">
          <Heart aria-hidden="true" className="size-20 fill-current" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col pt-1 sm:pt-5">
        <h1 className="text-3xl font-semibold wrap-break-word">
          {playlist?.name ?? "Liked Songs"}
        </h1>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {playlist ? "Playlist" : "Your favorites"} · {songs.length}{" "}
          {songs.length === 1 ? "song" : "songs"}
          {minutes > 0 && (
            <>
              {" "}
              · {minutes} min
              {songs.some(({ track }) => track.duration === null)
                ? " known duration"
                : ""}
            </>
          )}
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3 sm:mt-auto sm:pt-7">
          <Button
            disabled={busy || !songs.length}
            onClick={() => onPlay(false)}
          >
            <Play aria-hidden="true" className="fill-current" /> Play
          </Button>
          <Button
            disabled={busy || !songs.length}
            onClick={() => onPlay(true)}
          >
            <Shuffle aria-hidden="true" /> Shuffle
          </Button>
          <div className="ml-auto flex items-center gap-1 text-[#fa2448] dark:text-rose-400">
            <Link
              href="/search"
              aria-label="Add songs from Search"
              className="inline-flex min-h-10 items-center gap-1 rounded-sm px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Plus aria-hidden="true" className="size-4" /> Add
            </Link>
            {playlist && <PlaylistEditor playlist={playlist} />}
          </div>
        </div>
      </div>
    </header>
  );
}
