"use client";
import { useState, type FormEvent } from "react";
import { Search, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      <Select
        value={country}
        onValueChange={(value) => {
          if (value) onCountryChange(value);
        }}
        items={STOREFRONTS}
      >
        <SelectTrigger
          aria-label="Storefront"
          className="w-full data-[size=default]:h-12 sm:w-40"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(STOREFRONTS).map(([code, name]) => (
            <SelectItem key={code} value={code}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
