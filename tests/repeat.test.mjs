import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRepeatMode,
  emptyQueue,
  queueReducer,
  upcomingQueue,
} from "../lib/music/queue.ts";

const first = { id: "rboiHxBqdZk", title: "First" };
const second = { id: "dQw4w9WgXcQ", title: "Second" };
const single = queueReducer(emptyQueue, { type: "play", track: first });
const two = queueReducer(single, { type: "enqueue", track: second });
const end = (state, repeatMode) =>
  queueReducer(state, { type: "ended", repeatMode });

const third = { ...first, title: "Third" };
const titles = (state, mode = "queue") =>
  upcomingQueue(state, mode).map(({ track }) => track.title);
const cycle = () =>
  queueReducer(emptyQueue, {
    type: "play-many",
    tracks: [first, second, third],
  });

test("default playback keeps the upcoming count constant through endings and manual navigation", () => {
  assert.equal(defaultRepeatMode, "queue");
  for (const type of ["ended", "next", "previous"]) {
    let state = cycle();
    for (let step = 0; step < 9; step++) {
      const before = upcomingQueue(state, defaultRepeatMode);
      const current = state.tracks[state.index];
      state = queueReducer(state, { type, repeatMode: defaultRepeatMode });
      const after = upcomingQueue(state, defaultRepeatMode);
      assert.equal(after.length, 2);
      assert.equal(state.tracks.length, 3);
      if (type !== "previous") {
        assert.equal(state.tracks[state.index], before[0].track);
        assert.equal(after.at(-1).track, current);
      } else {
        assert.equal(state.tracks[state.index], before.at(-1).track);
      }
    }
  }
  for (const type of ["next", "previous"]) {
    assert.equal(
      queueReducer(emptyQueue, { type, repeatMode: defaultRepeatMode }),
      emptyQueue
    );
    const replayed = queueReducer(single, {
      type,
      repeatMode: defaultRepeatMode,
    });
    assert.equal(replayed.tracks[replayed.index], first);
    assert.equal(replayed.revision, single.revision + 1);
  }
});

test("the visible cycle moves completed occurrences to the end through multiple wraps", () => {
  let state = cycle();
  for (const expected of [
    ["Second", "Third"],
    ["Third", "First"],
    ["First", "Second"],
    ["Second", "Third"],
  ]) {
    assert.deepEqual(titles(state), expected);
    assert.equal(upcomingQueue(state, "queue").length, 2);
    state = end(state, "queue");
  }
  assert.deepEqual(titles(state, "off"), ["Third"]);
  assert.deepEqual(titles(state, "track"), ["Third"]);
  assert.deepEqual(upcomingQueue(emptyQueue, "queue"), []);
  assert.deepEqual(titles(single), []);
  assert.deepEqual(
    titles(queueReducer(emptyQueue, { type: "enqueue", track: first })),
    ["First"]
  );
});

test("cycle edits cross the wrap boundary without interrupting the current occurrence", () => {
  const state = end(cycle(), "queue");
  const moved = queueReducer(state, {
    type: "move",
    from: 0,
    to: 2,
    repeatMode: "queue",
  });
  assert.deepEqual(titles(moved), ["First", "Third"]);
  assert.equal(moved.tracks[moved.index], second);
  assert.equal(moved.revision, state.revision);
  assert.deepEqual(
    titles(
      queueReducer(moved, { type: "move", from: 2, to: 0, repeatMode: "queue" })
    ),
    ["Third", "First"]
  );
  const removed = queueReducer(state, {
    type: "remove",
    index: 0,
    repeatMode: "queue",
  });
  assert.deepEqual(titles(removed), ["Third"]);
  assert.equal(removed.tracks[removed.index], second);
  assert.equal(removed.revision, state.revision);
  const cleared = queueReducer(state, {
    type: "clear-upcoming",
    repeatMode: "queue",
  });
  assert.deepEqual(cleared.tracks, [second]);
  assert.equal(cleared.revision, state.revision);
  assert.deepEqual(end(cleared, "queue").tracks, [second]);
});

test("selecting a completed occurrence preserves the rest of the cycle without duplication", () => {
  const state = end(cycle(), "queue");
  const selected = queueReducer(state, {
    type: "select",
    index: 0,
    repeatMode: "queue",
  });
  assert.equal(selected.tracks[selected.index], first);
  assert.deepEqual(titles(selected), ["Third", "Second"]);
  assert.equal(selected.revision, state.revision + 1);
  assert.equal(selected.tracks.length, state.tracks.length);
  assert.equal(
    end(selected, "queue").tracks[end(selected, "queue").index],
    third
  );
  const duplicate = queueReducer(emptyQueue, {
    type: "play-many",
    tracks: [first, second, first],
  });
  assert.deepEqual(
    upcomingQueue(end(duplicate, "queue"), "queue").map(({ index }) => index),
    [2, 0]
  );
  for (const index of [-1, 3, 0.5, NaN]) {
    assert.equal(
      queueReducer(state, { type: "remove", index, repeatMode: "queue" }),
      state
    );
    assert.equal(
      queueReducer(state, { type: "select", index, repeatMode: "queue" }),
      state
    );
  }
});

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
