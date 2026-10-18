import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCatalog, storefront } from "../lib/music/catalog.ts";
import { trackDetails } from "../lib/music/track-details.ts";
import { matchCandidates } from "../lib/music/matching.ts";
import { normalizeTrack } from "../lib/music/track.ts";
import { createRequestCache } from "../lib/server/request-cache.ts";
import { createCatalogClient } from "../lib/server/itunes.ts";
import { queueReducer, emptyQueue } from "../lib/music/queue.ts";
const row = {
  kind: "song",
  trackId: 123,
  trackName: "Test Song",
  artistId: 4,
  artistName: "The Artist",
  collectionId: 5,
  collectionName: "Album",
  trackTimeMillis: 200000,
  trackExplicitness: "explicit",
  trackViewUrl: "https://music.apple.com/us/album/test/123",
};
const catalog = normalizeCatalog(row, "US");
const candidate = (
  title = "The Artist - Test Song (Official Audio)",
  uploader = "The Artist - Topic",
  duration = 200
) => normalizeTrack({ id: "dQw4w9WgXcQ", title, uploader, duration });
test("catalog identity, structured artist/album provenance, unknown fields and asset exclusion", () => {
  assert.equal(catalog.id, "itunes:123");
  assert.equal(catalog.artist.id, 4);
  assert.equal(catalog.album.country, "US");
  assert.equal(catalog.duration, 200);
  const minimal = normalizeCatalog(
    {
      kind: "song",
      trackId: 1,
      trackName: "Song",
      artworkUrl100: "https://example.com/art",
      previewUrl: "https://example.com/audio",
      trackViewUrl: "javascript:alert(1)",
    },
    "SG"
  );
  assert.equal(minimal.artist.name, null);
  assert.equal(minimal.album.releaseDate, null);
  assert.equal(minimal.storeUrl, null);
  assert.equal("artwork" in minimal, false);
  assert.equal("previewUrl" in minimal, false);
  assert.equal(normalizeCatalog({ ...row, trackId: -1 }, "US"), null);
  assert.equal(normalizeCatalog({ ...row, kind: "music-video" }, "US"), null);
  assert.equal(storefront("sg"), "SG");
  assert.equal(storefront("ZZ"), null);
});
test("matching selects the highest YouTube result with the catalog title and artist", () => {
  const unrelated = candidate("Someone - Another Song", "Someone");
  const top = candidate("The Artist - Test Song (Live)", "Fan upload", 500);
  const lower = { ...candidate(), id: "rboiHxBqdZk" };
  assert.equal(matchCandidates(catalog, [unrelated, top, lower]), top);
  assert.equal(matchCandidates(catalog, [lower, top]), lower);
  assert.equal(
    matchCandidates(catalog, [candidate("Someone - Test Song", "Someone")]),
    null
  );
  assert.equal(
    matchCandidates(catalog, [candidate("The Artist - Another Song")]),
    null
  );
  assert.equal(matchCandidates(catalog, []), null);
});
test("matching ignores duration, version and explicitness restrictions", () => {
  for (const marker of [
    "Live",
    "Remix",
    "Cover",
    "Karaoke",
    "Acoustic",
    "Clean",
    "Slowed",
  ]) {
    const source = candidate(
      `The Artist - Test Song (${marker})`,
      "Fan upload",
      null
    );
    assert.equal(
      matchCandidates({ ...catalog, duration: null }, [source]),
      source
    );
  }
  const source = candidate(undefined, undefined, 500);
  assert.equal(
    matchCandidates({ ...catalog, explicitness: "cleaned" }, [source]),
    source
  );
});
test("matching normalizes punctuation, accents and case and allows uploader artist attribution", () => {
  const source = candidate("TEST: SONG (Official Audio)", "The Artist - Topic");
  assert.equal(
    matchCandidates({ ...catalog, title: "T\u00e9st Song" }, [source]),
    source
  );
  assert.equal(
    matchCandidates({ ...catalog, artist: { ...catalog.artist, name: null } }, [
      source,
    ]),
    null
  );
  assert.equal(matchCandidates({ ...catalog, title: "" }, [source]), null);
  assert.equal(
    matchCandidates(catalog, [candidate("The Artists - Test Song", "Someone")]),
    null
  );
});
test("resolved entries retain independent catalog/video identities and legacy queue compatibility", () => {
  const resolved = { ...candidate(), catalog };
  let queue = queueReducer(emptyQueue, { type: "play", track: candidate() });
  queue = queueReducer(queue, { type: "enqueue", track: resolved });
  queue = queueReducer(queue, { type: "enqueue", track: resolved });
  assert.equal(queue.tracks.length, 3);
  assert.equal(queue.tracks[0].catalog, undefined);
  assert.equal(queue.tracks[1].catalog.id, "itunes:123");
  assert.equal(queue.tracks[1].id, "dQw4w9WgXcQ");
});
test("cache coalesces, isolates cancellation, evicts and expires", async () => {
  const get = createRequestCache(1, 10);
  let finish;
  let upstream;
  let calls = 0;
  const load = (signal) => {
    calls++;
    upstream = signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const first = new AbortController();
  const second = new AbortController();
  const a = get("a", load, first.signal);
  const b = get("a", load, second.signal);
  await Promise.resolve();
  first.abort();
  await assert.rejects(a);
  assert.equal(upstream.aborted, false);
  finish(1);
  assert.equal(await b, 1);
  assert.equal(await get("a", load, second.signal), 1);
  assert.equal(calls, 1);
  await get("b", async () => 2, second.signal);
  assert.equal(await get("a", async () => 3, second.signal), 3);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(await get("a", async () => 4, second.signal), 4);
});
test("last subscriber cancels upstream and failures are retryable", async () => {
  const get = createRequestCache();
  const controller = new AbortController();
  let upstream;
  const pending = get(
    "x",
    (signal) => {
      upstream = signal;
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason))
      );
    },
    controller.signal
  );
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending);
  assert.equal(upstream.aborted, true);
  assert.equal(await get("x", async () => 2, new AbortController().signal), 2);
});
test("catalog request parameters, cache storefront separation, lookup and local budget", async () => {
  const urls = [];
  const client = createCatalogClient(async (url) => {
    urls.push(new URL(url));
    return Response.json({ results: [row] });
  }, 6);
  const signal = new AbortController().signal;
  await Promise.all([
    client.search("a & b", "US", signal),
    client.search("a & b", "US", signal),
  ]);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.get("term"), "a & b");
  assert.equal(urls[0].searchParams.get("entity"), "song");
  assert.equal(urls[0].searchParams.get("limit"), "5");
  await client.search("a & b", "SG", signal);
  assert.equal((await client.lookup(123, "US", signal)).trackId, 123);
  await assert.rejects(
    client.search("new", "US", signal),
    (error) => error.status === 429 && error.retryAfter > 0
  );
  assert.equal(urls.length, 3);
});
test("upstream throttling, malformed payloads and failures produce structured recoverable errors", async () => {
  const signal = new AbortController().signal;
  const throttled = createCatalogClient(
    async () =>
      new Response("", { status: 429, headers: { "Retry-After": "2" } })
  );
  await assert.rejects(
    throttled.search("test", "US", signal),
    (error) => error.status === 429 && error.retryAfter === 2
  );
  for (const fetcher of [
    async () => Response.json({ unexpected: true }),
    async () => new Response("", { status: 503 }),
    async () => {
      throw new Error("offline");
    },
  ]) {
    await assert.rejects(
      createCatalogClient(fetcher).search("test", "US", signal),
      (error) => error.status === 502
    );
  }
  assert.deepEqual(
    await createCatalogClient(async () =>
      Response.json({ results: [] })
    ).search("none", "US", signal),
    []
  );
});

test("catalog search limits upstream requests and returned results to the top five", async () => {
  const client = createCatalogClient(async (url) => {
    assert.equal(new URL(url).searchParams.get("limit"), "5");
    return Response.json({
      results: Array.from({ length: 10 }, (_, index) => ({
        ...row,
        trackId: index + 1,
        trackName: `Song ${index + 1}`,
      })),
    });
  });
  const tracks = await client.search(
    "songs",
    "US",
    new AbortController().signal
  );
  assert.deepEqual(
    tracks.map((track) => track.trackId),
    [1, 2, 3, 4, 5]
  );
});
test("player metadata comes from iTunes while playback source and duration remain independent", () => {
  const source = candidate("YouTube upload title", "YouTube uploader", 245);
  const resolved = {
    ...source,
    catalog: {
      ...catalog,
      genre: "Pop",
      album: { ...catalog.album, releaseDate: "2020-01-01" },
    },
  };
  const details = trackDetails(resolved);
  assert.equal(details.title, "Test Song");
  for (const value of ["The Artist", "Album", "Pop", "2020", "Explicit"])
    assert.ok(details.description.includes(value));
  assert.equal(details.description.includes("YouTube"), false);
  assert.equal(details.storeUrl, catalog.storeUrl);
  assert.equal(resolved.duration, 245);
  assert.equal(resolved.catalog.duration, 200);
  assert.equal(trackDetails(source).title, "YouTube upload title");
  assert.equal(
    trackDetails({
      ...resolved,
      catalog: { ...catalog, artist: { ...catalog.artist, name: null } },
    }).description.includes("Artist unknown"),
    true
  );
});
