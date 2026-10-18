import type { CatalogTrack } from "./catalog.ts";
import type { Track } from "./track.ts";
const words = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const contains = (haystack: string, needle: string) =>
  ` ${haystack} `.includes(` ${needle} `);
// Recording descriptors are parsed separately from the song's identity.
const variants = [
  ["sped-up", /\b(?:sped up|speed up|speeded up|nightcore)\b/],
  ["slowed", /\b(?:slowed(?: down)?|slow(?:ed)? and reverb)\b/],
  ["live", /\blive\b/],
  ["remix", /\bremix\b/],
  ["acoustic", /\bacoustic\b/],
  ["instrumental", /\binstrumental\b/],
  ["karaoke", /\bkaraoke\b/],
  ["cover", /\bcover\b/],
  ["radio", /\bradio (?:edit|version|mix)\b/],
  ["extended", /\bextended(?: mix| edit| version)?\b/],
  ["demo", /\bdemo\b/],
  ["remaster", /\bremaster(?:ed)?\b/],
  ["clean", /\bclean(?:ed)?\b/],
  ["explicit", /\bexplicit\b/],
] as const;
const presentation =
  /^(?:(?:official|audio|video|music|lyric|lyrics|visualizer|hd|hq|4k)\s*)+$/;

export function parseTitle(value: string) {
  const versions = new Set<string>();
  const details: string[] = [];
  const stripDescriptor = (segment: string): string | null => {
    const normalized = words(segment);
    if (/^(?:feat|ft|featuring)\b/.test(normalized)) return "";
    const found = variants.filter(([, pattern]) => pattern.test(normalized));
    if (!found.length) return presentation.test(normalized) ? "" : null;
    if (
      found.some(([kind]) => kind === "live") &&
      !/^live(?:$| (?:version|recording|performance|at|from|in|on)\b)/.test(
        normalized
      )
    )
      return null;
    if (!found.some(([kind]) => kind === "live" || kind === "remix")) {
      let remainder = normalized;
      for (const [, pattern] of found)
        remainder = remainder.replace(pattern, " ");
      remainder = remainder.replace(
        /\b(?:version|edit|mix|recording|performance|piano|guitar|reverb|and|\d+)\b/g,
        " "
      );
      if (remainder.trim()) return null;
    }
    for (const [kind] of found) versions.add(kind);
    if (found.some(([kind]) => kind === "remix")) {
      const remixer = words(
        normalized.replace(/\b(?:remix|version|mix|edit)\b/g, " ")
      );
      if (remixer) details.push(remixer);
    }
    return "";
  };
  let base = value.replace(
    /\(([^()]*)\)|\[([^\[\]]*)\]/g,
    (full, round: string | undefined, square: string | undefined) =>
      stripDescriptor(round ?? square ?? "") === null ? full : " "
  );
  // Preserve unknown subtitles and core words like "Live and Let Die".
  base = base.replace(/\s+[-–—|]\s+([^–—|]+)$/, (full, suffix: string) => {
    if (
      !/^(?:\d{4}\s+)?(?:sped up|speed up|speeded up|nightcore|slowed|live|acoustic|instrumental|karaoke|radio|extended|demo|remastered?|clean(?:ed)?|explicit|official|lyrics?|audio|video)\b/.test(
        words(suffix)
      )
    )
      return full;
    return stripDescriptor(suffix) === null ? full : " ";
  });
  base = base.replace(/\b(?:feat\.?|ft\.?|featuring)\s+.+$/i, " ");
  base = base.replace(
    /\b(?:sped[ -]up|speed[ -]up|speeded[ -]up|nightcore|slowed(?: down)?)(?:\s+(?:version|edit|and reverb))?\s*$/i,
    (suffix) => {
      stripDescriptor(suffix);
      return " ";
    }
  );
  // Also recognize common trailing upload labels without brackets.
  base = base.replace(
    /\s+(live|acoustic|instrumental|karaoke|remix|cover|demo|radio (?:edit|version|mix)|extended (?:edit|version|mix)|remastered)(?:\s+version)?\s*$/i,
    (_, suffix: string) => {
      stripDescriptor(suffix);
      return " ";
    }
  );
  return { base: words(base), versions, details };
}
const primaryArtist = (value: string) =>
  value.split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim();

export function playbackSearchQueries(catalog: CatalogTrack): string[] {
  const artist = catalog.artist.name?.trim();
  const parsed = parseTitle(catalog.title);
  if (!artist || !parsed.base) return [];
  return [
    ...new Set([
      `${artist} ${catalog.title}`,
      `${primaryArtist(artist)} ${parsed.base}`,
    ]),
  ].filter(
    (query, index, all) =>
      all.findIndex((other) => words(other) === words(query)) === index
  );
}

// Mandatory title/artist evidence plus compatible recording versions. Duration
// supports ranking; equal scores retain YouTube order.
export function matchCandidates(
  catalog: CatalogTrack,
  candidates: Track[]
): Track | null {
  const expected = parseTitle(catalog.title);
  const artist = words(primaryArtist(catalog.artist.name ?? ""));
  if (!expected.base || !artist) return null;
  let best: Track | null = null;
  const minimumScore = 84;
  let bestScore = 0;
  for (const candidate of candidates) {
    const actual = parseTitle(candidate.title);
    if (
      !contains(words(`${candidate.title} ${candidate.uploader ?? ""}`), artist)
    )
      continue;
    const tokens = expected.base.split(" ");
    const actualTokens = new Set(actual.base.split(" "));
    const phrase = contains(actual.base, expected.base);
    if (
      !phrase &&
      (tokens.length < 3 || !tokens.every((token) => actualTokens.has(token)))
    )
      continue;
    const identityVersions = (set: Set<string>) =>
      [...set].filter((v) => v !== "remaster");
    if (
      identityVersions(expected.versions).some(
        (v) => !actual.versions.has(v)
      ) ||
      identityVersions(actual.versions).some((v) => !expected.versions.has(v))
    )
      continue;
    if (
      expected.details.some(
        (detail) => !contains(words(candidate.title), detail)
      )
    )
      continue;
    let score = (phrase ? 60 : 54) + 30;
    if (
      expected.versions.size &&
      [...expected.versions].every((v) => actual.versions.has(v))
    )
      score += 5;
    if (catalog.duration && candidate.duration) {
      const difference =
        Math.abs(catalog.duration - candidate.duration) / catalog.duration;
      score += Math.max(0, 5 * (1 - difference / 0.15));
    }
    if (score >= minimumScore && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
