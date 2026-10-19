"use client";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import type { Playlist } from "@/lib/music/library";
import { useLibrary } from "./library-provider";
import { PlaylistImageField } from "./playlist-image-field";

export function PlaylistEditor({
  playlist,
  layout = "button",
}: {
  playlist?: Playlist;
  layout?: "button" | "grid" | "list";
}) {
  const tile = !playlist && layout !== "button";
  const { mutate, busy } = useLibrary();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  // Description stays local until playlist metadata persistence is extended.
  const [description, setDescription] = useState("");
  const [draftName, setDraftName] = useState(playlist?.name ?? "");
  const [draftDescription, setDraftDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [draftImage, setDraftImage] = useState<File | null>(null);
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
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setDraftName(playlist?.name ?? "");
          setDraftDescription(description);
          setDraftImage(image);
        }
        setOpen(value);
        setConfirm(false);
        setMessage("");
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant={tile ? "outline" : playlist ? "ghost" : "default"}
            size={playlist ? "icon" : "default"}
            aria-label={playlist ? `Edit ${playlist.name}` : undefined}
            className={cn(
              tile &&
                "w-full rounded-lg border-dashed text-sm font-medium tracking-normal whitespace-normal text-muted-foreground normal-case hover:text-foreground",
              tile &&
                layout === "grid" &&
                "aspect-square h-auto flex-col gap-4 self-start p-6",
              tile && layout === "list" && "h-auto min-h-26 gap-4 p-3"
            )}
          />
        }
      >
        {playlist ? (
          <Pencil aria-hidden="true" />
        ) : (
          <>
            <Plus
              aria-hidden="true"
              className={tile ? "size-12 rounded-full border p-2" : undefined}
            />
            Create playlist
          </>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader className="pr-10">
          <DialogTitle>
            {playlist ? "Edit playlist" : "Create playlist"}
          </DialogTitle>
          <DialogDescription>
            {confirm
              ? "Confirm playlist deletion."
              : "Give your playlist a name, description, and album image."}
          </DialogDescription>
        </DialogHeader>
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
                const fields = new FormData(e.currentTarget);
                const name = String(fields.get("name"));
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
                  setDescription(
                    playlist ? String(fields.get("description") ?? "") : ""
                  );
                  setImage(playlist ? draftImage : null);
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
                <span>Name</span>
                <Input
                  name="name"
                  required
                  maxLength={100}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  autoFocus
                />
              </label>
              <label className="block space-y-2">
                <span>Description</span>
                <Textarea
                  name="description"
                  value={draftDescription}
                  onChange={(event) => setDraftDescription(event.target.value)}
                  placeholder="Add a description"
                  rows={3}
                  className="max-h-48 overflow-y-auto"
                />
              </label>
              <PlaylistImageField
                file={draftImage}
                artwork={playlist?.items[0]?.track.artwork}
                onChange={setDraftImage}
              />
              <DialogFooter>
                <DialogClose render={<Button variant="ghost" />}>
                  Cancel
                </DialogClose>
                <Button type="submit" disabled={busy}>
                  {playlist ? "Save changes" : "Create"}
                </Button>
              </DialogFooter>
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
      </DialogContent>
    </Dialog>
  );
}
