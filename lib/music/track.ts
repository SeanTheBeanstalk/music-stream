export interface Track {
  id: string;
  url: string;
  title: string;
  artwork: string;
  uploader: string | null;
  duration: number | null;
}
export const MAX_QUERY_LENGTH = 200;
export const isVideoId = (value: string) => /^[A-Za-z0-9_-]{11}$/.test(value);
export function normalizeTrack(value: unknown): Track | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (Array.isArray(data.entries))
    return data.entries.length ? normalizeTrack(data.entries[0]) : null;
  if (
    typeof data.id !== "string" ||
    !isVideoId(data.id) ||
    typeof data.title !== "string" ||
    !data.title.trim()
  )
    return null;
  return {
    id: data.id,
    url: `https://www.youtube.com/watch?v=${data.id}`,
    title: data.title,
    artwork: `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`,
    uploader: typeof data.uploader === "string" ? data.uploader : null,
    duration:
      typeof data.duration === "number" &&
      Number.isFinite(data.duration) &&
      data.duration > 0
        ? data.duration
        : null,
  };
}
export function formatTime(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
