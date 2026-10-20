import test from "node:test";
import assert from "node:assert/strict";
import { resolveYoutubeAudio } from "../lib/server/youtube-audio.ts";

const videoId = "mRFDNwDrW5w";
const audio = { url: "https://rr3.googlevideo.com/videoplayback" };
const signal = () => new AbortController().signal;
const runner = (data) => async () => JSON.stringify({ ...audio, ...data });

test("available audio returns immediately with safe playback headers", async () => {
  for (const available_at of [undefined, null, Date.now() / 1000 - 10]) {
    const result = await resolveYoutubeAudio(
      videoId,
      signal(),
      runner({
        available_at,
        http_headers: {
          "User-Agent": "yt-dlp agent",
          Referer: "https://www.youtube.com/",
          Host: "evil.test",
          Range: "bytes=100-",
        },
      })
    );
    assert.equal(result.url.href, audio.url);
    assert.equal(result.headers.get("user-agent"), "yt-dlp agent");
    assert.equal(result.headers.get("referer"), "https://www.youtube.com/");
    assert.equal(result.headers.has("host"), false);
    assert.equal(result.headers.has("range"), false);
  }
});

test("waits for the selected stream's availability before returning", async () => {
  const available_at = (Date.now() + 80) / 1000;
  const result = await resolveYoutubeAudio(
    videoId,
    signal(),
    runner({ available_at })
  );
  assert.ok(Date.now() >= available_at * 1000);
  assert.equal(result.url.href, audio.url);
});

test("cancellation interrupts an availability wait and prevents a stale result", async () => {
  const controller = new AbortController();
  let extracted;
  const ready = new Promise((resolve) => {
    extracted = resolve;
  });
  const pending = resolveYoutubeAudio(videoId, controller.signal, async () => {
    extracted();
    return JSON.stringify({ ...audio, available_at: Date.now() / 1000 + 20 });
  });
  await ready;
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, (error) => error.status === 499);
  await assert.rejects(
    resolveYoutubeAudio(videoId, controller.signal, () => {
      assert.fail("Aborted requests must not start extraction");
    }),
    (error) => error.status === 499
  );
});

test("rejects excessive or malformed waits and untrusted audio URLs", async () => {
  for (const available_at of [Date.now() / 1000 + 60, "tomorrow"]) {
    await assert.rejects(
      resolveYoutubeAudio(videoId, signal(), runner({ available_at }))
    );
  }
  for (const url of [
    "http://rr3.googlevideo.com/audio",
    "https://googlevideo.com.evil.test/audio",
    "https://user:pass@rr3.googlevideo.com/audio",
    "https://rr3.googlevideo.com:8443/audio",
  ]) {
    await assert.rejects(
      resolveYoutubeAudio(videoId, signal(), runner({ url }))
    );
  }
  await assert.rejects(
    resolveYoutubeAudio("invalid", signal(), () => assert.fail("Invalid ID"))
  );
});
