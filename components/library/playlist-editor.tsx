"use client";
import { useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  PopoverClose,
} from "@/components/ui/popover";
import type { Playlist } from "@/lib/music/library";
import { useLibrary } from "./library-provider";

export function PlaylistEditor({ playlist }: { playlist?: Playlist }) {
  const { mutate, busy } = useLibrary();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  async function remove() {
    if (!playlist) return;
    try {
      await mutate({
        action: "delete",
        playlistId: playlist.id,
        revision: playlist.revision,
      });
      setOpen(false);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to delete playlist."
      );
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setConfirm(false);
        setMessage("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant={playlist ? "ghost" : "default"}
            size={playlist ? "icon" : "default"}
            aria-label={playlist ? `Edit ${playlist.name}` : undefined}
          />
        }
      >
        {playlist ? (
          <MoreHorizontal aria-hidden="true" />
        ) : (
          <>
            <Plus aria-hidden="true" />
            Create playlist
          </>
        )}
      </PopoverTrigger>
      <PopoverContent>
        <PopoverTitle className="mb-4 font-semibold">
          {playlist ? "Edit playlist" : "Create playlist"}
        </PopoverTitle>
        {confirm ? (
          <div className="space-y-4">
            <p>
              Delete “{playlist?.name}”? This removes the playlist and its
              entries from your library.
            </p>
            <Button
              disabled={busy}
              variant="destructive"
              onClick={() => void remove()}
            >
              Delete playlist
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = String(new FormData(e.currentTarget).get("name"));
                try {
                  await mutate(
                    playlist
                      ? {
                          action: "rename",
                          playlistId: playlist.id,
                          revision: playlist.revision,
                          name,
                        }
                      : { action: "create", name }
                  );
                  setOpen(false);
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Unable to save playlist."
                  );
                }
              }}
            >
              <label className="block space-y-2">
                Playlist name
                <Input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={playlist?.name ?? ""}
                  autoFocus
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {playlist ? "Rename" : "Create"}
                </Button>
                <PopoverClose render={<Button variant="ghost" />}>
                  Cancel
                </PopoverClose>
              </div>
            </form>
            {playlist && (
              <Button
                className="mt-4"
                variant="destructive"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                Delete playlist
              </Button>
            )}
          </>
        )}
        <p role="status" className="mt-2 text-sm text-destructive">
          {message}
        </p>
      </PopoverContent>
    </Popover>
  );
}
