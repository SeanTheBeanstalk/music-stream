// Run against a local server and a blank Chromium tab on TEST_CDP (port 9224).
// Search and audio are stubbed so queue behavior needs no YouTube connection.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
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
async function click(label) {
  await until(
    `Array.from(document.querySelectorAll('button, [role=menuitem]')).some(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)})`
  );
  await evaluate(
    `(() => {
      const button = Array.from(document.querySelectorAll('button, [role=menuitem]')).find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)});
      button.focus();
      button.click();
    })()`
  );
}
async function keyboardClick(label) {
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)}).focus()`
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
  await click(
    count === undefined
      ? await evaluate(
          "document.querySelector('button[aria-label^=\"Open queue\"]').getAttribute('aria-label')"
        )
      : `Open queue (${count} upcoming)`
  );
  await until("!!document.querySelector('[role=dialog]')");
}
async function closeQueue() {
  await key("Escape", 27);
  await until("!document.querySelector('[role=dialog]')");
  await until(
    "document.activeElement.getAttribute('aria-label')?.startsWith('Open queue')"
  );
}
async function add(title) {
  await evaluate(`window.testTitle = ${JSON.stringify(title)}; (() => {
    const input = document.querySelector('#music-search');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, window.testTitle);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate("document.querySelector('form').requestSubmit()");
  await until(
    `document.querySelector('article h2')?.textContent === ${JSON.stringify(title)}`
  );
  await click(`Actions for ${title}`);
  await click("Add to queue");
  await until(
    "Array.from(document.querySelectorAll('[data-sonner-toast][data-type=success]')).some(el => el.textContent.includes('Added to queue'))"
  );
}
const repeatLabels = {
  off: "Repeat: Off. Switch to Repeat track.",
  track: "Repeat track. Switch to Repeat queue.",
  queue: "Repeat queue. Switch to Repeat: Off.",
};
async function ended(restarts = true) {
  const loads = await evaluate("window.audioLoads");
  await evaluate(
    "document.querySelector('audio').dispatchEvent(new Event('ended'))"
  );
  if (restarts) await until(`window.audioLoads === ${loads + 1}`);
  else {
    await until("!!document.querySelector('footer button[aria-label=Play]')");
    assert.equal(await evaluate("window.audioLoads"), loads);
  }
}
const titles = () =>
  evaluate(
    "Array.from(document.querySelectorAll('ol[aria-label=\"Upcoming tracks\"] li p:first-child')).map(p => p.textContent)"
  );
try {
  await send("Page.enable");
  await send("Page.bringToFront");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    window.testTitle = '';
    window.audioLoads = 0;
    // Prevent real network media events from racing the deterministic audio stub.
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      get() { return this.testSource || ''; },
      set(value) { this.testSource = value; }
    });
    HTMLMediaElement.prototype.load = function() { window.audioLoads++; };
    HTMLMediaElement.prototype.play = function() {
      if (window.blockPlayback) return Promise.reject(new DOMException('User gesture required', 'NotAllowedError'));
      if (window.remainingFailures > 0) {
        window.remainingFailures--;
        this.dispatchEvent(new Event('error'));
        return Promise.reject(new DOMException('Stubbed stream failure', 'NotSupportedError'));
      }
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function() { this.dispatchEvent(new Event('pause')); };
    const realFetch = window.fetch;
    window.fetch = (url, options) => String(url).startsWith('/api/search')
      ? Promise.resolve(Response.json({ tracks: [{
          id: 'itunes:123', trackId: 123, provider: 'itunes', country: 'US', title: window.testTitle,
          artist: { id: 1, name: 'Test artist' }, album: { id: 2, name: 'Test album', releaseDate: null }, duration: 120, genre: null, explicitness: null, storeUrl: null
        }] }))
      : String(url).startsWith('/api/resolve')
      ? Promise.resolve(Response.json({ track: {
          id: 'dQw4w9WgXcQ', title: window.testTitle, uploader: 'Test uploader',
          artwork: '', duration: 120, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        }}))
      : realFetch(url, options);
  `,
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${origin}/search` });
  await until(
    "!!document.querySelector('#music-search') && !!Object.keys(document.querySelector('#music-search')).find(k => k.startsWith('__reactProps'))"
  );
  await openQueue(0);
  assert.equal(
    await evaluate(
      "document.querySelector('[role=dialog]').textContent.includes('Your queue is empty')"
    ),
    true
  );
  await closeQueue();
  // A new session must be circular without asking the user to change repeat mode.
  await until(
    `!!document.querySelector('button[aria-label="${repeatLabels.queue}"]')`
  );
  await keyboardClick(repeatLabels.queue);
  for (const mode of ["off", "track", "queue"]) {
    await ended(false);
    await keyboardClick(repeatLabels[mode]);
  }
  await add("Current");
  await openQueue(1);
  assert.deepEqual(await titles(), ["Current"]);
  assert.equal(
    await evaluate(
      "!document.querySelector('[aria-current=true]') && window.audioLoads === 0 && !document.querySelector('audio').getAttribute('src')"
    ),
    true
  );
  await closeQueue();
  await evaluate(
    "document.querySelector('footer button[aria-label=Play]').focus()"
  );
  await key("Enter", 13);
  await until(
    "document.querySelector('footer p')?.textContent === 'Current' && window.audioLoads === 1"
  );
  console.log(
    "PASS first addition stays upcoming without loading audio; keyboard Play starts it"
  );
  await ended(false);
  await keyboardClick(repeatLabels.off);
  await ended();
  assert.equal(
    await evaluate("document.querySelector('footer p').textContent"),
    "Current"
  );
  await keyboardClick(repeatLabels.track);
  await ended();
  console.log(
    "PASS empty queue, Off at boundary, Repeat track and single-track Repeat queue"
  );
  await add("Second");
  await keyboardClick(repeatLabels.queue);
  await keyboardClick(repeatLabels.off);
  await ended();
  assert.equal(
    await evaluate("document.querySelector('footer p').textContent"),
    "Current",
    "Repeat track must preserve upcoming tracks"
  );
  const errorLoads = await evaluate("window.audioLoads");
  await evaluate(
    "window.remainingFailures = 1; document.querySelector('audio').dispatchEvent(new Event('error'))"
  );
  await until(
    "document.querySelector('[data-sonner-toast][data-type=error]:not([data-removed=true])')?.textContent.includes('Retrying in 1s')"
  );
  assert.equal(await evaluate("window.audioLoads"), errorLoads);
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-sonner-toast][data-type=error]:not([data-removed=true])').length"
    ),
    1,
    "One playback error toast across retries"
  );
  await until(
    "document.querySelector('[data-sonner-toast][data-type=error]:not([data-removed=true])')?.textContent.includes('Retrying in 2s')"
  );
  await until(`window.audioLoads === ${errorLoads + 2}`);
  await until(
    "!document.querySelector('[data-sonner-toast][data-type=error]:not([data-removed=true])')?.textContent.includes('Retrying')"
  );
  await evaluate(
    "document.querySelector('audio').dispatchEvent(new Event('error'))"
  );
  await until(
    "document.querySelector('[data-sonner-toast][data-type=error]:not([data-removed=true])')?.textContent.includes('Retrying in 1s')"
  );
  await keyboardClick("Pause");
  const pausedLoads = await evaluate("window.audioLoads");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(await evaluate("window.audioLoads"), pausedLoads);
  await evaluate(
    "document.querySelector('footer button[aria-label=Play]').focus()"
  );
  await key("Enter", 13);
  console.log(
    "PASS automatic retry recovery with backoff, keyboard cancellation and manual resume"
  );
  await keyboardClick(repeatLabels.track);
  await ended();
  assert.equal(
    await evaluate("document.querySelector('footer p').textContent"),
    "Second"
  );
  await openQueue(1);
  assert.deepEqual(
    await titles(),
    ["Current"],
    "Completed song returns to the visible tail"
  );
  await closeQueue();
  await ended();
  assert.equal(
    await evaluate("document.querySelector('footer p').textContent"),
    "Current"
  );
  const repeatLoads = await evaluate("window.audioLoads");
  await evaluate("document.querySelector('a[href=\"/\"]').click()");
  await until("location.pathname === '/'");
  assert.equal(
    await evaluate(
      `!!document.querySelector('button[aria-label="${repeatLabels.queue}"]') && window.audioLoads === ${repeatLoads}`
    ),
    true
  );
  await evaluate("document.querySelector('a[href=\"/search\"]').click()");
  await until("!!document.querySelector('#music-search')");
  await keyboardClick(repeatLabels.queue);
  assert.equal(await evaluate("window.audioLoads"), repeatLoads);
  console.log(
    "PASS Repeat queue advances and wraps; mode survives navigation without reloading audio"
  );
  await add("Third");
  await add("Second");
  await evaluate(
    "window.savedAudio = document.querySelector('audio'); window.savedLoads = window.audioLoads; window.savedSource = savedAudio.src"
  );
  await openQueue(3);
  assert.deepEqual(await titles(), ["Second", "Third", "Second"]);
  await keyboardClick("Move up 2. Third");
  assert.deepEqual(await titles(), ["Third", "Second", "Second"]);
  await click("Move down 1. Third");
  assert.deepEqual(await titles(), ["Second", "Third", "Second"]);
  await keyboardClick("Remove queued track 3. Second");
  assert.deepEqual(await titles(), ["Second", "Third"]);
  assert.equal(
    await evaluate(
      "window.audioLoads === savedLoads && savedAudio.src === savedSource"
    ),
    true
  );
  await click("Play queued track 2. Third");
  await until(
    "document.querySelector('[aria-current=true] p')?.textContent === 'Third'"
  );
  assert.deepEqual(await titles(), ["Second"]);
  assert.equal(
    await evaluate("window.audioLoads === savedLoads + 1"),
    true,
    "Selecting the same video occurrence must reload it"
  );
  await closeQueue();
  await add("Fourth");
  await add("Fifth");
  await evaluate("window.savedLoads = window.audioLoads");
  await openQueue(3);
  await keyboardClick("Clear upcoming");
  assert.deepEqual(await titles(), []);
  assert.equal(await evaluate("window.audioLoads === savedLoads"), true);
  await closeQueue();
  await evaluate("document.querySelector('a[href=\"/\"]').click()");
  await until("location.pathname === '/'");
  assert.equal(
    await evaluate(
      "savedAudio === document.querySelector('audio') && window.audioLoads === savedLoads"
    ),
    true
  );
  await openQueue(0);
  assert.equal(
    await evaluate(
      "document.querySelector('[aria-current=true] p')?.textContent"
    ),
    "Third"
  );
  await closeQueue();
  console.log(
    "PASS queue ordering, duplicates, selection, removal, clear, and navigation persistence"
  );

  await evaluate("document.querySelector('a[href=\"/search\"]').click()");
  await until("!!document.querySelector('#music-search')");
  await add(
    "A very long upcoming track title for testing narrow mobile layouts and controls"
  );
  await add("Another queued track");

  for (const width of [320, 375, 768, 1280]) {
    console.log(`Checking keyboard queue at ${width}px`);
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 812,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await evaluate(
      "document.querySelector('button[aria-label^=\"Open queue\"]').focus()"
    );
    await key("Enter", 13);
    await until("!!document.querySelector('[role=dialog]')");
    await until(
      "document.querySelector('[role=dialog]').contains(document.activeElement)"
    );
    await until(
      "getComputedStyle(document.querySelector('[role=dialog]')).opacity === '1' && getComputedStyle(document.querySelector('[role=dialog]')).translate === 'none'"
    );
    assert.equal(
      await evaluate(
        "document.documentElement.scrollWidth <= innerWidth && document.querySelector('[role=dialog]').scrollWidth <= document.querySelector('[role=dialog]').clientWidth"
      ),
      true
    );
    if (width === 375) {
      const screenshot = await send("Page.captureScreenshot", {
        format: "png",
      });
      await writeFile(
        new URL("../.next/queue-mobile.png", import.meta.url),
        Buffer.from(screenshot.data, "base64")
      );
    }
    for (let i = 0; i < 10; i++) {
      await key("Tab", 9);
      await until(
        "document.querySelector('[role=dialog]').contains(document.activeElement)"
      );
    }
    await closeQueue();
    await keyboardClick(repeatLabels.off);
    await until(
      `!!document.querySelector('button[aria-label="${repeatLabels.track}"]')`
    );
    assert.equal(
      await evaluate(
        "document.documentElement.scrollWidth <= innerWidth && document.querySelector('footer').scrollWidth <= document.querySelector('footer').clientWidth"
      ),
      true
    );
    await keyboardClick(repeatLabels.track);
    await keyboardClick(repeatLabels.queue);
  }
  console.log(
    "PASS queue layout at 320/375/768/1280px, keyboard opening, focus trap, Escape and focus restoration"
  );

  await keyboardClick(repeatLabels.off);
  await keyboardClick(repeatLabels.track);
  await openQueue();
  await keyboardClick("Clear upcoming");
  assert.deepEqual(await titles(), []);
  await closeQueue();
  await add("Cycle first");
  await add("Cycle second");
  await ended();
  await openQueue(2);
  assert.deepEqual(await titles(), ["Cycle second", "Third"]);
  const cycleLoads = await evaluate("window.audioLoads");
  await keyboardClick("Move up 2. Third");
  assert.deepEqual(await titles(), ["Third", "Cycle second"]);
  await keyboardClick("Move down 1. Third");
  assert.deepEqual(await titles(), ["Cycle second", "Third"]);
  await keyboardClick("Remove queued track 2. Third");
  assert.deepEqual(await titles(), ["Cycle second"]);
  await until(
    "Array.from(document.querySelectorAll('[data-sonner-toast][data-type=success]')).some(el => el.textContent.includes('Removed Third from the queue.'))"
  );
  assert.equal(await evaluate("window.audioLoads"), cycleLoads);
  await closeQueue();
  await ended();
  await openQueue(1);
  assert.deepEqual(await titles(), ["Cycle first"]);
  await keyboardClick("Play queued track 1. Cycle first");
  await until(
    "document.querySelector('[aria-current=true] p')?.textContent === 'Cycle first'"
  );
  assert.deepEqual(await titles(), ["Cycle second"]);
  await keyboardClick("Clear upcoming");
  assert.deepEqual(await titles(), []);
  await closeQueue();
  console.log(
    "PASS full cycle display and wrapped selection, reordering, removal and clearing without restarting current audio"
  );

  await send("Page.reload", { ignoreCache: true });
  await until(
    "!!document.querySelector('#music-search') && !!Object.keys(document.querySelector('#music-search')).find(k => k.startsWith('__reactProps'))"
  );
  await until(
    `!!document.querySelector('button[aria-label="${repeatLabels.queue}"]')`
  );
  await add("Default first");
  await add("Default second");
  await add("Default third");
  await keyboardClick("Play");
  await until(
    "document.querySelector('footer p')?.textContent === 'Default first'"
  );
  for (let step = 0; step < 6; step++) {
    const order = ["Default first", "Default second", "Default third"];
    await openQueue(2);
    assert.deepEqual(await titles(), [
      order[(step + 1) % 3],
      order[(step + 2) % 3],
    ]);
    await closeQueue();
    await ended();
  }
  await keyboardClick("Previous track");
  await until(
    "document.querySelector('footer p')?.textContent === 'Default third'"
  );
  await keyboardClick("Next track");
  await until(
    "document.querySelector('footer p')?.textContent === 'Default first'"
  );
  await openQueue(2);
  assert.deepEqual(await titles(), ["Default second", "Default third"]);
  await closeQueue();
  await keyboardClick("Pause");
  await evaluate("window.blockPlayback = true");
  await keyboardClick("Play");
  await until(
    "Array.from(document.querySelectorAll('[data-sonner-toast][data-type=error]')).some(el => el.textContent.includes('Your browser requires you to press Play'))"
  );
  assert.equal(
    await evaluate(
      "document.querySelector('footer').textContent.includes('Your browser requires')"
    ),
    false
  );
  await evaluate("window.blockPlayback = false");
  await keyboardClick("Play");
  await until(
    "!document.querySelector('[data-sonner-toast][data-type=error]:not([data-removed=true])')"
  );
  console.log(
    "PASS fresh session keeps two upcoming tracks across six endings, wraps Previous/Next, and shows/clears browser restriction toasts"
  );
} finally {
  socket.close();
}
