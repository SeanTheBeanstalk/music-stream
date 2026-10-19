"use client";
import { TrackCover } from "@/components/music/track-cover";
import { useState, type RefObject } from "react";
import { SearchActions } from "./search-actions";
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
    <article className="relative grid gap-5 border bg-card p-5 pr-14 sm:grid-cols-[100px_1fr] sm:p-6 sm:pr-14">
      <TrackCover src={track.artwork} className="size-24" />
      <div className="min-w-0">
        <div className="space-y-1">
          <div className="flex items-start gap-1">
            <h2 className="min-w-0 text-xl leading-7 font-semibold wrap-break-word">
              {track.title}
            </h2>
            <TrackMetadata
              catalog={track}
              source={source}
              triggerClassName="size-7"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {track.artist.name ?? "Artist unknown"} &middot;{" "}
            {track.album.name ?? "Album unknown"}
          </p>
        </div>
        <SearchActions
          track={track}
          pendingActionRef={pendingActionRef}
          onResolved={setSource}
        />
      </div>
    </article>
  );
}
