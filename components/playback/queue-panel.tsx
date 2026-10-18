"use client";

import { useRef, useState } from "react";
import { ListMusic } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { usePlayback } from "@/components/playback/playback-provider";
import { QueueTrack } from "@/components/playback/queue-track";
import { TrackMetadata } from "@/components/music/track-metadata";
import { trackDetails } from "@/lib/music/track-details";

export function QueuePanel() {
  const p = usePlayback();
  const currentDetails = p.track
    ? trackDetails(p.track, {
        showGenreAndYear: false,
        showExplicitness: false,
      })
    : null;
  const upcoming = p.queue.tracks.slice(p.queue.index + 1);
  const [announcement, setAnnouncement] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Open queue (${upcoming.length} upcoming)`}
          />
        }
      >
        <ListMusic aria-hidden="true" />
      </SheetTrigger>
      <SheetContent className="data-[side=right]:w-full sm:data-[side=right]:max-w-md">
        <SheetHeader className="shrink-0 p-5 pr-16">
          <SheetTitle>Queue</SheetTitle>
          <SheetDescription>
            {upcoming.length} upcoming{" "}
            {upcoming.length === 1 ? "track" : "tracks"}. Changes apply to this
            session.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
          <section aria-labelledby="queue-current">
            <h3 id="queue-current" className="mb-3 font-semibold">
              Current track
            </h3>
            {p.track ? (
              <div className="border bg-muted/40 p-4" aria-current="true">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {currentDetails?.title}
                    </p>
                    <p className="mt-1 text-xs break-words text-muted-foreground">
                      {currentDetails?.description}
                    </p>
                  </div>
                  <TrackMetadata
                    catalog={p.track.catalog}
                    source={p.track}
                    audioDuration={p.duration}
                    label={`Track details for current track ${currentDetails?.title}`}
                  />
                </div>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  onClick={p.toggle}
                >
                  {p.playing ? "Pause" : "Play"}
                </Button>
                <p role="status" className="mt-2 text-xs text-muted-foreground">
                  {p.error ??
                    (p.buffering
                      ? "Buffering..."
                      : p.playing
                        ? "Playing"
                        : "Paused")}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                {upcoming.length
                  ? "Nothing playing yet. Press Play or choose a track from Up next."
                  : "Your queue is empty. Search for a track and choose Play or Add to queue."}
              </p>
            )}
          </section>
          <section aria-labelledby="queue-upcoming" className="mt-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3
                id="queue-upcoming"
                ref={heading}
                tabIndex={-1}
                className="font-semibold focus-visible:outline-2"
              >
                Up next
              </h3>
              <Button
                variant="outline"
                size="sm"
                disabled={!upcoming.length}
                onClick={() => {
                  p.clearUpcoming();
                  setAnnouncement(
                    "Upcoming tracks cleared. Current track unchanged."
                  );
                  heading.current?.focus();
                }}
              >
                Clear upcoming
              </Button>
            </div>
            {upcoming.length ? (
              <ol aria-label="Upcoming tracks">
                {upcoming.map((track, offset) => {
                  const index = p.queue.index + 1 + offset;
                  return (
                    <QueueTrack
                      key={index}
                      track={track}
                      position={offset + 1}
                      first={offset === 0}
                      last={offset === upcoming.length - 1}
                      onPlay={() => {
                        p.playQueued(index);
                        setAnnouncement(
                          `Selected ${trackDetails(track).title}.`
                        );
                        heading.current?.focus();
                      }}
                      onRemove={() => {
                        p.removeQueued(index);
                        setAnnouncement(
                          `Removed ${trackDetails(track).title} from the queue.`
                        );
                        heading.current?.focus();
                      }}
                      onMove={(direction) => {
                        p.moveQueued(index, index + direction);
                        setAnnouncement(
                          `Moved ${trackDetails(track).title} to position ${offset + 1 + direction}.`
                        );
                        heading.current?.focus();
                      }}
                    />
                  );
                })}
              </ol>
            ) : (
              <p className="py-3 text-muted-foreground">
                No upcoming tracks. Add more from Search.
              </p>
            )}
          </section>
          <p role="status" className="sr-only">
            {announcement}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
