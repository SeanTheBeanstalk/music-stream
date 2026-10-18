import test from "node:test";
import assert from "node:assert/strict";
import {
  matchCandidates,
  parseTitle,
  playbackSearchQueries,
} from "../lib/music/matching.ts";
import { resolveSource } from "../lib/server/resolve-source.ts";
import { normalizeCatalog } from "../lib/music/catalog.ts";
import { normalizeTrack } from "../lib/music/track.ts";

const song = (title = "A Different Song", artist = "The Artist") =>
  normalizeCatalog(
    {
      kind: "song",
      trackId: 123,
      trackName: title,
      artistName: artist,
      trackTimeMillis: 200000,
    },
    "US"
  );
const upload = (title, uploader = "The Artist - Topic", duration = 200) =>
  normalizeTrack({
    id: "dQw4w9WgXcQ",
    title,
    uploader,
    duration,
  });

test("recording descriptors support brackets, suffixes and equivalent wording", () => {
  for (const [catalogTitle, uploadTitle] of [
    ["LIMBO (Sped Up Version)", "LIMBO speed up"],
    ["LIMBO (Sped Up Version)", "LIMBO [Nightcore]"],
    ["Song (Slowed Down Version)", "Song - Slowed"],
    ["Song - Radio Edit", "Song (Radio Version)"],
    ["Song (Acoustic Version)", "Song [Acoustic]"],
    ["Song (Acoustic Version)", "Song acoustic"],
    ["Song (Live at Wembley)", "Song (Live)"],
    ["Song (2011 Remastered Version)", "Song"],
    ["Song - 2011 Remastered", "Song"],
    ["Song (feat. Guest)", "Song ft. Guest (Official Audio)"],
    ["Don't Stop", "DON’T STOP (Official Lyric Video)"],
  ]) {
    const source = upload(uploadTitle);
    assert.equal(
      matchCandidates(song(catalogTitle), [source]),
      source,
      catalogTitle
    );
  }
});

test("preserves meaningful title words and unknown subtitles", () => {
  for (const title of [
    "Live and Let Die",
    "Version of Me",
    "Song (Part Two)",
    "Song (Acoustic Heart)",
  ]) {
    const source = upload(`The Artist - ${title}`);
    assert.equal(matchCandidates(song(title), [source]), source, title);
    assert.equal(matchCandidates(song(title), [upload("Song")]), null, title);
  }
  assert.equal(parseTitle("Live and Let Die").versions.size, 0);
});

test("ranks stronger title evidence and duration, retains order for equal evidence", () => {
  const reordered = upload("Song A Different", "The Artist", null);
  const far = upload("A Different Song", "The Artist", 500);
  const close = upload("A Different Song", "The Artist", 202);
  assert.equal(matchCandidates(song(), [reordered, far, close]), close);
  assert.equal(matchCandidates(song(), [reordered]), reordered);
  const tied = { ...close, id: "rboiHxBqdZk" };
  assert.equal(matchCandidates(song(), [close, tied]), close);
  assert.equal(
    matchCandidates(song(), [
      upload("A Different"),
      upload("A Different Songs"),
    ]),
    null
  );
});

test("requires artist attribution and rejects contradictory edits or named remixes", () => {
  assert.equal(
    matchCandidates(song("Song"), [
      upload("Song instrumental"),
      upload("Song live"),
    ]),
    null
  );
  assert.equal(
    matchCandidates(song(), [upload("A Different Song", "The Artists")]),
    null
  );
  assert.equal(
    matchCandidates(song("Song (Sped Up Version)"), [
      upload("Song (Slowed)"),
      upload("Song"),
    ]),
    null
  );
  assert.equal(
    matchCandidates(song("Song (Tiesto Remix)"), [
      upload("Song (Other Remix)"),
      upload("Song (Remix)"),
    ]),
    null
  );
  const remix = upload("Song (Tiesto Remix)");
  assert.equal(matchCandidates(song("Song (Tiesto Remix)"), [remix]), remix);
  const feature = upload("A Different Song", "The Artist");
  assert.equal(
    matchCandidates(song(undefined, "The Artist feat. Guest"), [feature]),
    feature
  );
});

test("fallback broadens retrieval without relaxing the selected version", async () => {
  const catalog = song("Song (Sped Up Version)");
  const queries = [];
  const source = upload("Song [Sped Up]");
  const result = await resolveSource(
    catalog,
    new AbortController().signal,
    async (query) => {
      queries.push(query);
      return queries.length === 1 ? [upload("Song")] : [source];
    }
  );
  assert.equal(result, source);
  assert.deepEqual(queries, [
    "The Artist Song (Sped Up Version)",
    "The Artist song",
  ]);
  let calls = 0;
  assert.equal(
    await resolveSource(catalog, new AbortController().signal, async () => {
      calls++;
      return [upload("Song (Slowed)")];
    }),
    null
  );
  assert.equal(calls, 2);
});

test("avoids duplicate searches and stops after success or upstream failure", async () => {
  assert.equal(playbackSearchQueries(song()).length, 1);
  assert.deepEqual(playbackSearchQueries(song("Song", "")), []);
  let calls = 0;
  const source = upload("Song (Acoustic)");
  await resolveSource(
    song("Song (Acoustic Version)"),
    new AbortController().signal,
    async () => {
      calls++;
      return [source];
    }
  );
  assert.equal(calls, 1);
  const failure = new Error("YouTube unavailable");
  await assert.rejects(
    resolveSource(
      song("Song (Acoustic Version)"),
      new AbortController().signal,
      async () => {
        calls++;
        throw failure;
      }
    ),
    failure
  );
  assert.equal(calls, 2);
});

test("cancellation prevents fallback and stale source selection", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    resolveSource(
      song("Song (Acoustic)"),
      controller.signal,
      async (_, signal) => {
        calls++;
        controller.abort();
        assert.equal(signal.aborted, true);
        return [upload("Song (Acoustic)")];
      }
    )
  );
  assert.equal(calls, 1);
  await assert.rejects(
    resolveSource(song(), controller.signal, async () => {
      calls++;
      return [];
    })
  );
  assert.equal(calls, 1);
});
