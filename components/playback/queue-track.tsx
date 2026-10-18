"use client";

import { ArrowDown, ArrowUp, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime, type Track } from "@/lib/music/track";

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
  const label = `${position}. ${track.title}`;
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
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={track.title}>
            {track.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {track.uploader ?? "Unknown uploader"}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatTime(track.duration)}
        </span>
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
