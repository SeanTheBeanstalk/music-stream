import test from "node:test";
import assert from "node:assert/strict";
import { emptyQueue, queueReducer } from "../lib/music/queue.ts";
import { normalizeTrack, isVideoId, formatTime } from "../lib/music/track.ts";
import { runYoutube, YoutubeError } from "../lib/server/youtube.ts";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const first = normalizeTrack({
  id: "rboiHxBqdZk",
  title: "First",
  uploader: "An uploader",
  duration: 123,
});
const second = normalizeTrack({ id: "dQw4w9WgXcQ", title: "Second" });
test("normalizes the first result and preserves its canonical identity", () => {
  assert.deepEqual(normalizeTrack({ entries: [first, second] }), first);
  assert.equal(first.url, "https://www.youtube.com/watch?v=rboiHxBqdZk");
  assert.equal(second.duration, null);
  assert.equal(second.uploader, null);
  assert.equal(normalizeTrack({ entries: [] }), null);
  assert.equal(normalizeTrack({ id: "--exec", title: "Unsafe" }), null);
  assert.equal(normalizeTrack({ id: first.id }), null);
  assert.equal(
    normalizeTrack({ id: first.id, title: "Test", duration: Infinity })
      .duration,
    null
  );
  assert.equal(isVideoId("../anything"), false);
  assert.equal(formatTime(123), "2:03");
});
test("enqueue preserves the active track, revision, and upcoming order", () => {
  const playing = queueReducer(emptyQueue, { type: "play", track: first });
  const queued = queueReducer(playing, { type: "enqueue", track: second });
  assert.equal(queued.tracks[queued.index], first);
  assert.equal(queued.revision, playing.revision);
  assert.deepEqual(queued.tracks, [first, second]);
  assert.deepEqual(playing.tracks, [first]);
});
test("play selection retains upcoming tracks and can replay the same ID", () => {
  const queued = queueReducer(
    queueReducer(emptyQueue, { type: "play", track: first }),
    { type: "enqueue", track: second }
  );
  const replay = queueReducer(queued, { type: "play", track: first });
  assert.equal(replay.index, 1);
  assert.equal(replay.revision, queued.revision + 1);
  assert.equal(replay.tracks[2], second);
});
test("queue boundaries do not wrap or start an empty queue", () => {
  assert.equal(queueReducer(emptyQueue, { type: "next" }), emptyQueue);
  assert.equal(queueReducer(emptyQueue, { type: "previous" }), emptyQueue);
  const queued = queueReducer(emptyQueue, { type: "enqueue", track: first });
  assert.equal(queued.revision, 0);
  assert.equal(queued.index, 0);
  assert.equal(queueReducer(queued, { type: "next" }), queued);
  const two = queueReducer(queued, { type: "enqueue", track: second });
  const next = queueReducer(two, { type: "next" });
  assert.equal(next.tracks[next.index], second);
  assert.equal(queueReducer(next, { type: "previous" }).index, 0);
});
test("cancelled subprocess requests never launch", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runYoutube([], controller.signal),
    (error) => error instanceof YoutubeError && error.status === 499
  );
});
test("missing yt-dlp produces a recoverable service error", async () => {
  const original = process.env.YT_DLP_PATH;
  process.env.YT_DLP_PATH = "nonexistent-music-stream-test-executable";
  try {
    await assert.rejects(
      runYoutube([], new AbortController().signal),
      (error) => error instanceof YoutubeError && error.status === 503
    );
  } finally {
    if (original === undefined) delete process.env.YT_DLP_PATH;
    else process.env.YT_DLP_PATH = original;
  }
});

test("subprocesses enforce concurrency, output limits, cancellation, and timeouts", async (t) => {
  const children = [];
  t.mock.method(childProcess, "spawn", (executable, args, options) => {
    assert.equal(options.shell, false);
    assert.ok(args.includes("--ignore-config"));
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      queueMicrotask(() => child.emit("close", null));
    };
    children.push(child);
    return child;
  });
  syncBuiltinESMExports();
  try {
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const promises = controllers.map((controller) =>
      runYoutube(["--", "ytsearch1:test"], controller.signal)
    );
    await assert.rejects(
      runYoutube([], new AbortController().signal),
      (error) => error.status === 503
    );
    const settled = Promise.allSettled(promises);
    controllers.forEach((controller) => controller.abort());
    const results = await settled;
    assert.ok(
      results.every(
        (result) => result.status === "rejected" && result.reason.status === 499
      )
    );
    assert.ok(children.every((child) => child.killed));

    const oversized = runYoutube([], new AbortController().signal);
    const rejected = assert.rejects(oversized, /too much data/);
    children.at(-1).stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1));
    await rejected;

    const failure = runYoutube([], new AbortController().signal);
    const failed = assert.rejects(failure, /unavailable/);
    children.at(-1).emit("close", 1);
    await failed;

    t.mock.timers.enable({ apis: ["setTimeout"] });
    const slow = runYoutube([], new AbortController().signal);
    const timedOut = assert.rejects(slow, (error) => error.status === 504);
    t.mock.timers.tick(30_000);
    await timedOut;
    t.mock.timers.reset();

    const success = runYoutube([], new AbortController().signal);
    children.at(-1).stdout.write('{"entries":[]}');
    children.at(-1).emit("close", 0);
    assert.equal(await success, '{"entries":[]}');
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
