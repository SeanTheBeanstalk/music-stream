"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TrackCover } from "@/components/music/track-cover";
import { Input } from "@/components/ui/input";

export function PlaylistImageField({
  file,
  artwork,
  onChange,
}: {
  file: File | null;
  artwork?: string | null;
  onChange: (file: File) => void;
}) {
  const id = useId();
  const preview = useRef<HTMLImageElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (preview.current) preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="space-y-2">
      <label htmlFor={id}>Change album image</label>
      <div className="flex items-start gap-3">
        {file ? (
          // The browser owns this temporary file URL; no image optimization is needed.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={preview}
            alt="Selected album image preview"
            className="size-20 shrink-0 rounded-sm object-cover"
          />
        ) : (
          <TrackCover src={artwork} className="size-20 rounded-sm" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <Input
            id={id}
            type="file"
            name="albumImage"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
            aria-invalid={!!error}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (!selected) return;
              if (
                !["image/jpeg", "image/png", "image/webp"].includes(
                  selected.type
                ) ||
                selected.size > 5 * 1024 * 1024
              ) {
                setError("Choose a JPG, PNG, or WebP image up to 5 MB.");
                event.target.value = "";
                return;
              }
              setError("");
              onChange(selected);
            }}
          />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {file ? file.name : "JPG, PNG, or WebP. Up to 5 MB."}
          </p>
        </div>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
