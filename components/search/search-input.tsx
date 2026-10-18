"use client";
import { useState, type FormEvent } from "react";
import { Search, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_QUERY_LENGTH } from "@/lib/music/track";
import { STOREFRONTS, type Storefront } from "@/lib/music/catalog";
export function SearchInput({
  loading,
  onSearch,
  country,
  onCountryChange,
}: {
  loading: boolean;
  onSearch: (query: string) => void;
  country: Storefront;
  onCountryChange: (value: Storefront) => void;
}) {
  const [query, setQuery] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim()) onSearch(query.trim());
  }
  return (
    <form
      onSubmit={submit}
      role="search"
      className="flex flex-col gap-3 sm:flex-row"
    >
      <div className="relative flex-1">
        <Search
          aria-hidden="true"
          className="absolute top-3.5 left-4 size-5 text-muted-foreground"
        />
        <label htmlFor="music-search" className="sr-only">
          Song, artist, or album
        </label>
        <Input
          id="music-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={MAX_QUERY_LENGTH}
          required
          placeholder="Song, artist, or album"
          className="h-12 pl-12 text-base"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="sr-only">Storefront</span>
        <select
          aria-label="Storefront"
          value={country}
          onChange={(event) =>
            onCountryChange(event.target.value as Storefront)
          }
          className="h-12 w-full rounded-md border border-input bg-background px-3 focus-visible:outline-2 sm:w-40"
        >
          {Object.entries(STOREFRONTS).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={!query.trim()} className="h-12 px-8">
        {loading ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Search aria-hidden="true" />
        )}
        Search
      </Button>
    </form>
  );
}
