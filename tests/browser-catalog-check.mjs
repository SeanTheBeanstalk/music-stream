// Run against a local server and a blank Chromium tab on TEST_CDP (port 9224).
// Search and audio are stubbed so queue behavior needs no YouTube connection.
import assert from "node:assert/strict";
const origin = process.env.TEST_ORIGIN || "http://localhost:3000";
const cdp = process.env.TEST_CDP || "http://127.0.0.1:9224";
const pages = await (await fetch(`${cdp}/json`)).json();
const page =
  pages.find((p) => p.type === "page" && p.url === "about:blank") ||
  pages.find((p) => p.type === "page" && p.url.startsWith(origin));
assert.ok(page, "Open a blank Chromium tab with remote debugging enabled");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) =>
  socket.addEventListener("open", resolve, { once: true })
);
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const response = JSON.parse(event.data);
  if (!pending.has(response.id)) return;
  const { resolve, reject, timer } = pending.get(response.id);
  clearTimeout(timer);
  pending.delete(response.id);
  if (response.error) reject(new Error(response.error.message));
  else resolve(response.result);
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
async function until(expression) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out: ${expression}; ${await evaluate("JSON.stringify({ active: document.activeElement.outerHTML.slice(0, 500), dialogs: document.querySelectorAll('[role=dialog]').length, footer: document.querySelector('footer')?.textContent, queue: document.querySelector('button[aria-label^=\"Open queue\"]')?.getAttribute('aria-label') })")}`
  );
}
async function openActions(label) {
  if (!["Play", "Add to queue", "Like", "Add to playlist"].includes(label))
    return;
  await evaluate(
    `document.querySelector('article [aria-label^="Actions for"]').focus()`
  );
  await key("Enter", 13);
  await until("!!document.querySelector('[role=menu]')");
  await until("document.activeElement.getAttribute('role') === 'menuitem'");
}
async function click(label) {
  await openActions(label);
  await until(
    `Array.from(document.querySelectorAll(${JSON.stringify(["Play", "Add to queue", "Like", "Add to playlist"].includes(label) ? "[role=menuitem]" : "button")})).some(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)})`
  );
  await evaluate(
    `(() => {
      const button = Array.from(document.querySelectorAll(${JSON.stringify(["Play", "Add to queue", "Like", "Add to playlist"].includes(label) ? "[role=menuitem]" : "button")})).find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)});
      button.focus();
      button.click();
    })()`
  );
}
async function keyboardClick(label) {
  await openActions(label);
  await evaluate(
    `Array.from(document.querySelectorAll(${JSON.stringify(["Play", "Add to queue", "Like", "Add to playlist"].includes(label) ? "[role=menuitem]" : "button")})).find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)}).focus()`
  );
  await key("Enter", 13);
}
async function key(key, code) {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code: key,
    windowsVirtualKeyCode: code,
    ...(key === "Enter" ? { text: "\r" } : {}),
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code: key,
    windowsVirtualKeyCode: code,
  });
}
async function openQueue(count) {
  await click(`Open queue (${count} upcoming)`);
  await until("!!document.querySelector('[role=dialog]')");
}
async function closeQueue() {
  await key("Escape", 27);
  await until("!document.querySelector('[role=dialog]')");
  await until(
    "document.activeElement.getAttribute('aria-label')?.startsWith('Open queue')"
  );
}

async function submit(query) {
  await evaluate(
    `(() => { const input = document.querySelector('#music-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
  );
  await evaluate("document.querySelector('form').requestSubmit()");
}
async function closeDetails() {
  await key("Escape", 27);
  await until("!document.querySelector('[data-slot=popover-content]')");
  await until(
    "document.activeElement.getAttribute('aria-label')?.startsWith('Track details for')"
  );
}
try {
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    window.catalogRequests = []; window.resolutionMode = 'success';
    window.cover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    HTMLMediaElement.prototype.load = function() {};
    HTMLMediaElement.prototype.play = function() { this.dispatchEvent(new Event('play')); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function() { this.dispatchEvent(new Event('pause')); };
    const realFetch = window.fetch;
    window.fetch = (url, options) => {
      if (String(url).startsWith('/api/search')) {
        window.catalogRequests.push(String(url));
        const params = new URL(url, location.origin).searchParams;
        const query = params.get('q');
        if (query === 'empty') return Promise.resolve(Response.json({ tracks: [] }));
        if (query === 'throttle') return Promise.resolve(Response.json({ error: 'iTunes is limiting requests. Please retry shortly.' }, { status: 429 }));
        return new Promise(resolve => setTimeout(() => resolve(Response.json({ tracks: [{ id: 'itunes:123', trackId: 123, artwork: window.cover, title: query, country: params.get('country'), artist: { name: 'Artist' }, album: { name: 'Album', releaseDate: null }, duration: 200, explicitness: 'explicit' }] })), query === 'slow' ? 1000 : 10));
      }
      if (String(url).startsWith('/api/resolve')) {
        if (window.resolutionMode === 'fail') return Promise.resolve(Response.json({ error: 'No confident YouTube match. Try another recording or retry.' }, { status: 422 }));
        const mode = window.resolutionMode;
        return new Promise(resolve => setTimeout(() => resolve(Response.json({ track: { id: 'dQw4w9WgXcQ', title: 'Resolved upload', uploader: 'Artist - Topic', artwork: '', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: 205, catalog: { id: 'itunes:123', artwork: window.cover, title: 'Catalog song', artist: { name: 'Catalog artist' }, album: { name: 'Catalog album', releaseDate: '2020-01-01' }, genre: 'Pop', explicitness: 'explicit', duration: 200, storeUrl: 'https://music.apple.com/us/album/test/123' } } })), mode === 'slow' ? 1000 : 10));
      }
      return realFetch(url, options);
    };
  `,
  });
  await send("Page.navigate", { url: `${origin}/search` });
  await until(
    "!!document.querySelector('#music-search') && !!Object.keys(document.querySelector('#music-search')).find(k => k.startsWith('__reactProps'))"
  );
  const before = await evaluate("catalogRequests.length");
  await evaluate(
    "(() => { const input = document.querySelector('#music-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'typing'); input.dispatchEvent(new Event('input', { bubbles: true })); })()"
  );
  assert.equal(await evaluate("catalogRequests.length"), before);
  await submit("first");
  await until("document.querySelector('article h2')?.textContent === 'first'");
  await until("document.querySelector('article img')?.naturalWidth > 0");
  await evaluate(
    "document.querySelector('article img').dispatchEvent(new Event('error'))"
  );
  await until(
    "!document.querySelector('article img') && !!document.querySelector('article svg')"
  );

  assert.equal(
    await evaluate(
      "document.querySelector('article').textContent.includes('Catalog duration')"
    ),
    false
  );
  await keyboardClick("Track details for first");
  await until(
    "document.querySelector('[data-slot=popover-content]')?.textContent.includes('Catalog duration')"
  );
  assert.ok(
    await evaluate(
      "document.querySelector('[data-slot=popover-content]').textContent.includes('Explicit')"
    )
  );
  await closeDetails();
  await openActions("Play");
  assert.deepEqual(
    await evaluate(
      "Array.from(document.querySelectorAll('[role=menuitem]')).map(el => el.textContent.trim())"
    ),
    ["Play", "Add to queue", "Like", "Add to playlist"]
  );
  await key("Escape", 27);
  await until("!document.querySelector('[role=menu]')");
  await until(
    "document.activeElement.getAttribute('aria-label') === 'Actions for first'"
  );
  await keyboardClick("Like");
  await until(
    "Array.from(document.querySelectorAll('[data-sonner-toast]')).some(el => el.textContent.includes('Sign in from Library'))"
  );
  await evaluate("window.resolutionMode = 'fail'");
  await click("Add to queue");
  await until(
    "Array.from(document.querySelectorAll('[data-sonner-toast][data-type=error]')).some(el => el.textContent.includes('No confident YouTube match'))"
  );
  assert.equal(
    await evaluate("document.querySelector('audio').getAttribute('src')"),
    null
  );
  await openQueue(0);
  await closeQueue();
  await evaluate("window.resolutionMode = 'success'");
  await keyboardClick("Play");
  await until(
    "document.querySelector('footer').textContent.includes('Catalog song')"
  );
  await keyboardClick("Track details for first");
  await until(
    "document.querySelector('[data-slot=popover-content]')?.textContent.includes('Resolved upload')"
  );
  assert.ok(
    await evaluate(
      "!!document.querySelector('[data-slot=popover-content] a[href*=youtube]')"
    )
  );
  await closeDetails();

  assert.ok(
    await evaluate(
      "document.querySelector('footer').textContent.includes('Catalog artist') && document.querySelector('footer').textContent.includes('Catalog album') && !document.querySelector('footer').textContent.includes('Resolved upload')"
    )
  );
  await evaluate(
    "Object.defineProperty(document.querySelector('audio'), 'duration', { configurable: true, value: 245 }); document.querySelector('audio').dispatchEvent(new Event('durationchange'))"
  );
  await until(
    "document.querySelector('footer input[aria-label=Seek]').max === '245' && document.querySelector('footer').textContent.includes('4:05')"
  );
  for (const width of [320, 375, 768, 1280]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    assert.equal(
      await evaluate("document.documentElement.scrollWidth <= innerWidth"),
      true
    );
    await keyboardClick("Track details for first");
    await until("!!document.querySelector('[data-slot=popover-content]')");
    assert.ok(
      await evaluate(
        "(() => { const rect = document.querySelector('[data-slot=popover-content]').getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })()"
      )
    );
    await closeDetails();
    await openActions("Play");
    assert.ok(
      await evaluate(`(() => {
      const r = document.querySelector('[role=menu]').getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth;
    })()`)
    );
    await key("End", 35);
    await key("ArrowRight", 39);
    await until("document.querySelectorAll('[role=menu]').length === 2");
    assert.ok(
      await evaluate(`Array.from(document.querySelectorAll('[role=menu]')).every(el => {
      const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth;
    })`)
    );
    await key("Escape", 27);
    await key("Escape", 27);
    await until("!document.querySelector('[role=menu]')");
  }
  await openQueue(0);
  await until(
    "document.querySelector('[aria-current=true] img')?.naturalWidth > 0"
  );
  await until("document.querySelector('footer img')?.naturalWidth > 0");
  assert.ok(
    await evaluate(
      "document.querySelector('[aria-current=true]').textContent.includes('Catalog song') && !document.querySelector('[aria-current=true]').textContent.includes('4:05') && !document.querySelector('[aria-current=true]').textContent.includes('Explicit')"
    )
  );
  await keyboardClick("Track details for current track Catalog song");
  await until(
    "document.querySelector('[data-slot=popover-content]')?.textContent.includes('4:05')"
  );
  await closeDetails();
  assert.ok(
    await evaluate("!!document.querySelector('[data-slot=sheet-content]')")
  );
  await closeQueue();
  const source = await evaluate("document.querySelector('audio').src");
  await submit("second");
  await until("document.querySelector('article h2')?.textContent === 'second'");
  await evaluate("window.resolutionMode = 'slow'");
  await click("Add to queue");
  await submit("latest");
  await until("document.querySelector('article h2')?.textContent === 'latest'");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await openQueue(0);
  await closeQueue();
  assert.equal(await evaluate("document.querySelector('audio').src"), source);
  await evaluate("window.resolutionMode = 'success'");
  await click("Add to queue");
  await until(
    "Array.from(document.querySelectorAll('[data-sonner-toast][data-type=success]')).some(el => el.textContent.includes('Added to queue'))"
  );
  await openQueue(1);
  await until(
    "document.querySelector('[aria-label=\"Upcoming tracks\"] img')?.naturalWidth > 0"
  );

  await keyboardClick("Track details for queued track 1. Catalog song");
  await until(
    "document.querySelector('[data-slot=popover-content]')?.textContent.includes('Pop')"
  );
  await closeDetails();
  await closeQueue();
  await submit("slow");
  await submit("fast");
  await until("document.querySelector('article h2')?.textContent === 'fast'");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(
    await evaluate("document.querySelector('article h2').textContent"),
    "fast"
  );
  await evaluate(
    "document.querySelector('button[aria-label=\"Storefront\"]').click()"
  );
  await until("!!document.querySelector('[role=option]')");
  await evaluate(
    "Array.from(document.querySelectorAll('[role=option]')).find(el => el.textContent.includes('Singapore')).click()"
  );
  await until("!document.querySelector('article')");
  await submit("singapore");
  await until(
    "document.querySelector('article h2')?.textContent === 'singapore'"
  );
  assert.ok(await evaluate("catalogRequests.at(-1).includes('country=SG')"));
  await submit("empty");
  await until("document.body.textContent.includes('No track found')");
  await submit("throttle");
  await until(
    "document.body.textContent.includes('iTunes is limiting requests')"
  );
  assert.equal(await evaluate("document.querySelector('audio').src"), source);
  console.log(
    "PASS submit-only catalog search, storefront, metadata, keyboard resolution/retry, failed-match safety, stale search/action suppression, empty/throttled states and playback preservation"
  );
} finally {
  socket.close();
}
