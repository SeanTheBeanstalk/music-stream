"use client";
import { useState } from "react";
import { Play, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlayback } from "@/components/playback/playback-provider";
import type { Track } from "@/lib/music/track";
export function TrackActions({ track }: { track: Track }) {
  const { play, enqueue } = usePlayback();
  const [added, setAdded] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => play(track)}>
        <Play aria-hidden="true" />
        Play
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          enqueue(track);
          setAdded(true);
        }}
      >
        <ListPlus aria-hidden="true" />
        Add to queue
      </Button>
      <span role="status" className="text-sm text-muted-foreground">
        {added ? "Added to queue" : ""}
      </span>
    </div>
  );
}
