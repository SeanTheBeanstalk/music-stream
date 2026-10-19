"use client";

import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSaveActions } from "@/components/library/save-actions";
import { useTrackActions } from "./track-actions";

export function SearchActions(props: Parameters<typeof useTrackActions>[0]) {
  const playback = useTrackActions(props);
  const saving = useSaveActions(props.track);
  const saveDisabled = saving.busy || saving.loading;

  return (
    <div className="space-y-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1"
            />
          }
          aria-label={`Actions for ${props.track.title}`}
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={playback.busy}
            onClick={() => void playback.resolve("play")}
          >
            Play
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={playback.busy}
            onClick={() => void playback.resolve("enqueue")}
          >
            Add to queue
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={saveDisabled}
            onClick={() => void saving.save()}
          >
            {saving.liked ? "Unlike" : "Like"}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={saveDisabled}>
              Add to playlist
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-[calc(100vw-1.5rem)]">
              {!saving.library.user ? (
                <DropdownMenuItem render={<Link href="/library" />}>
                  Sign in to save music
                </DropdownMenuItem>
              ) : saving.library.playlists.length === 0 ? (
                <DropdownMenuItem render={<Link href="/library" />}>
                  Create your first playlist in Library
                </DropdownMenuItem>
              ) : (
                saving.library.playlists.map((playlist) => (
                  <DropdownMenuItem
                    key={playlist.id}
                    className="min-h-10 break-all whitespace-normal"
                    disabled={saveDisabled}
                    onClick={() => void saving.save(playlist.id)}
                  >
                    {playlist.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {playback.message}
      </p>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {saving.message}
        {!saving.library.user && saving.message && (
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
