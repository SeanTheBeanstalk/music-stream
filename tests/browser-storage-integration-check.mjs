// Live R2 + isolated Postgres + application stream route. Requires a running
// app using TEST_DATABASE_URL as DATABASE_URL and R2_PLAYBACK_ENABLED=true.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { uploadAudio, deleteAudio, headAudio } from "../lib/server/storage.ts";
import { AUDIO_PROFILE } from "../lib/server/music-repository.ts";
import { getR2Client } from "../lib/server/r2.ts";

assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to an isolated migrated database");
assert.ok(process.env.TEST_ORIGIN, "Set TEST_ORIGIN to the app configured with the same test database");
const origin = new URL(process.env.TEST_ORIGIN).origin;
const database = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
const videoId = randomBytes(8).toString("base64url");
const key = `verification/app-stream-${randomUUID()}.wav`;
const duration = 12;
const rate = 48000;
const wav = Buffer.alloc(44 + rate * 2 * duration);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < rate * duration; i++) wav.writeInt16LE(Math.round(300 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
let uploaded = false;
let socket;
const pending = new Map();
let sequence = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  await uploadAudio(key, wav, "audio/wav"); uploaded = true;
  const stored = await headAudio(key);
  assert.equal(stored.ContentLength, wav.length);
  await database.query("INSERT INTO public.youtube_sources (video_id,canonical_url,upload_title) VALUES ($1,$2,'Temporary generated audio fixture')", [videoId, `https://www.youtube.com/watch?v=${videoId}`]);
  await database.query(`INSERT INTO public.audio_assets
    (video_id,profile_key,object_key,state,mime_type,codec,container,byte_size,duration_seconds,checksum)
    VALUES ($1,$2,$3,'ready','audio/wav','pcm_s16le','wav',$4,$5,$6)`,
  [videoId, AUDIO_PROFILE, key, wav.length, duration, createHash("sha256").update(wav).digest("hex")]);
  const url = `${origin}/api/stream/${videoId}`;
  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/wav");
  assert.equal(full.headers.get("content-length"), String(wav.length));
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), wav);
  for (const [range, start, end] of [["bytes=10-29", 10, 29], ["bytes=-20", wav.length - 20, wav.length - 1], ["bytes=100-", 100, wav.length - 1]]) {
    const response = await fetch(url, { headers: { range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${wav.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav.subarray(start, end + 1));
  }
  const invalid = await fetch(url, { headers: { range: `bytes=${wav.length + 10}-` } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), `bytes */${wav.length}`);
  assert.equal((await fetch(url, { headers: { range: "bytes=0-1,4-5" } })).status, 416);
  assert.equal((await fetch(`${origin}/api/stream/invalid`)).status, 400);

  const cdp = process.env.TEST_CDP || "http://127.0.0.1:9224";
  const version = await (await fetch(`${cdp}/json/version`)).json();
  const pages = await (await fetch(`${cdp}/json`)).json();
  const page = pages.find(p => p.type === "page" && (p.url === "about:blank" || p.url.startsWith(origin)));
  assert.ok(page, "Open a blank Edge tab with CDP enabled");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", event => {
    const response = JSON.parse(event.data);
    const entry = pending.get(response.id);
    if (!entry) return;
    clearTimeout(entry.timer); pending.delete(response.id);
    if (response.error) entry.reject(new Error(response.error.message)); else entry.resolve(response.result);
  });
  await send("Page.enable");
  await send("Page.navigate", { url: `${origin}/search` });
  // Wait for navigation to commit so the audio belongs to the application origin.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate("location.origin"), origin);
  const result = await evaluate(`(async () => {
    const audio = document.createElement('audio');
    document.body.append(audio);
    const wait = (name) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Audio timeout: ' + name)); }, 12000);
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('Audio error: ' + audio.error?.code)); };
      function cleanup() { clearTimeout(timeout); audio.removeEventListener(name, done); audio.removeEventListener('error', fail); }
      audio.addEventListener(name, done, {once:true}); audio.addEventListener('error', fail, {once:true});
    });
    try {
      const loaded = wait('loadedmetadata'); audio.src = ${JSON.stringify(url)}; await loaded;
      const duration = audio.duration;
      let sought = wait('seeked'); audio.currentTime = 8; await sought; const forward = audio.currentTime;
      sought = wait('seeked'); audio.currentTime = 2; await sought; const backward = audio.currentTime;
      await audio.play(); await new Promise(resolve => setTimeout(resolve, 600));
      return {duration, forward, backward, position:audio.currentTime, error:audio.error?.code ?? null};
    } finally { audio.pause(); audio.removeAttribute('src'); audio.load(); audio.remove(); }
  })()`);
  assert.equal(result.duration, duration);
  assert.ok(Math.abs(result.forward - 8) < 0.1);
  assert.ok(Math.abs(result.backward - 2) < 0.1);
  assert.ok(result.position > 2.2);
  assert.equal(result.error, null);
  console.log(JSON.stringify({ browser: version.Browser, httpRanges: "passed", playback: result }));
} finally {
  socket?.close();
  for (const entry of pending.values()) clearTimeout(entry.timer);
  try {
    await database.query("DELETE FROM public.audio_assets WHERE video_id=$1", [videoId]);
    await database.query("DELETE FROM public.youtube_sources WHERE video_id=$1", [videoId]);
    if (uploaded) {
      await deleteAudio(key);
      await assert.rejects(headAudio(key), error => error.$metadata?.httpStatusCode === 404);
    }
  } finally { await database.end(); getR2Client().destroy(); }
}
