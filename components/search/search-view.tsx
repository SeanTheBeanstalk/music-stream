"use client";
import { useEffect, useRef, useState } from "react";
import { Search, LoaderCircle } from "lucide-react";
import { SearchInput } from "./search-input";
import { SearchResult } from "./search-result";
import {
  STOREFRONTS,
  type CatalogTrack,
  type Storefront,
} from "@/lib/music/catalog";
type SearchState = {
  status: "initial" | "loading" | "empty" | "error" | "success";
  tracks?: CatalogTrack[];
  message?: string;
  query?: string;
};
export function SearchView({ defaultCountry }: { defaultCountry: Storefront }) {
  const [country, setCountry] = useState(defaultCountry);
  const [state, setState] = useState<SearchState>({ status: "initial" });
  const pending = useRef<AbortController | null>(null);
  const pendingActionRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      pendingActionRef.current?.abort();
    },
    []
  );
  async function search(query: string) {
    pending.current?.abort();
    pendingActionRef.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ status: "loading", query });
    try {
      const response = await fetch(
        `/api/search?${new URLSearchParams({ q: query, country })}`,
        { signal: controller.signal }
      );
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok)
        throw new Error(data.error || "Search failed. Please try again.");
      setState({
        status: data.tracks.length ? "success" : "empty",
        tracks: data.tracks,
        query,
      });
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
          Search the iTunes catalog by song, artist, or album. Play a matching
          YouTube upload.
        </p>
      </header>
      <SearchInput
        loading={state.status === "loading"}
        onSearch={search}
        country={country}
        onCountryChange={(value) => {
          pending.current?.abort();
          pendingActionRef.current?.abort();
          setCountry(value);
          setState({ status: "initial" });
        }}
      />
      <p className="text-xs text-muted-foreground">
        Catalog: iTunes &middot; {STOREFRONTS[country]}. Playback: YouTube.
        Uncertain matches will require another selection.
      </p>
      <div
        aria-live="polite"
        aria-busy={state.status === "loading"}
        className="space-y-4"
      >
        {state.status === "success" ? (
          <>
            <p className="text-sm text-muted-foreground">
              {state.tracks!.length} songs found
            </p>
            {state.tracks!.map((track) => (
              <SearchResult
                key={`${track.country}:${track.id}`}
                track={track}
                pendingActionRef={pendingActionRef}
              />
            ))}
          </>
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
                  ? "Searching iTunes..."
                  : state.status === "empty"
                    ? "No track found"
                    : "Unable to search"}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {state.status === "error"
                ? state.message
                : state.status === "empty"
                  ? `No result for "${state.query}". Try another song, artist, or storefront.`
                  : state.status === "initial"
                    ? "Search to find a track to play or queue."
                    : "Your current music will keep playing."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
