"use client";

import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
} from "@/components/ui/popover";
import { STOREFRONTS, type CatalogTrack } from "@/lib/music/catalog";
import { formatTime, type Track } from "@/lib/music/track";

export function TrackMetadata({
  catalog,
  source,
  audioDuration,
  label,
  triggerClassName,
}: {
  catalog?: CatalogTrack;
  source?: Track;
  audioDuration?: number;
  label?: string;
  triggerClassName?: string;
}) {
  const title = catalog?.title ?? source?.title ?? "Track";
  const rows = [
    ...(catalog
      ? [
          ["Catalog duration", formatTime(catalog.duration)],
          ["Genre", catalog.genre ?? "Unknown"],
          [
            "Release date",
            catalog.album.releaseDate?.slice(0, 10) ?? "Unknown",
          ],
          [
            "Explicitness",
            catalog.explicitness === "explicit"
              ? "Explicit"
              : catalog.explicitness === "cleaned"
                ? "Cleaned"
                : catalog.explicitness === "notExplicit"
                  ? "Not explicit"
                  : "Unknown",
          ],
          ["Storefront", STOREFRONTS[catalog.country] ?? catalog.country],
        ]
      : []),
    ...(source
      ? [
          [
            "Source duration",
            formatTime(
              audioDuration === undefined
                ? source.duration
                : audioDuration || null
            ),
          ],
          ["YouTube upload", source.title],
          ["Uploader", source.uploader ?? "Unknown"],
        ]
      : []),
  ];
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={triggerClassName}
            aria-label={label ?? `Track details for ${title}`}
          />
        }
      >
        <Info aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex items-start justify-between gap-3">
          <PopoverTitle className="min-w-0 font-semibold break-words">
            {title}
          </PopoverTitle>
          <PopoverClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close track details"
              />
            }
          >
            <X aria-hidden="true" />
          </PopoverClose>
        </div>
        <PopoverDescription className="mt-1 text-xs break-words text-muted-foreground">
          {catalog
            ? [
                catalog.artist.name ?? "Artist unknown",
                catalog.album.name ?? "Album unknown",
              ].join(" \u00b7 ")
            : "YouTube source details"}
        </PopoverDescription>
        <dl className="mt-4 space-y-3">
          {rows.map(([name, value]) => (
            <div key={name}>
              <dt className="text-xs text-muted-foreground">{name}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-col items-start gap-2">
          {catalog?.storeUrl && (
            <a
              href={catalog.storeUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              View in iTunes Store
            </a>
          )}
          {source && (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              View on YouTube
            </a>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
