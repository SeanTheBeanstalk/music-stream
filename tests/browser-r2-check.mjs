// Live provider check: creates and deletes one private R2 object. Requires Edge CDP.
// No app routes or external-service stubs are used by this isolated delivery harness.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import {
  uploadAudio,
  headAudio,
  getAudio,
  getAudioPlayUrl,
  deleteAudio,
} from "../lib/server/storage.ts";
import { getR2Client } from "../lib/server/r2.ts";

const key = `verification/browser-${randomUUID()}.wav`;
const duration = 12;
const rate = 48000;
const wav = Buffer.alloc(44 + rate * 2 * duration);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < rate * duration; i++)
  wav.writeInt16LE(
    Math.round(300 * Math.sin((2 * Math.PI * 440 * i) / rate)),
    44 + i * 2
  );

const transfers = [];
const sockets = new Set();
const tasks = new Set();
let signedUrl;
let socket;
let uploaded = false;
let id = 0;
const pending = new Map();
const server = createServer((req, res) => {
  const task = handle(req, res);
  tasks.add(task);
  void task.finally(() => tasks.delete(task));
});
server.on("connection", (connection) => {
  sockets.add(connection);
  connection.on("close", () => sockets.delete(connection));
});

async function handle(req, res) {
  if (req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Cache-Control": "no-store",
    });
    res.end(
      '<!doctype html><title>R2 playback verification</title><audio controls preload="metadata"></audio>'
    );
    return;
  }
  if (!["/audio", "/cancel", "/missing"].includes(req.url)) {
    res.writeHead(404).end();
    return;
  }
  const controller = new AbortController();
  const record = {
    path: req.url,
    range: req.headers.range ?? null,
    bytes: 0,
    aborted: false,
    closed: false,
  };
  transfers.push(record);
  let body;
  res.on("close", () => {
    if (!res.writableFinished) {
      record.aborted = true;
      controller.abort();
      body?.destroy();
    }
  });
  try {
    const result = await getAudio(
      req.url === "/missing" ? `${key}.missing` : key,
      {
        range: req.headers.range,
        signal: controller.signal,
      }
    );
    body = result.Body;
    record.status = result.$metadata.httpStatusCode;
    record.contentRange = result.ContentRange ?? null;
    record.length = result.ContentLength;
    if (controller.signal.aborted) {
      body.destroy();
      return;
    }
    res.writeHead(record.status, {
      "Content-Type": result.ContentType,
      "Content-Length": result.ContentLength,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      ...(result.ContentRange ? { "Content-Range": result.ContentRange } : {}),
    });
    for await (const chunk of body) {
      if (controller.signal.aborted) break;
      record.bytes += chunk.length;
      if (!res.write(chunk))
        await once(res, "drain", { signal: controller.signal });
      if (req.url === "/cancel")
        await delay(100, undefined, { signal: controller.signal });
    }
    if (!controller.signal.aborted) res.end();
  } catch (error) {
    record.status ??= error.$metadata?.httpStatusCode;
    if (!controller.signal.aborted) {
      if (res.headersSent) res.destroy();
      else
        res
          .writeHead(
            record.status === 404 ? 404 : record.status === 416 ? 416 : 502
          )
          .end();
    }
  } finally {
    body?.destroy();
    record.closed = true;
    record.bodyDestroyed = body?.destroyed ?? false;
  }
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP timeout: ${method}`));
    }, 20000);
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
  // Browser exceptions may contain signed URLs: never print their details.
  assert.ok(
    !result.exceptionDetails,
    "Browser evaluation failed (details withheld to protect signed URLs)"
  );
  return result.result.value;
}
async function until(expression, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error("Timed out waiting for browser playback condition");
}
async function checkPlayback(source, label) {
  await evaluate(`(() => {
    const a = document.querySelector('audio');
    a.pause(); a.src = ${JSON.stringify(source)}; a.load();
  })()`);
  await until("document.querySelector('audio').readyState >= 1");
  const state = await evaluate(`(() => {
    const a = document.querySelector('audio');
    return { duration: a.duration, seekable: a.seekable.length };
  })()`);
  assert.ok(
    Math.abs(state.duration - duration) < 0.05,
    `${label}: actual duration`
  );
  assert.ok(state.seekable > 0, `${label}: seekable ranges`);
  await evaluate("document.querySelector('audio').play()");
  await until("document.querySelector('audio').currentTime > 0.25");
  for (const position of [8, 2]) {
    await evaluate(`document.querySelector('audio').currentTime = ${position}`);
    await until(
      `(() => { const a = document.querySelector('audio'); return !a.seeking && a.currentTime >= ${position} && a.currentTime < ${position + 2} && !a.paused && !a.error; })()`
    );
  }
  // Play the whole file from zero at normal speed, rather than seeking to its end.
  await evaluate("document.querySelector('audio').currentTime = 0");
  const started = Date.now();
  await until("document.querySelector('audio').ended", 20000);
  assert.ok(
    Date.now() - started >= 10000,
    `${label}: full playback at normal speed`
  );
  assert.equal(
    await evaluate("document.querySelector('audio').error?.code ?? null"),
    null
  );
  console.log(
    `PASS ${label}: ${state.duration}s duration, forwards/backwards seeking, full playback`
  );
}

try {
  const cdp = process.env.TEST_CDP || "http://127.0.0.1:9224";
  const version = await (
    await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(5000) })
  ).json();
  assert.match(version.Browser, /Edg\//, "Use Microsoft Edge for this check");
  const pages = await (
    await fetch(`${cdp}/json`, { signal: AbortSignal.timeout(5000) })
  ).json();
  const page = pages.find((p) => p.type === "page" && p.url === "about:blank");
  assert.ok(page, "Open a blank Edge tab with remote debugging enabled");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, "open");
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(event.data);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.error) request.reject(new Error("CDP command failed"));
    else request.resolve(response.result);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Set before upload: a timed-out PUT may still have created the object.
  uploaded = true;
  await uploadAudio(key, wav, "audio/wav");
  const head = await headAudio(key);
  assert.equal(head.ContentLength, wav.length);
  assert.equal(head.ContentType, "audio/wav");
  signedUrl = await getAudioPlayUrl(key, 900);
  const privateResponse = await fetch(signedUrl.split("?")[0], {
    signal: AbortSignal.timeout(10000),
  });
  const privateBody = await privateResponse.text();
  const privateCode =
    /<Code>([A-Za-z0-9]+)<\/Code>/.exec(privateBody)?.[1] ?? "unknown";
  console.log(
    `Unsigned access response: HTTP ${privateResponse.status}, ${privateCode}`
  );
  assert.ok(
    [400, 401, 403].includes(privateResponse.status),
    "Unsigned object reads must be denied"
  );
  console.log(
    `PASS private upload and HEAD (${wav.length} bytes); unsigned access denied`
  );
  await send("Page.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.navigate", { url: origin });
  await until("!!document.querySelector('audio')");
  await checkPlayback(signedUrl, "Direct signed R2 audio");
  await checkPlayback(`${origin}/audio`, "Adapter-backed private proxy audio");
  const ranged = await evaluate(`(async () => {
    const r = await fetch('/audio', { headers: { Range: 'bytes=960044-1056043' } });
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, range: r.headers.get('content-range'), length: bytes.length };
  })()`);
  assert.deepEqual(ranged, {
    status: 206,
    range: `bytes 960044-1056043/${wav.length}`,
    length: 96000,
  });
  assert.ok(
    transfers.some((r) => r.range && r.status === 206 && r.contentRange),
    "Real R2 ranged response"
  );
  assert.equal(
    await evaluate(
      "fetch('/audio', { headers: { Range: 'bytes=999999999-' } }).then(r=>r.status)"
    ),
    416
  );
  assert.equal(await evaluate("fetch('/missing').then(r=>r.status)"), 404);
  console.log(
    "PASS real R2 206/Content-Range, unsatisfiable range 416, and missing object 404"
  );
  await evaluate(`(async () => {
    const c = new AbortController();
    const r = await fetch('/cancel', { signal: c.signal });
    const reader = r.body.getReader(); await reader.read(); c.abort();
    try { await reader.cancel(); } catch { /* Expected cancellation. */ }
  })()`);
  for (
    let n = 0;
    n < 50 && !transfers.some((r) => r.path === "/cancel" && r.closed);
    n++
  )
    await delay(100);
  const cancelled = transfers.find((r) => r.path === "/cancel");
  assert.ok(cancelled?.aborted && cancelled.bodyDestroyed && cancelled.closed);
  assert.ok(
    cancelled.bytes < wav.length,
    "Cancellation stops adapter body consumption before EOF"
  );
  console.log(
    "PASS client cancellation aborts the harness request and destroys the R2 body before EOF"
  );
  console.log(
    `PASS Edge ${version.Browser}; no application playback routes were changed`
  );
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await send("Page.navigate", { url: "about:blank" }).catch(() => {});
    socket.close();
  }
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("Check ended"));
  }
  for (const connection of sockets) connection.destroy();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await Promise.allSettled([...tasks]);
  try {
    if (uploaded) {
      await deleteAudio(key);
      await assert.rejects(
        headAudio(key),
        (error) => error.$metadata?.httpStatusCode === 404
      );
      console.log("PASS temporary R2 object deleted and HEAD confirms 404");
    }
  } finally {
    getR2Client().destroy();
  }
}
