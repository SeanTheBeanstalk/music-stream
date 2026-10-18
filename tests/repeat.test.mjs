import test from "node:test";
import assert from "node:assert/strict";
import { emptyQueue, queueReducer } from "../lib/music/queue.ts";

const first = { id: "rboiHxBqdZk", title: "First" };
const second = { id: "dQw4w9WgXcQ", title: "Second" };
const single = queueReducer(emptyQueue, { type: "play", track: first });
const two = queueReducer(single, { type: "enqueue", track: second });
const end = (state, repeatMode) =>
  queueReducer(state, { type: "ended", repeatMode });

test("ending an empty or unstarted queue never starts playback in any repeat mode", () => {
  const idle = queueReducer(emptyQueue, { type: "enqueue", track: first });
  for (const mode of ["off", "track", "queue"]) {
    assert.equal(end(emptyQueue, mode), emptyQueue);
    assert.equal(end(idle, mode), idle);
  }
});

test("repeat off advances normally and stops at the last track", () => {
  assert.equal(end(single, "off"), single);
  const next = end(two, "off");
  assert.equal(next.index, 1);
  assert.equal(next.revision, two.revision + 1);
  assert.equal(end(next, "off"), next);
});

test("repeat track restarts the current occurrence without changing queue order", () => {
  for (const state of [single, two, end(two, "off")]) {
    const replay = end(state, "track");
    assert.equal(replay.index, state.index);
    assert.equal(replay.tracks, state.tracks);
    assert.equal(replay.revision, state.revision + 1);
  }
});

test("repeat queue advances then wraps through the retained queue on successive cycles", () => {
  let state = two;
  for (const index of [1, 0, 1, 0]) {
    const next = end(state, "queue");
    assert.equal(next.index, index);
    assert.equal(next.revision, state.revision + 1);
    assert.equal(next.tracks, two.tracks);
    state = next;
  }
  const replay = end(single, "queue");
  assert.equal(replay.index, 0);
  assert.equal(replay.revision, single.revision + 1);
});

test("switching repeat off stops the next ending at the boundary", () => {
  const replay = end(single, "track");
  assert.equal(end(replay, "off"), replay);
  const last = end(two, "queue");
  assert.equal(end(last, "off"), last);
});

test("manual navigation skips a repeating track and keeps queue boundaries", () => {
  const repeating = end(two, "track");
  const next = queueReducer(repeating, { type: "next" });
  assert.equal(next.index, 1);
  assert.equal(queueReducer(next, { type: "next" }), next);
  const wrapped = end(next, "queue");
  assert.equal(wrapped.index, 0);
  assert.equal(queueReducer(wrapped, { type: "previous" }), wrapped);
  assert.equal(queueReducer(next, { type: "previous" }).index, 0);
});

test("repeat queue uses the edited queue and cannot restore removed or cleared tracks", () => {
  const removed = queueReducer(two, { type: "remove", index: 1 });
  assert.deepEqual(end(removed, "queue").tracks, [first]);
  const cleared = queueReducer(two, { type: "clear-upcoming" });
  assert.deepEqual(end(cleared, "queue").tracks, [first]);
  const three = queueReducer(two, { type: "enqueue", track: first });
  const reordered = queueReducer(three, { type: "move", from: 2, to: 1 });
  const next = end(reordered, "queue");
  assert.deepEqual(next.tracks, [first, first, second]);
  assert.equal(next.index, 1);
  assert.equal(next.revision, reordered.revision + 1);
});
