// Real account/library HTTP, isolated PostgreSQL, and configured private R2.
// Run against a production app using the same isolated TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { cleanupPlaylistCovers } from "../lib/server/playlist-covers.ts";
import { headAudio } from "../lib/server/storage.ts";
assert.ok(process.env.TEST_DATABASE_URL);
assert.ok(process.env.TEST_ORIGIN);
const origin = new URL(process.env.TEST_ORIGIN).origin;
const cdp = process.env.TEST_CDP || "http://127.0.0.1:9233";
const database = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL,
});
const username = `cover_${randomBytes(6).toString("hex")}`;
const password = "playlist metadata browser password";
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

async function key(key, code = key) {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode: key === "Enter" ? 13 : key === "Tab" ? 9 : 27,
    ...(key === "Enter" ? { text: "\r" } : {}),
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}
async function fillDescription(value) {
  await evaluate(
    `(() => {const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`
  );
}
async function upload(color) {
  const bytes = await sharp({
    create: { width: 60, height: 60, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  await evaluate(
    `(() => {const bytes=Uint8Array.from(atob('${bytes.toString("base64")}'),c=>c.charCodeAt(0));const files=new DataTransfer();files.items.add(new File([bytes],'cover.png',{type:'image/png'}));const el=document.querySelector('input[type=file]');el.files=files.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()`
  );
}
async function saved() {
  return evaluate("fetch('/api/library').then(r=>r.json())");
}
async function openEditor() {
  await evaluate(
    `document.querySelector('main header button[aria-label^="Edit " ]').focus()`
  );
  await key("Enter");
  await until("!!document.querySelector('textarea')");
}
try {
  const pages = await (await fetch(`${cdp}/json`)).json();
  socket = new WebSocket(
    pages.find((p) => p.type === "page").webSocketDebuggerUrl
  );
  await new Promise((resolve) =>
    socket.addEventListener("open", resolve, { once: true })
  );
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const job = pending.get(data.id);
    if (job) {
      clearTimeout(job.timer);
      pending.delete(data.id);
      if (data.error) job.reject(new Error(JSON.stringify(data.error)));
      else job.resolve(data.result);
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Page.navigate", { url: `${origin}/library` });
  await until("!!document.querySelector('input[name=username]')");
  await click("Create an account");
  await fill("input[name=username]", username);
  await fill("input[name=password]", password);
  await click("Create account");
  await until(
    `document.querySelector('aside')?.innerText.includes(${JSON.stringify(username)})`
  );
  await click("Create playlist");
  await fill("input[name=name]", "Metadata browser test");
  await fillDescription("Saved description\nSecond line");
  await upload("red");
  await click("Create");
  await until("!document.querySelector('textarea')");
  let playlist = (await saved()).playlists[0];
  assert.equal(playlist.description, "Saved description\nSecond line");
  assert.ok(playlist.coverUrl);
  assert.equal(
    await evaluate(
      `fetch(${JSON.stringify(playlist.coverUrl)}).then(r=>r.status)`
    ),
    200
  );
  assert.equal(
    (await fetch(origin + playlist.coverUrl)).status,
    401,
    "Anonymous cover access denied"
  );
  await evaluate(
    "document.querySelector('button[aria-label=\"Open Metadata browser test\"]').click()"
  );
  await until(
    "document.querySelector('main header')?.innerText.includes('Saved description')"
  );
  await until("document.querySelector('main header img')?.naturalWidth>0");
  await send("Page.reload");
  await until(
    "!!document.querySelector('button[aria-label=\"Open Metadata browser test\"]')"
  );
  await evaluate(
    "document.querySelector('button[aria-label=\"Open Metadata browser test\"]').click()"
  );
  await until("!!document.querySelector('main header')");
  await openEditor();
  assert.equal(await evaluate("document.activeElement.name"), "name");
  assert.equal(
    await evaluate("document.querySelector('textarea').value"),
    "Saved description\nSecond line"
  );
  await fillDescription("Discarded");
  await key("Escape");
  await until("!document.querySelector('textarea')");
  await openEditor();
  assert.equal(
    await evaluate("document.querySelector('textarea').value"),
    "Saved description\nSecond line"
  );
  for (const width of [320, 375, 768, 1280]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    assert.ok(
      await evaluate("document.documentElement.scrollWidth<=innerWidth"),
      `No overflow at ${width}`
    );
    assert.ok(
      await evaluate(
        "(()=>{const r=document.querySelector('[data-slot=dialog-content]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()"
      ),
      `Editor fits at ${width}`
    );
  }
  const oldKey = (
    await database.query(
      "SELECT cover_image_key FROM public.playlists WHERE id=$1",
      [playlist.id]
    )
  ).rows[0].cover_image_key;
  await fillDescription("Updated description");
  await upload("blue");
  await click("Save changes");
  await until("!document.querySelector('textarea')");
  playlist = (await saved()).playlists[0];
  assert.equal(playlist.description, "Updated description");
  await assert.rejects(
    headAudio(oldKey),
    (error) => error.$metadata?.httpStatusCode === 404
  );
  const staleStatus = await evaluate(
    `fetch('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update',playlistId:'${playlist.id}',revision:0,name:'Stale',description:'Lost'})}).then(r=>r.status)`
  );
  assert.equal(staleStatus, 409);
  await openEditor();
  await click("Remove custom image");
  await click("Save changes");
  await until("!document.querySelector('textarea')");
  assert.equal((await saved()).playlists[0].coverUrl, null);
  await openEditor();
  await upload("green");
  await click("Save changes");
  await until("!document.querySelector('textarea')");
  const lastKey = (
    await database.query(
      "SELECT cover_image_key FROM public.playlists WHERE id=$1",
      [playlist.id]
    )
  ).rows[0].cover_image_key;
  await openEditor();
  await click("Delete playlist");
  await click("Delete playlist");
  await until(
    "!document.querySelector('textarea') && !document.body.innerText.includes('Metadata browser test')"
  );
  assert.equal((await saved()).playlists.length, 0);
  await assert.rejects(
    headAudio(lastKey),
    (error) => error.$metadata?.httpStatusCode === 404
  );
  console.log(
    "PASS: Edge + real PostgreSQL/R2; create/upload, authenticated image delivery, description and cover reload persistence, cancel, keyboard focus, 320/375/768/1280px editor, replacement/removal/deletion cleanup, and stale-edit rejection."
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
  await cleanupPlaylistCovers(database);
  await database.end();
}
