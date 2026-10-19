import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCatalog } from "../lib/music/catalog.ts";
import { normalizeTrack } from "../lib/music/track.ts";
import { createPersistentMusic } from "../lib/server/persistent-music.ts";

const track = normalizeCatalog({ kind: "song", trackId: 123, trackName: "Song", artistName: "Artist" }, "SG");
const source = normalizeTrack({ id: "dQw4w9WgXcQ", title: "Artist - Song", duration: 200 });
const signal = () => new AbortController().signal;
const unexpected = async () => { throw new Error("Unexpected provider call"); };

test("fresh stored metadata and selected mapping bypass both external providers", async () => {
  const calls = [];
  const music = createPersistentMusic({
    getCatalog: async (...args) => { calls.push(args); return track; },
    getMapping: async (...args) => { calls.push(args); return source; },
  }, { lookup: unexpected }, unexpected);
  assert.deepEqual(await music.resolve(123, "SG", signal()), { ...source, catalog: track });
  assert.deepEqual(calls, [[123, "SG"], [123, "SG"]]);
});

test("search persists trusted results and preserves provider order", async () => {
  const saved = [];
  const tracks = [track, { ...track, trackId: 456 }];
  const music = createPersistentMusic({ saveCatalog: async value => { saved.push(value); } }, { search: async () => tracks });
  assert.deepEqual(await music.search("Song", "SG", signal()), tracks);
  assert.deepEqual(saved, tracks);
});

test("first resolution persists catalog before matching and returns the transaction winner", async () => {
  const calls = [];
  const winner = { ...source, id: "abcdefghijk" };
  const music = createPersistentMusic({
    getCatalog: async () => null,
    saveCatalog: async () => { calls.push("catalog"); },
    getMapping: async () => null,
    selectSource: async (metadata, selected) => {
      assert.equal(metadata, track); assert.equal(selected, source);
      calls.push("mapping"); return winner;
    },
  }, { lookup: async () => track }, async () => { calls.push("resolve"); return source; });
  assert.deepEqual(await music.resolve(123, "SG", signal()), { ...winner, catalog: track });
  assert.deepEqual(calls, ["catalog", "resolve", "mapping"]);
});

test("catalog outages reuse stale metadata without extending its freshness", async () => {
  const freshFlags = [];
  const music = createPersistentMusic({
    getCatalog: async (_id, _country, fresh = true) => { freshFlags.push(fresh); return fresh ? null : track; },
    getMapping: async () => source,
    saveCatalog: unexpected,
  }, { lookup: async () => { throw new Error("Catalog outage"); } }, unexpected);
  assert.deepEqual(await music.resolve(123, "SG", signal()), { ...source, catalog: track });
  assert.deepEqual(freshFlags, [true, false]);
});

test("unavailable catalog results do not silently use a saved recording", async () => {
  const music = createPersistentMusic({ getCatalog: async () => null, getMapping: unexpected }, { lookup: async () => null }, unexpected);
  await assert.rejects(music.resolve(123, "SG", signal()), error => error.status === 404);
});

test("database failures preserve provider playback and never expose driver errors", async t => {
  const messages = [];
  t.mock.method(console, "warn", value => messages.push(value));
  const fail = async () => { throw new Error("secret connection string"); };
  const music = createPersistentMusic({ getCatalog: fail, saveCatalog: fail, getMapping: fail, selectSource: fail }, { lookup: async () => track }, async () => source);
  assert.deepEqual(await music.resolve(123, "SG", signal()), { ...source, catalog: track });
  assert.equal(messages.length, 4);
  assert.ok(messages.every(value => !value.includes("secret")));
});

test("no database configuration preserves the original provider workflow", async () => {
  const music = createPersistentMusic(null, { lookup: async () => track, search: async () => [track] }, async () => source);
  assert.deepEqual(await music.resolve(123, "SG", signal()), { ...source, catalog: track });
  assert.deepEqual(await music.search("Song", "SG", signal()), [track]);
});

test("cancelled resolution stops before searching or selecting a new source", async () => {
  const controller = new AbortController();
  const music = createPersistentMusic({
    getCatalog: async () => { controller.abort(); return track; },
    getMapping: unexpected,
  }, { lookup: unexpected }, unexpected);
  await assert.rejects(music.resolve(123, "SG", controller.signal), { name: "AbortError" });
});
