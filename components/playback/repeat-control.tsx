"use client";

import { Repeat, Repeat1 } from "lucide-react";
import { usePlayback } from "@/components/playback/playback-provider";
import { Button } from "@/components/ui/button";

export function RepeatControl() {
  const { repeatMode, cycleRepeatMode } = usePlayback();
  const label =
    repeatMode === "off"
      ? "Repeat: Off"
      : repeatMode === "track"
        ? "Repeat track"
        : "Repeat queue";
  const next =
    repeatMode === "off"
      ? "Repeat track"
      : repeatMode === "track"
        ? "Repeat queue"
        : "Repeat: Off";

  return (
    <>
      <Button
        variant={repeatMode === "off" ? "ghost" : "secondary"}
        size="sm"
        aria-label={`${label}. Switch to ${next}.`}
        title={`${label}. Switch to ${next}.`}
        onClick={cycleRepeatMode}
      >
        {repeatMode === "track" ? (
          <Repeat1 aria-hidden="true" />
        ) : (
          <Repeat aria-hidden="true" />
        )}
        {label}
      </Button>
      <span role="status" className="sr-only">
        {label}
      </span>
    </>
  );
}
