// Run against an isolated, migrated TEST_DATABASE_URL and a production app using it.
// Headless Edge must expose TEST_CDP (default port 9226). Catalog search and
// audio are deterministic fixtures; account/library HTTP requests use real PG.
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import pg from "pg";
import { normalizeCatalog } from "../lib/music/catalog.ts";
import { normalizeTrack } from "../lib/music/track.ts";
import { createMusicRepository } from "../lib/server/music-repository.ts";

assert.ok(process.env.TEST_DATABASE_URL, "Use an isolated test database");
assert.ok(process.env.TEST_ORIGIN, "Set TEST_ORIGIN to the isolated app");
const origin = new URL(process.env.TEST_ORIGIN).origin;
const cdp = process.env.TEST_CDP || "http://127.0.0.1:9226";
const database = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 2,
});
const username = `edge_${randomBytes(6).toString("hex")}`;
const password = "edge library test password";
const trackId = randomInt(1_000_000_000, 2_000_000_000);
const track = normalizeCatalog(
  {
    kind: "song",
    trackId,
    trackName: "Library browser fixture",
    artistName: "Test artist",
    collectionName: "Test album",
  },
  "SG"
);
const source = normalizeTrack({
  id: randomBytes(8).toString("base64url"),
  title: "Fixture audio",
});
const pending = new Map();
let sequence = 0;
let socket;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 120; i++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out: ${expression}; page: ${await evaluate("document.body.innerText")}`
  );
}
const fill = (selector, value) =>
  evaluate(
    `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`
  );
async function click(text) {
  const expression = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`;
  await until(`!!(${expression})`);
  await evaluate(`(${expression}).click()`);
}
async function link(path) {
  await evaluate(`document.querySelector('a[href="${path}"]').click()`);
  await until(`location.pathname===${JSON.stringify(path)}`);
}
const wav = Buffer.alloc(44 + 48000 * 2 * 30);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
try {
  const music = createMusicRepository(database);
  await music.saveCatalog(track);
  await music.selectSource(track, source);
  const pages = await (await fetch(`${cdp}/json`)).json();
  const page = pages.find((p) => p.type === "page");
  assert.ok(page, "Start a dedicated Edge CDP session");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const job = pending.get(data.id);
      if (!job) return;
      clearTimeout(job.timer);
      pending.delete(data.id);
      if (data.error) job.reject(new Error(JSON.stringify(data.error)));
      else job.resolve(data.result);
    } else if (data.method === "Fetch.requestPaused") {
      const audio = data.params.request.url.includes("/api/stream/");
      void send("Fetch.fulfillRequest", {
        requestId: data.params.requestId,
        responseCode: 200,
        responseHeaders: [
          {
            name: "Content-Type",
            value: audio ? "audio/wav" : "application/json",
          },
        ],
        body: audio
          ? wav.toString("base64")
          : Buffer.from(JSON.stringify({ tracks: [track] })).toString("base64"),
      }).catch(() => {});
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", {
    patterns: [
      { urlPattern: "*/api/search?*" },
      { urlPattern: "*/api/stream/*" },
    ],
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${origin}/library` });
  await until("!!document.querySelector('input[name=username]')");
  await click("Create an account");
  await fill("input[name=username]", username);
  await fill("input[name=password]", password);
  await click("Create account");
  await until("document.body.innerText.includes('Signed in as')");
  await click("Create playlist");
  await fill("input[name=name]", "Edge favorites");
  await click("Create");
  await until("document.body.innerText.includes('Edge favorites')");
  await link("/search");
  const searchInput = await evaluate(
    "document.querySelector('input[type=search]')?.outerHTML || document.querySelector('main input')?.outerHTML"
  );
  assert.ok(searchInput, "Search input exists");
  await fill("main input", "library fixture");
  await evaluate("document.querySelector('main form').requestSubmit()");
  await until(
    "document.querySelector('main').innerText.includes('Library browser fixture')"
  );
  // Save before playback: no source resolution is required to like or add.
  await click("Like");
  await until("document.body.innerText.includes('Saved to liked songs.')");
  await click("Add to playlist");
  await click("Edge favorites");
  await until("document.body.innerText.includes('Added to Edge favorites.')");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
  await click("Play");
  await until(
    "!!document.querySelector('audio') && document.querySelector('audio').currentTime>0"
  );
  await evaluate(
    "void (window.__libraryAudio=document.querySelector('audio'))"
  );
  await link("/library");
  assert.equal(
    await evaluate("document.querySelector('audio')===window.__libraryAudio"),
    true
  );
  await until("document.body.innerText.includes('Edge favorites')");
  await click("Liked Songs");
  await until(
    "document.querySelector('main').innerText.includes('Library browser fixture')"
  );
  await send("Page.reload");
  await until("document.body.innerText.includes('Signed in as')");
  await click("Liked Songs");
  await until(
    "document.querySelector('main').innerText.includes('Library browser fixture')"
  );
  await click("Back to library");
  await click("Edge favorites");
  await until(
    "document.querySelector('main').innerText.includes('Library browser fixture')"
  );
  // Add a second occurrence and reorder via keyboard-accessible buttons.
  await click("Add to playlist");
  await click("Edge favorites");
  await until("document.querySelectorAll('main ol > li').length===2");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
  await click("Down");
  await until("document.body.innerText.includes('Playlist order updated.')");
  await click("Remove");
  await until("document.querySelectorAll('main ol > li').length===1");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.equal(
    await evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
    "Mobile detail has no horizontal overflow"
  );
  await click("Back to library");
  assert.equal(
    await evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
    "Mobile library has no horizontal overflow"
  );
  for (const width of [320, 375, 768, 1280]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    assert.equal(
      await evaluate("document.documentElement.scrollWidth<=innerWidth"),
      true,
      `Library has no overflow at ${width}px`
    );
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await evaluate("document.querySelector('a[href=\"/library\"]').focus()");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  assert.equal(
    await evaluate(
      "document.activeElement?.textContent.includes('Create playlist')"
    ),
    true,
    "Keyboard navigation reaches playlist creation"
  );
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  if (process.env.TEST_SCREENSHOT) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      process.env.TEST_SCREENSHOT,
      Buffer.from(screenshot.data, "base64")
    );
  }
  const persisted = await evaluate("fetch('/api/library').then(r=>r.json())");
  assert.equal(persisted.likes.length, 1);
  assert.equal(persisted.playlists[0].items.length, 1);
  // Another fresh browser context can authenticate to the same durable library.
  await click("Sign out");
  await until("!!document.querySelector('input[name=username]')");
  await fill("input[name=username]", username);
  await fill("input[name=password]", password);
  await click("Sign in");
  await until("document.body.innerText.includes('Edge favorites')");
  await evaluate(
    "document.querySelector('button[aria-label=\"Edit Edge favorites\"]').click()"
  );
  await fill("input[name=name]", "Renamed favorites");
  await click("Rename");
  await until("document.body.innerText.includes('Renamed favorites')");
  await evaluate(
    "document.querySelector('button[aria-label=\"Edit Renamed favorites\"]').click()"
  );
  await click("Delete playlist");
  await click("Delete playlist");
  await until("!document.body.innerText.includes('Renamed favorites')");
  assert.equal(
    (await evaluate("fetch('/api/library').then(r=>r.json())")).playlists
      .length,
    0
  );
  console.log(
    "PASS: real account/library HTTP + PostgreSQL; fixture search/audio; saving before playback, playlist create/rename/delete/add/remove/reorder, duplicate entries, playback across navigation, reload and reauthentication, keyboard and 320/375/768/1280px layouts."
  );
} finally {
  socket?.close();
  for (const job of pending.values()) clearTimeout(job.timer);
  await database.query(
    "DELETE FROM public.users WHERE auth_provider='password' AND auth_subject=$1",
    [username]
  );
  await database.query(
    "DELETE FROM public.account_attempts WHERE username=$1",
    [username]
  );
  await database.query("DELETE FROM public.track_sources WHERE video_id=$1", [
    source.id,
  ]);
  await database.query(
    "DELETE FROM public.catalog_tracks WHERE provider_track_id=$1",
    [String(trackId)]
  );
  await database.query("DELETE FROM public.youtube_sources WHERE video_id=$1", [
    source.id,
  ]);
  await database.end();
}
