"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { usePlayback } from "@/components/playback/playback-provider";
import type { PlaylistItem } from "@/lib/music/library";
import type { Track } from "@/lib/music/track";

export function usePlaylistPlayback() {
  const { playMany } = usePlayback();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => pending.current?.abort(), []);

  async function start(songs: PlaylistItem[], shuffle: boolean) {
    if (!songs.length) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    const notification = toast.loading("Preparing playlist...");
    const dismiss = () => toast.dismiss(notification);
    controller.signal.addEventListener("abort", dismiss, { once: true });
    const ordered = [...songs];
    if (shuffle) {
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
    }
    try {
      const resolved: Track[] = [];
      const sources = new Map<string, Track>();
      for (const { track } of ordered) {
        const key = `${track.trackId}:${track.country}`;
        let source = sources.get(key);
        if (!source) {
          const response = await fetch(
            `/api/resolve?id=${track.trackId}&country=${track.country}`,
            { signal: controller.signal }
          );
          const data = await response.json();
          if (!response.ok)
            throw new Error(
              data.error || `Unable to play ${track.title}. Please retry.`
            );
          source = data.track as Track;
          sources.set(key, source);
        }
        resolved.push(source);
      }
      if (controller.signal.aborted) return;
      playMany(resolved);
      toast.success(
        shuffle
          ? "Playlist shuffled and selected for playback."
          : "Playlist selected for playback.",
        { id: notification }
      );
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to play playlist. Please retry.",
          { id: notification }
        );
    } finally {
      controller.signal.removeEventListener("abort", dismiss);
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return { start, busy };
}
