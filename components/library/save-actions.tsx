"use client";
import Link from "next/link";
import { useState } from "react";
import { Heart, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CatalogTrack } from "@/lib/music/catalog";
import { songKey } from "@/lib/music/library";
import { useLibrary } from "./library-provider";

export function SaveActions({ track }: { track: CatalogTrack }) {
  const { library, mutate, busy, loading } = useLibrary();
  const [message, setMessage] = useState("");
  const liked = library.likes.some(
    (song) => songKey(song.track) === songKey(track)
  );
  async function save(playlistId?: string) {
    if (!library.user) {
      setMessage("Sign in from Library to save music.");
      return;
    }
    try {
      if (playlistId) {
        const playlist = library.playlists.find((p) => p.id === playlistId)!;
        await mutate({
          action: "add",
          playlistId,
          revision: playlist.revision,
          trackId: track.trackId,
          country: track.country,
        });
        setMessage(`Added to ${playlist.name}.`);
      } else {
        await mutate({
          action: "like",
          liked: !liked,
          trackId: track.trackId,
          country: track.country,
        });
        setMessage(
          liked ? "Removed from liked songs." : "Saved to liked songs."
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save. Please retry."
      );
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          disabled={busy || loading}
          aria-pressed={liked}
          onClick={() => void save()}
        >
          <Heart
            aria-hidden="true"
            className={liked ? "fill-current text-violet-500" : ""}
          />
          {liked ? "Liked" : "Like"}
        </Button>
        <Popover>
          <PopoverTrigger
            render={<Button variant="ghost" disabled={busy || loading} />}
          >
            <ListPlus aria-hidden="true" />
            Add to playlist
          </PopoverTrigger>
          <PopoverContent>
            <PopoverTitle className="mb-3 font-semibold">
              Add to playlist
            </PopoverTitle>
            {!library.user ? (
              <Link href="/library" className="underline">
                Sign in to save music
              </Link>
            ) : library.playlists.length === 0 ? (
              <Link href="/library" className="underline">
                Create your first playlist in Library
              </Link>
            ) : (
              <div className="grid gap-1">
                {library.playlists.map((p) => (
                  <Button
                    key={p.id}
                    variant="ghost"
                    className="h-auto min-h-10 justify-start break-all whitespace-normal"
                    disabled={busy}
                    onClick={() => void save(p.id)}
                  >
                    {p.name}
                  </Button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
        {!library.user && message && (
          <>
            {" "}
            <Link className="underline" href="/library">
              Open Library
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
