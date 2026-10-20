"use client";

import Image from "next/image";
import { Music2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { artworkUrl } from "@/lib/music/artwork";

export function TrackCover({
  src,
  className,
}: {
  src?: string | null;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const coverSrc = artworkUrl(src);
  return (
    <div
      className={cn(
        "relative flex size-12 shrink-0 items-center justify-center overflow-hidden bg-muted text-muted-foreground",
        className
      )}
      aria-hidden="true"
    >
      {coverSrc && coverSrc !== failedSrc ? (
        <Image
          key={coverSrc}
          src={coverSrc}
          alt=""
          fill
          sizes="96px"
          className="object-cover"
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(coverSrc)}
        />
      ) : (
        <Music2 className="size-1/2" />
      )}
    </div>
  );
}
