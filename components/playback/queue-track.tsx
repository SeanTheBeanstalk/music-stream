"use client";

import { ArrowDown, ArrowUp, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Track } from "@/lib/music/track";
import { TrackMetadata } from "@/components/music/track-metadata";
import { trackDetails } from "@/lib/music/track-details";
import { TrackCover } from "@/components/music/track-cover";

interface QueueTrackProps {
  track: Track;
  position: number;
  onPlay: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  first: boolean;
  last: boolean;
}

export function QueueTrack({
  track,
  position,
  onPlay,
  onRemove,
  onMove,
  first,
  last,
}: QueueTrackProps) {
  const details = trackDetails(track, {
    showGenreAndYear: false,
    showExplicitness: false,
  });
  const label = `${position}. ${details.title}`;
  return (
    <li className="border-b py-3" aria-label={label}>
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Play queued track ${label}`}
          onClick={onPlay}
        >
          <Play aria-hidden="true" />
        </Button>
        <TrackCover src={details.artwork} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={details.title}>
            {details.title}
          </p>
          <p
            className="truncate text-xs text-muted-foreground"
            title={details.description}
          >
            {details.description}
          </p>
        </div>
        <TrackMetadata
          catalog={track.catalog}
          source={track}
          label={`Track details for queued track ${label}`}
        />
      </div>
      <div className="mt-1 flex justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Move up ${label}`}
          disabled={first}
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Move down ${label}`}
          disabled={last}
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove queued track ${label}`}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}
