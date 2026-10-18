import { ExternalLink } from "lucide-react";
import { TrackActions } from "./track-actions";
import { formatTime, type Track } from "@/lib/music/track";
export function SearchResult({ track }: { track: Track }) {
  return (
    <article className="grid gap-6 border bg-card p-5 sm:grid-cols-[180px_1fr] sm:p-6">
      {/* YouTube artwork is derived from a validated video ID. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={track.artwork}
        alt={`Artwork for ${track.title}`}
        width={320}
        height={180}
        className="aspect-video w-full self-start object-cover sm:aspect-square"
      />
      <div className="flex min-w-0 flex-col justify-center gap-4">
        <p className="text-xs tracking-widest text-muted-foreground uppercase">
          First YouTube result
        </p>
        <h2 className="text-2xl font-semibold wrap-break-word">
          {track.title}
        </h2>
        <p className="text-sm text-muted-foreground">
          {track.uploader
            ? `Uploaded by ${track.uploader}`
            : "Uploader unavailable"}
          {track.duration !== null ? ` · ${formatTime(track.duration)}` : ""}
        </p>
        <TrackActions key={track.id} track={track} />
        <a
          href={track.url}
          target="_blank"
          rel="noreferrer"
          className="flex w-fit items-center gap-2 text-xs text-muted-foreground underline underline-offset-4 focus-visible:outline-2"
        >
          View on YouTube
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      </div>
    </article>
  );
}
