import test from "node:test";
import assert from "node:assert/strict";
import { createPlaybackRetry } from "../lib/music/playback-retry.ts";

function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const statuses = [];
  const audio = {
    src: "",
    currentTime: 0,
    duration: 200,
    error: null,
    loads: 0,
    plays: 0,
    pauses: 0,
    load() {
      this.loads++;
      this.currentTime = 0;
    },
    play() {
      this.plays++;
      return Promise.resolve();
    },
    pause() {
      this.pauses++;
    },
  };
  const retry = createPlaybackRetry(audio, (...status) =>
    statuses.push(status)
  );
  t.after(() => retry.stop());
  return { audio, retry, statuses };
}

test("stream failures retry indefinitely with capped backoff, then stop on playback", (t) => {
  const { audio, retry, statuses } = setup(t);
  retry.start("/api/stream/first");
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]) {
    const before = audio.loads;
    retry.failed();
    retry.failed(); // A media error and rejected play must not schedule twice.
    assert.deepEqual(statuses.at(-1), ["retrying", delay]);
    t.mock.timers.tick(delay - 1);
    assert.equal(audio.loads, before);
    t.mock.timers.tick(1);
    assert.equal(audio.loads, before + 1);
  }
  retry.playing();
  assert.equal(statuses.at(-1)[0], "playing");
  const plays = audio.plays;
  t.mock.timers.tick(120000);
  assert.equal(audio.plays, plays);
  retry.failed();
  assert.deepEqual(statuses.at(-1), ["retrying", 1000]);
});

test("pause cancels retries and prevents late playing events from restarting audio", (t) => {
  const { audio, retry, statuses } = setup(t);
  retry.start("/api/stream/first");
  retry.failed();
  retry.stop();
  t.mock.timers.tick(120000);
  assert.equal(audio.plays, 1);
  retry.failed();
  retry.playing();
  assert.equal(statuses.at(-1)[0], "paused");
  assert.equal(audio.pauses, 2);
});

test("switching tracks cancels old retries and resets backoff and resume position", (t) => {
  const { audio, retry, statuses } = setup(t);
  retry.start("/api/stream/first");
  audio.currentTime = 42;
  retry.failed();
  retry.start("/api/stream/second");
  retry.loadedMetadata();
  t.mock.timers.tick(120000);
  assert.equal(audio.src, "/api/stream/second");
  assert.equal(audio.plays, 2);
  assert.equal(audio.currentTime, 0);
  retry.failed();
  assert.deepEqual(statuses.at(-1), ["retrying", 1000]);
});

test("recovery restores position even after multiple failed reloads", (t) => {
  const { audio, retry } = setup(t);
  retry.start("/api/stream/first");
  audio.currentTime = 42;
  retry.failed();
  t.mock.timers.tick(1000);
  retry.failed();
  t.mock.timers.tick(2000);
  retry.loadedMetadata();
  assert.equal(audio.currentTime, 42);
});

test("play promise failures retry, but stale failures after switching or pausing are ignored", async (t) => {
  const { audio, retry, statuses } = setup(t);
  let reject;
  audio.play = () =>
    new Promise((_, fail) => {
      reject = fail;
    });
  retry.start("/api/stream/first");
  const oldReject = reject;
  retry.start("/api/stream/second");
  oldReject(new Error("old failure"));
  await Promise.resolve();
  assert.equal(statuses.at(-1)[0], "loading");
  reject(new Error("network failure"));
  await Promise.resolve();
  assert.deepEqual(statuses.at(-1), ["retrying", 1000]);
  t.mock.timers.tick(1000);
  retry.stop();
  reject(new Error("late failure"));
  await Promise.resolve();
  assert.equal(statuses.at(-1)[0], "paused");
});

test("autoplay restrictions request a user gesture instead of retrying endlessly", async (t) => {
  const { audio, retry, statuses } = setup(t);
  audio.play = () =>
    Promise.reject(new DOMException("Blocked", "NotAllowedError"));
  retry.start("/api/stream/first");
  await Promise.resolve();
  assert.equal(statuses.at(-1)[0], "blocked");
  t.mock.timers.tick(120000);
  assert.equal(audio.loads, 1);
});
