import "server-only";
import { catalogId, storefront } from "../music/catalog.ts";
import type { LibraryCommand } from "../music/library.ts";

export class LibraryError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function playlistName(v: unknown): string {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(v)
  )
    throw new LibraryError("Use a playlist name between 1 and 100 characters.");
  return v.trim();
}
export function parseCommand(value: unknown): LibraryCommand {
  if (!value || typeof value !== "object")
    throw new LibraryError("Invalid library operation.");
  const v = value as Record<string, unknown>;
  if (v.action === "create")
    return { action: "create", name: playlistName(v.name) };
  if (v.action === "like" || v.action === "add") {
    if (
      !catalogId(v.trackId) ||
      typeof v.country !== "string" ||
      !storefront(v.country)
    )
      throw new LibraryError("Invalid song identity.");
  }
  if (v.action === "like") {
    if (typeof v.liked !== "boolean")
      throw new LibraryError("Invalid like state.");
    return {
      action: "like",
      trackId: v.trackId as number,
      country: storefront(v.country as string)!,
      liked: v.liked,
    };
  }
  if (
    !uuid(v.playlistId) ||
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 0
  )
    throw new LibraryError("Invalid playlist identity or revision.");
  const base = { playlistId: v.playlistId, revision: v.revision as number };
  switch (v.action) {
    case "rename":
      return { ...base, action: "rename", name: playlistName(v.name) };
    case "delete":
      return { ...base, action: "delete" };
    case "add":
      return {
        ...base,
        action: "add",
        trackId: v.trackId as number,
        country: storefront(v.country as string)!,
      };
    case "remove":
      if (!uuid(v.itemId)) throw new LibraryError("Invalid playlist item.");
      return { ...base, action: "remove", itemId: v.itemId };
    case "reorder":
      if (
        !Array.isArray(v.itemIds) ||
        v.itemIds.length > 1000 ||
        !v.itemIds.every(uuid) ||
        new Set(v.itemIds).size !== v.itemIds.length
      )
        throw new LibraryError("Invalid playlist order.");
      return { ...base, action: "reorder", itemIds: v.itemIds };
    default:
      throw new LibraryError("Unknown library operation.");
  }
}
export function sameOrigin(request: Request) {
  // Next may construct request.url with its internal hostname (localhost).
  // Host is the browser-facing authority, including the port.
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  let valid = false;
  try {
    const incoming = new URL(origin ?? "");
    valid =
      incoming.host === (request.headers.get("host") ?? url.host) &&
      incoming.protocol === url.protocol &&
      incoming.origin === origin;
  } catch {}
  if (!valid) throw new LibraryError("Request origin is not allowed.", 403);
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new LibraryError("Expected JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new LibraryError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new LibraryError("Request is too large.", 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof LibraryError) throw error;
    throw new LibraryError("Invalid JSON.");
  } finally {
    reader.releaseLock();
  }
}
