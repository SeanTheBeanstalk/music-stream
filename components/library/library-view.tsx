"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Heart,
  LayoutGrid,
  List,
  Music2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrackCover } from "@/components/music/track-cover";
import { cn } from "@/lib/utils";
import { songKey } from "@/lib/music/library";
import { AccountForm } from "./account-form";
import { useLibrary } from "./library-provider";
import { PlaylistEditor } from "./playlist-editor";
import { LibrarySongs } from "./library-songs";

export function LibraryView() {
  const { library, loading, error, refresh } = useLibrary();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [list, setList] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const playlist = library.playlists.find((p) => p.id === selected);
  const liked = selected === "likes";
  const detail = liked || !!playlist;
  const playlists = library.playlists
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.updatedAt.localeCompare(a.updatedAt)
    );
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      {!detail && (
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
              Your Library
            </h1>
            <p className="mt-3 text-muted-foreground">
              Your liked songs and playlists, all in one place.
            </p>
          </div>
        </header>
      )}
      {loading ? (
        <p role="status">Loading your library…</p>
      ) : error ? (
        <div role="alert" className="space-y-3 border p-5">
          <p>{error}</p>
          <Button variant="outline" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      ) : !library.user ? (
        <AccountForm />
      ) : (
        <>
          {detail ? (
            <section className="space-y-6">
              <Button variant="ghost" onClick={() => setSelected(null)}>
                <ArrowLeft aria-hidden="true" />
                Back to library
              </Button>
              <LibrarySongs
                key={selected}
                songs={
                  liked
                    ? library.likes.map((s) => ({
                        id: songKey(s.track),
                        track: s.track,
                      }))
                    : playlist!.items
                }
                playlist={playlist}
              />
              <Link
                href="/search"
                className="inline-flex items-center gap-2 text-sm underline"
              >
                <Search aria-hidden="true" className="size-4" />
                Find more music
              </Link>
            </section>
          ) : (
            <>
              <div
                className="flex flex-wrap gap-2 border-b"
                aria-label="Library filters"
              >
                {[
                  ["all", "All"],
                  ["playlists", "Playlists"],
                  ["likes", "Liked songs"],
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    variant="ghost"
                    aria-pressed={tab === value}
                    onClick={() => setTab(value)}
                    className={cn(
                      "border-b-2 border-transparent",
                      tab === value && "border-foreground"
                    )}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="relative min-w-0 flex-1 basis-56">
                  <span className="sr-only">Search your library</span>
                  <Search
                    aria-hidden="true"
                    className="absolute top-3 left-3 size-4 text-muted-foreground"
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search your library"
                    className="pl-10"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <span className="sr-only">Sort library</span>
                  <select
                    className="h-10 max-w-full border bg-background px-3 focus-visible:outline-2"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="recent">Recently updated</option>
                    <option value="name">Name</option>
                  </select>
                </label>
                <div className="flex gap-1">
                  <Button
                    variant={list ? "ghost" : "secondary"}
                    size="icon"
                    aria-label="Grid view"
                    aria-pressed={!list}
                    onClick={() => setList(false)}
                  >
                    <LayoutGrid aria-hidden="true" />
                  </Button>
                  <Button
                    variant={list ? "secondary" : "ghost"}
                    size="icon"
                    aria-label="List view"
                    aria-pressed={list}
                    onClick={() => setList(true)}
                  >
                    <List aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div
                className={cn(
                  "grid gap-6",
                  !list &&
                    "grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                )}
              >
                {tab !== "playlists" &&
                  "liked songs".includes(query.trim().toLowerCase()) && (
                    <article
                      className={cn(
                        list && "flex items-center gap-4 border p-3"
                      )}
                    >
                      <button
                        className={cn(
                          "flex items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-violet-300 text-white focus-visible:outline-2 focus-visible:outline-offset-4",
                          list ? "size-20 shrink-0" : "aspect-square w-full"
                        )}
                        aria-label="Open Liked Songs"
                        onClick={() => setSelected("likes")}
                      >
                        <Heart
                          aria-hidden="true"
                          className={cn(
                            "fill-current",
                            list ? "size-8" : "size-20"
                          )}
                        />
                      </button>
                      <div className="mt-3 min-w-0">
                        <button
                          className="text-left font-semibold focus-visible:outline-2"
                          onClick={() => setSelected("likes")}
                        >
                          Liked Songs
                        </button>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {library.likes.length} songs
                        </p>
                      </div>
                    </article>
                  )}
                {tab !== "likes" &&
                  playlists.map((p) => (
                    <article
                      key={p.id}
                      className={cn(
                        "min-w-0",
                        list && "flex items-center gap-4 border p-3"
                      )}
                    >
                      <button
                        aria-label={`Open ${p.name}`}
                        onClick={() => setSelected(p.id)}
                        className={cn(
                          "overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4",
                          list ? "size-20 shrink-0" : "aspect-square w-full"
                        )}
                      >
                        {p.items[0]?.track.artwork ? (
                          <TrackCover
                            src={p.items[0].track.artwork}
                            className="size-full"
                          />
                        ) : (
                          <span className="flex size-full items-center justify-center bg-gradient-to-br from-slate-700 to-teal-600 text-white">
                            <Music2
                              aria-hidden="true"
                              className={list ? "size-8" : "size-16"}
                            />
                          </span>
                        )}
                      </button>
                      <div className="mt-3 flex min-w-0 flex-1 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button
                            className="text-left font-semibold wrap-break-word focus-visible:outline-2"
                            onClick={() => setSelected(p.id)}
                          >
                            {p.name}
                          </button>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {p.items.length} songs
                          </p>
                        </div>
                        <PlaylistEditor playlist={p} />
                      </div>
                    </article>
                  ))}
                {tab !== "likes" && (
                  <PlaylistEditor layout={list ? "list" : "grid"} />
                )}
              </div>
              {tab !== "likes" && playlists.length === 0 && (
                <p className="border border-dashed p-6 text-muted-foreground">
                  {query
                    ? "No playlists match your search."
                    : "Make room for your favorites. Create a playlist, then add songs from Search."}
                </p>
              )}
              {tab === "likes" &&
                !"liked songs".includes(query.trim().toLowerCase()) && (
                  <p className="text-muted-foreground">
                    No matches. Clear your search to see Liked Songs.
                  </p>
                )}
            </>
          )}
        </>
      )}
    </div>
  );
}
