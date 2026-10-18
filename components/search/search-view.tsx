"use client";
import { useEffect, useRef, useState } from "react";
import { Search, LoaderCircle } from "lucide-react";
import { SearchInput } from "./search-input";
import { SearchResult } from "./search-result";
import type { Track } from "@/lib/music/track";
type SearchState = {
  status: "initial" | "loading" | "empty" | "error" | "success";
  track?: Track;
  message?: string;
  query?: string;
};
export function SearchView() {
  const [state, setState] = useState<SearchState>({ status: "initial" });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function search(query: string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ status: "loading", query });
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}`,
        { signal: controller.signal }
      );
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok)
        throw new Error(data.error || "Search failed. Please try again.");
      setState(
        data.track
          ? { status: "success", track: data.track, query }
          : { status: "empty", query }
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Search failed. Please try again.",
          query,
        });
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-3">
        <p className="text-xs tracking-[0.25em] text-muted-foreground uppercase">
          Find your next listen
        </p>
        <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          Search
        </h1>
        <p className="max-w-xl text-muted-foreground">
          A song you love. An artist you just discovered. Start with a search.
        </p>
      </header>
      <SearchInput loading={state.status === "loading"} onSearch={search} />
      <p className="text-xs text-muted-foreground">
        We select the first YouTube result. Check the upload before pressing
        Play.
      </p>
      <div aria-live="polite" aria-busy={state.status === "loading"}>
        {state.status === "success" && state.track ? (
          <SearchResult track={state.track} />
        ) : (
          <div className="flex min-h-60 flex-col items-center justify-center gap-4 border border-dashed p-8 text-center">
            {state.status === "loading" ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-8 animate-spin text-muted-foreground"
              />
            ) : (
              <Search
                aria-hidden="true"
                className="size-8 text-muted-foreground"
              />
            )}
            <h2 className="text-lg font-medium">
              {state.status === "initial"
                ? "Your next track is a search away"
                : state.status === "loading"
                  ? "Searching YouTube…"
                  : state.status === "empty"
                    ? "No track found"
                    : "Unable to search"}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {state.status === "error"
                ? state.message
                : state.status === "empty"
                  ? `No result for “${state.query}”. Try another song or artist.`
                  : state.status === "initial"
                    ? "Search by song, artist, or album to find a track to play or queue."
                    : "Your current music will keep playing."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
