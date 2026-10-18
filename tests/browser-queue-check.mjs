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
    `Timed out: ${expression}; ${await evaluate("JSON.stringify({ active: document.activeElement.outerHTML, dialogs: document.querySelectorAll('[role=dialog]').length })")}`
  );
}
async function click(label) {
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)}).click()`
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
  await click(`Open queue (${count} upcoming)`);
  await until("!!document.querySelector('[role=dialog]')");
}
async function closeQueue() {
  await key("Escape", 27);
  await until("!document.querySelector('[role=dialog]')");
  assert.equal(
    await evaluate(
      "document.activeElement.getAttribute('aria-label')?.startsWith('Open queue')"
    ),
    true
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
  await click("Add to queue");
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
    HTMLMediaElement.prototype.load = function() { window.audioLoads++; };
    HTMLMediaElement.prototype.play = function() { this.dispatchEvent(new Event('play')); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function() { this.dispatchEvent(new Event('pause')); };
    const realFetch = window.fetch;
    window.fetch = (url, options) => String(url).startsWith('/api/search')
      ? Promise.resolve(new Response(JSON.stringify({ track: {
          id: 'dQw4w9WgXcQ', title: window.testTitle, uploader: 'Test uploader',
          artwork: '', duration: 120, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        }}), { headers: { 'Content-Type': 'application/json' }}))
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
  await add("Current");
  await add("Second");
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
  }
  console.log(
    "PASS queue layout at 320/375/768/1280px, keyboard opening, focus trap, Escape and focus restoration"
  );
} finally {
  socket.close();
}
