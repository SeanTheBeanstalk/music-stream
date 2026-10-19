// Run after browser-check.mjs, using the same Edge tab and a live resolved track.
import assert from "node:assert/strict";
const origin = process.env.TEST_ORIGIN || "http://localhost:3000";
const cdp = process.env.TEST_CDP || "http://127.0.0.1:9224";
const pages = await (await fetch(`${cdp}/json`)).json();
const page = pages.find(
  (p) => p.type === "page" && p.url.startsWith(`${origin}/`)
);
assert.ok(page, "Run browser-check.mjs first to load a live track");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) =>
  socket.addEventListener("open", resolve, { once: true })
);
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const response = JSON.parse(event.data);
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  clearTimeout(request.timer);
  if (response.error) request.reject(new Error(response.error.message));
  else request.resolve(response.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const snapshot = () =>
  evaluate(`(() => {
  const a = document.querySelector('audio');
  return { time:a.currentTime, duration:a.duration, paused:a.paused,
    error:a.error?.code ?? null, seekable:a.seekable.length,
    status:document.querySelector('footer [role=status]').textContent,
    ended:window.liveTrackEnded === true };
})()`);
async function until(predicate, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await snapshot();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Playback condition timed out: ${JSON.stringify(await snapshot())}`
  );
}
try {
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  const initial = await snapshot();
  assert.ok(initial.duration > 140, "Use a live track longer than 140 seconds");
  await evaluate(
    "document.querySelector('footer button[aria-label=Play]')?.click(); document.querySelector('audio').currentTime = 0"
  );
  await until((s) => s.time > 0 && !s.paused);
  const started = Date.now();
  let previous = 0;
  while (Date.now() - started < 135000) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const state = await snapshot();
    console.log("Live sustained playback:", JSON.stringify(state));
    assert.equal(state.error, null);
    assert.equal(state.paused, false);
    assert.ok(state.time > previous + 5, "Playback must continue advancing");
    previous = state.time;
  }
  assert.ok(previous > 130);
  console.log("PASS live playback beyond 120 seconds of wall time");
  await send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 250,
    downloadThroughput: 32 * 1024,
    uploadThroughput: 32 * 1024,
    connectionType: "cellular3g",
  });
  await evaluate("document.querySelector('audio').currentTime = 155");
  await until((s) => s.time > 160 && !s.paused && s.error === null);
  console.log("PASS live seek and playback at 32 KiB/s with 250ms latency");
  const resume = (await snapshot()).time;
  await send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  // A reload forces a request rather than letting buffered audio hide the outage.
  await evaluate(
    "document.querySelector('audio').dispatchEvent(new Event('error'))"
  );
  await until((s) => s.status.includes("Retrying"));
  await new Promise((resolve) => setTimeout(resolve, 3500));
  console.log("Offline state:", JSON.stringify(await snapshot()));
  await send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  const recovered = await until(
    (s) => !s.paused && s.error === null && s.time > resume
  );
  console.log(
    "PASS live reload after offline failure restores position:",
    JSON.stringify(recovered)
  );
  await evaluate(
    "window.liveTrackEnded = false; document.querySelector('audio').addEventListener('ended', () => { window.liveTrackEnded = true; }, {once:true})"
  );
  await until((s) => s.ended, 90000);
  console.log("PASS live track reaches its natural end after recovery");
  const cancelled = await evaluate(`(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    try {
      const response = await fetch(document.querySelector('audio').src, {signal:controller.signal});
      await response.arrayBuffer();
      return false;
    } catch (error) { return error.name === 'AbortError'; }
    finally { clearTimeout(timer); }
  })()`);
  assert.equal(cancelled, true);
  console.log(
    "PASS listener can cancel a live stream request; upstream cleanup still requires server instrumentation"
  );
} finally {
  await send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await send("Network.setCacheDisabled", { cacheDisabled: false });
  await evaluate(
    "document.querySelector('footer button[aria-label=Pause]')?.click()"
  );
  socket.close();
}
