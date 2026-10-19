import type { CatalogTrack, Storefront } from "./catalog.ts";

export interface SavedSong {
  track: CatalogTrack;
  savedAt: string;
}
export interface PlaylistItem {
  id: string;
  track: CatalogTrack;
}
export interface Playlist {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  items: PlaylistItem[];
}
export interface Library {
  user: { name: string } | null;
  likes: SavedSong[];
  playlists: Playlist[];
}
export type LibraryCommand =
  | { action: "like"; trackId: number; country: Storefront; liked: boolean }
  | { action: "create"; name: string }
  | { action: "rename"; playlistId: string; revision: number; name: string }
  | { action: "delete"; playlistId: string; revision: number }
  | {
      action: "add";
      playlistId: string;
      revision: number;
      trackId: number;
      country: Storefront;
    }
  | { action: "remove"; playlistId: string; revision: number; itemId: string }
  | {
      action: "reorder";
      playlistId: string;
      revision: number;
      itemIds: string[];
    };
export const songKey = (track: CatalogTrack) => `${track.id}:${track.country}`;
