// Live-provider check. Start an isolated production server and headless Edge first.
// TEST_ORIGIN=http://127.0.0.1:3002 TEST_CDP=http://127.0.0.1:9226 node tests/browser-youtube-availability-check.mjs
import assert from "node:assert/strict";

const origin = process.env.TEST_ORIGIN;
assert.ok(origin, "Set TEST_ORIGIN explicitly to the isolated test server");
const cdp = process.env.TEST_CDP;
assert.ok(cdp, "Set TEST_CDP to a dedicated Edge debugging port");
const pages = await (await fetch(`${cdp}/json`)).json();
const page = pages.find(
  (entry) => entry.type === "page" && entry.url === "about:blank"
);
assert.ok(page, "Open a dedicated blank Edge tab");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) =>
  socket.addEventListener("open", resolve, { once: true })
);
let id = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const response = JSON.parse(data);
  const job = pending.get(response.id);
  if (!job) return;
  pending.delete(response.id);
  clearTimeout(job.timer);
  if (response.error) job.reject(new Error(JSON.stringify(response.error)));
  else job.resolve(response.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP timeout: ${method}`));
    }, 60000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  await send("Page.enable");
  await send("Page.navigate", { url: origin });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  for (const [song, videoId] of [
    ["Taylor Swift", "mRFDNwDrW5w"],
    ["keshi", "6DcUnqZqTvI"],
  ]) {
    const response = await fetch(`${origin}/api/stream/${videoId}`, {
      headers: { Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(45000),
    });
    assert.equal(response.status, 206);
    assert.match(response.headers.get("content-type"), /^audio\//);
    assert.match(response.headers.get("content-range"), /^bytes 0-1023\//);
    assert.equal((await response.arrayBuffer()).byteLength, 1024);
    console.log(
      JSON.stringify({ song, rangeRequest: "206, 1024 audio bytes" })
    );
    const result = await evaluate(`(async () => {
      const audio = new Audio('/api/stream/${videoId}');
      window.availabilityAudio = audio;
      audio.muted = true;
      const waitFor = async (predicate) => {
        const end = Date.now() + 40000;
        while (!predicate()) {
          if (audio.error) throw new Error('Media error ' + audio.error.code);
          if (Date.now() > end) throw new Error('Audio condition timed out');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      };
      try {
        await audio.play();
        await waitFor(() => audio.currentTime > 1 && Number.isFinite(audio.duration));
        const duration = audio.duration;
        const seekable = audio.seekable.length;
        audio.currentTime = 40;
        await waitFor(() => !audio.seeking && audio.currentTime > 41);
        const forward = audio.currentTime;
        audio.currentTime = 10;
        await waitFor(() => !audio.seeking && audio.currentTime > 11 && audio.currentTime < 20);
        return { duration, seekable, forward, backward: audio.currentTime, error: audio.error?.code ?? null };
      } finally { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    })()`);
    assert.equal(result.error, null);
    assert.ok(result.duration > 140 && result.duration < 200);
    assert.ok(result.seekable > 0);
    console.log(JSON.stringify({ song, browser: result }));
  }
  console.log(
    "PASS live production stream ranges, Edge playback, duration and forward/backward seeking for both songs"
  );
} finally {
  await evaluate("window.availabilityAudio?.pause()").catch(() => {});
  socket.close();
}
