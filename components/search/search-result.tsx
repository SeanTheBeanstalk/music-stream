"use client";
import { Music2 } from "lucide-react";
import { useState, type RefObject } from "react";
import { TrackActions } from "./track-actions";
import type { Track } from "@/lib/music/track";
import { TrackMetadata } from "@/components/music/track-metadata";
import type { CatalogTrack } from "@/lib/music/catalog";
export function SearchResult({
  track,
  pendingActionRef,
}: {
  track: CatalogTrack;
  pendingActionRef: RefObject<AbortController | null>;
}) {
  const [source, setSource] = useState<Track | undefined>();
  return (
    <article className="grid gap-5 border bg-card p-5 sm:grid-cols-[100px_1fr] sm:p-6">
      <div
        className="flex aspect-square w-24 items-center justify-center bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Music2 className="size-10" />
      </div>
      <div className="min-w-0 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-xl font-semibold wrap-break-word">
            {track.title}
          </h2>
          <TrackMetadata catalog={track} source={source} />
        </div>
        <p className="text-sm text-muted-foreground">
          {track.artist.name ?? "Artist unknown"} &middot;{" "}
          {track.album.name ?? "Album unknown"}
        </p>
        <TrackActions
          track={track}
          pendingActionRef={pendingActionRef}
          onResolved={setSource}
        />
      </div>
    </article>
  );
}
