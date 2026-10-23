// Optional smoke check against a running dev server and a Chromium CDP port.
// Uses Node's WebSocket, without installing a browser automation dependency.
import assert from "node:assert/strict";
const origin = process.env.TEST_ORIGIN || "http://localhost:3000";
const cdp = process.env.TEST_CDP || "http://127.0.0.1:9224";
const pages = await (await fetch(`${cdp}/json`)).json();
const page =
  pages.find((p) => p.type === "page" && p.url === "about:blank") ||
  pages.find((p) => p.type === "page" && p.url.startsWith(`${origin}/`));
assert.ok(page, "Open a blank Chromium tab with remote debugging enabled");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) =>
  socket.addEventListener("open", resolve, { once: true })
);
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const response = JSON.parse(event.data);
  if (pending.has(response.id)) {
    const { resolve, reject, timer } = pending.get(response.id);
    clearTimeout(timer);
    pending.delete(response.id);
    if (response.error) reject(new Error(response.error.message));
    else resolve(response.result);
  }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP timeout: ${method}`));
    }, 45_000);
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression, timeout = 40_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function submit(query) {
  await evaluate(
    `(() => { const input = document.querySelector('#music-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await evaluate("document.querySelector('form').requestSubmit()");
}
try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${origin}/search` });
  await until("!!document.querySelector('#music-search')");
  // Wait until React has hydrated and installed event handlers.
  await until(
    "!!Object.keys(document.querySelector('#music-search')).find(k => k.startsWith('__reactProps'))"
  );
  assert.equal(
    await evaluate("document.documentElement.scrollWidth <= innerWidth"),
    true
  );
  await evaluate("document.querySelector('#music-search').focus()");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  assert.equal(
    await evaluate("document.activeElement.tagName !== 'BODY'"),
    true
  );
  await submit(process.env.TEST_QUERY || "rick astley never gonna give you up");
  await until(
    "!!document.querySelector('article') || !!document.querySelector('[data-sonner-toast][data-type=error]')"
  );
  assert.equal(
    await evaluate("!!document.querySelector('article')"),
    true,
    "Live iTunes search should return tracks"
  );
  console.log("PASS live search and desktop layout");
  await evaluate(
    "window.savedAudio = document.querySelector('audio'); Array.from(document.querySelectorAll('article button')).find(b => b.textContent === 'Play').click()"
  );
  await until(
    "document.querySelector('audio').currentTime > 0 || !!document.querySelector('[data-sonner-toast][data-type=error]')?.textContent.match(/no confident|unable|unavailable|could not|too long|busy|retry/i) || !!document.querySelector('footer').textContent.match(/could not|unavailable/)",
    70_000
  );
  const audio = await evaluate(
    "({ time: savedAudio.currentTime, duration: savedAudio.duration, error: savedAudio.error?.code, status: document.querySelector('footer [role=status]').textContent, seekable: savedAudio.seekable.length })"
  );
  console.log("Live audio:", JSON.stringify(audio));
  assert.ok(
    audio.time > 0 && audio.duration > 0 && audio.seekable > 0,
    "Live audio should play with a finite duration and seekable ranges"
  );
  await evaluate("savedAudio.currentTime = 60");
  await until(
    "savedAudio.currentTime >= 60 && !savedAudio.paused && !savedAudio.seeking"
  );
  await evaluate("document.querySelector('input[aria-label=Seek]').focus()");
  const beforeSeek = await evaluate("savedAudio.currentTime");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
  });
  await until(`savedAudio.currentTime > ${beforeSeek}`);
  await evaluate("document.querySelector('input[max=\"1\"]').focus()");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowLeft",
    code: "ArrowLeft",
    windowsVirtualKeyCode: 37,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "ArrowLeft",
    code: "ArrowLeft",
    windowsVirtualKeyCode: 37,
  });
  await until("savedAudio.volume < 1");
  console.log(
    "PASS actual seeking, duration, and keyboard seek/volume controls"
  );
  await evaluate(
    "Array.from(document.querySelectorAll('article button')).find(b => b.textContent === 'Add to queue').click()"
  );
  await until(
    "document.querySelector('footer').textContent.includes('1 queued')"
  );
  const source = await evaluate("savedAudio.src");
  await evaluate("document.querySelector('a[href=\"/\"]').click()");
  await until("location.pathname === '/'");
  assert.equal(
    await evaluate("savedAudio === document.querySelector('audio')"),
    true
  );
  assert.equal(await evaluate("savedAudio.src"), source);
  assert.equal(await evaluate("savedAudio.paused"), false);
  await evaluate("document.querySelector('a[href=\"/search\"]').click()");
  await until("!!document.querySelector('#music-search')");
  assert.equal(
    await evaluate("savedAudio === document.querySelector('audio')"),
    true
  );
  console.log("PASS queue and persistent audio across navigation");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.equal(
    await evaluate("document.documentElement.scrollWidth <= innerWidth"),
    true
  );
  console.log("PASS mobile layout without horizontal overflow");
  // Resolve mocked requests out of order, even when cancellation is ignored.
  await evaluate(
    `window.realFetch = window.fetch; window.fetch = (url, options) => String(url).startsWith('/api/search') ? new Promise(resolve => setTimeout(() => resolve(new Response(JSON.stringify({ tracks: [{ id: 'itunes:123', trackId: 123, country: 'US', artist: { name: 'Test' }, album: { name: 'Album', releaseDate: null }, title: String(url).includes('slow') ? 'Stale result' : 'Latest result', artwork: '', uploader: null, duration: 10, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })), String(url).includes('slow') ? 1500 : 10)) : realFetch(url, options)`
  );
  await submit("slow");
  await submit("fast");
  await until(
    "document.querySelector('article h2')?.textContent === 'Latest result'"
  );
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert.equal(
    await evaluate("document.querySelector('article h2').textContent"),
    "Latest result"
  );
  assert.equal(await evaluate("savedAudio.src"), source);
  console.log("PASS stale search suppression and uninterrupted audio source");
  await evaluate(
    "window.fetch = async () => new Response(JSON.stringify({tracks:[]}), {status:200})"
  );
  await submit("empty");
  await until("document.body.textContent.includes('No track found')");
  await evaluate(
    "window.fetch = async () => new Response(JSON.stringify({error:'Test service failure'}), {status:503})"
  );
  await submit("error");
  await until("document.body.textContent.includes('Test service failure')");
  await evaluate("window.fetch = window.realFetch");
  console.log("PASS empty and error states");
} finally {
  socket.close();
}
