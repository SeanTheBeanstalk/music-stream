"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Play, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlayback } from "@/components/playback/playback-provider";
import type { Track } from "@/lib/music/track";
import type { CatalogTrack } from "@/lib/music/catalog";
export function TrackActions({
  track,
  pendingActionRef,
  onResolved,
}: {
  track: CatalogTrack;
  pendingActionRef: RefObject<AbortController | null>;
  onResolved: (track: Track) => void;
}) {
  const { play, enqueue } = usePlayback();
  const own = useRef<AbortController | null>(null);
  const [source, setSource] = useState<Track | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => () => own.current?.abort(), []);
  async function resolve(action: "play" | "enqueue") {
    pendingActionRef.current?.abort();
    const controller = new AbortController();
    own.current = controller;
    pendingActionRef.current = controller;
    setBusy(true);
    setMessage("Finding a matching YouTube upload...");
    try {
      let selected = source;
      if (!selected) {
        const response = await fetch(
          `/api/resolve?id=${track.trackId}&country=${track.country}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.error || "Unable to resolve playback. Please retry."
          );
        selected = data.track as Track;
      }
      if (controller.signal.aborted) return;
      setSource(selected);
      onResolved(selected!);
      if (action === "play") play(selected!);
      else enqueue(selected!);
      setMessage(
        action === "play" ? "Selected for playback" : "Added to queue"
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to resolve playback. Please retry."
        );
    } finally {
      if (own.current === controller) {
        setBusy(false);
        if (controller.signal.aborted) setMessage("");
      }
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => void resolve("play")}>
          <Play aria-hidden="true" />
          Play
        </Button>
        <Button
          disabled={busy}
          variant="outline"
          onClick={() => void resolve("enqueue")}
        >
          <ListPlus aria-hidden="true" />
          Add to queue
        </Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
