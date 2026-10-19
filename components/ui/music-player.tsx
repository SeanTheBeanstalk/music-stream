"use client";
import { useEffect, useRef } from "react";
import { Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlayback } from "@/components/playback/playback-provider";
import { formatTime } from "@/lib/music/track";
import { trackDetails } from "@/lib/music/track-details";
import { QueuePanel } from "@/components/playback/queue-panel";
import { RepeatControl } from "@/components/playback/repeat-control";
import { TrackCover } from "@/components/music/track-cover";

export function MusicPlayer() {
  const playerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--music-player-height",
        `${player.getBoundingClientRect().height}px`
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(player);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--music-player-height");
    };
  }, []);
  const p = usePlayback();
  const upcoming = p.queue.tracks.slice(p.queue.index + 1);
  const details = p.track
    ? trackDetails(p.track, {
        showGenreAndYear: false,
        showExplicitness: false,
      })
    : null;
  return (
    <footer
      ref={playerRef}
      aria-label="Music player"
      className="@container/player fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-5 py-4 backdrop-blur-md transition-[left] duration-200 ease-linear sm:px-8 md:left-[var(--app-sidebar-width)]"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3">
        <div className="flex items-center gap-4">
          {p.track && (
            <TrackCover
              src={details?.artwork}
              className="hidden @min-[36rem]/player:flex"
            />
          )}
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-semibold"
              title={details?.title}
            >
              {details?.title ?? "Nothing playing yet"}
            </p>
            <p
              className="truncate text-xs text-muted-foreground"
              title={details?.description}
            >
              {details?.description ??
                (upcoming.length
                  ? "Press Play to start your queue"
                  : "Search for a track to get started")}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous track"
              disabled={p.queue.index <= 0}
              onClick={p.previous}
            >
              <SkipBack />
            </Button>
            <Button
              size="icon"
              aria-label={p.playRequested ? "Pause" : "Play"}
              disabled={!p.track && !upcoming.length}
              onClick={p.toggle}
            >
              {p.playRequested ? <Pause /> : <Play />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next track"
              disabled={!upcoming.length}
              onClick={p.next}
            >
              <SkipForward />
            </Button>
          </div>
          <label className="hidden items-center gap-2 @min-[36rem]/player:flex">
            <Volume2 aria-hidden="true" className="size-4" />
            <span className="sr-only">Volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={p.volume}
              onChange={(e) => p.changeVolume(Number(e.target.value))}
              className="w-24 accent-current"
            />
          </label>
          <QueuePanel />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="w-12 shrink-0 text-right tabular-nums">
            {formatTime(p.time)}
          </span>
          <input
            aria-label="Seek"
            type="range"
            min="0"
            max={p.duration || 0}
            step="1"
            value={Math.min(p.time, p.duration)}
            disabled={!p.seekable || !p.duration}
            onChange={(e) => p.seek(Number(e.target.value))}
            className="min-w-0 flex-1 accent-current"
          />
          <span className="w-12 shrink-0 tabular-nums">
            {formatTime(p.duration || null)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="min-w-0 text-xs text-muted-foreground">
            {p.error ??
              (p.buffering
                ? "Buffering..."
                : p.track && p.repeatMode === "track"
                  ? "Repeating current track"
                  : upcoming.length
                    ? `Up next: ${trackDetails(upcoming[0]).title} (${upcoming.length} queued)`
                    : p.track
                      ? p.repeatMode === "queue"
                        ? "Queue will repeat"
                        : "End of queue"
                      : "Your queue is empty")}
          </p>
          <RepeatControl />
        </div>
      </div>
    </footer>
  );
}
export default MusicPlayer;
