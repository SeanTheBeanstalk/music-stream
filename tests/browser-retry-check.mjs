// Uses real Edge media playback with HTTP 502 responses followed by a WAV stream.
import assert from "node:assert/strict";
const origin = process.env.TEST_ORIGIN || "http://localhost:3001";
const cdp = process.env.TEST_CDP || "http://127.0.0.1:9224";
const pages = await (await fetch(`${cdp}/json`)).json();
const page = pages.find(
  (p) =>
    p.type === "page" && (p.url === "about:blank" || p.url.startsWith(origin))
);
assert.ok(page, "Open a blank Edge tab with remote debugging enabled");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) =>
  socket.addEventListener("open", resolve, { once: true })
);
let id = 0;
const pending = new Map();
let requests = 0;
let alwaysFail = false;
let partial = false;
const wav = Buffer.alloc(44 + 8000 * 2 * 20);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
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
socket.addEventListener("message", async (event) => {
  const response = JSON.parse(event.data);
  if (pending.has(response.id)) {
    const { resolve, reject, timer } = pending.get(response.id);
    pending.delete(response.id);
    clearTimeout(timer);
    if (response.error) reject(new Error(response.error.message));
    else resolve(response.result);
  }
  if (response.method === "Fetch.requestPaused") {
    const { requestId, request } = response.params;
    if (request.url.includes("/api/stream/")) {
      requests++;
      const fail = partial ? requests > 1 : alwaysFail || requests <= 2;
      const slice = partial && !fail ? wav.subarray(0, 1644) : wav;
      console.log(`Stream request ${requests}: ${fail ? 502 : 200}`);
      await send("Fetch.fulfillRequest", {
        requestId,
        responseCode: fail ? 502 : partial ? 206 : 200,
        responseHeaders: [
          {
            name: "Content-Type",
            value: fail ? "application/json" : "audio/wav",
          },
          { name: "Cache-Control", value: "no-store" },
          ...(!fail && partial
            ? [
                { name: "Accept-Ranges", value: "bytes" },
                {
                  name: "Content-Range",
                  value: `bytes 0-${slice.length - 1}/${wav.length}`,
                },
              ]
            : []),
        ],
        body: fail
          ? Buffer.from('{"error":"Temporary upstream failure"}').toString(
              "base64"
            )
          : slice.toString("base64"),
      });
    } else {
      const track = {
        id: "dQw4w9WgXcQ",
        title: "Retry test",
        uploader: "Test",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        duration: 20,
      };
      const body = request.url.includes("/api/search")
        ? {
            tracks: [
              {
                id: "itunes:123",
                trackId: 123,
                country: "US",
                title: "Retry test",
                artist: { name: "Test" },
                album: { name: "Test" },
              },
            ],
          }
        : { track };
      await send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64"),
      });
    }
  }
});
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
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out: ${expression}; ${await evaluate("document.querySelector('footer')?.textContent")}`
  );
}
try {
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await send("Page.navigate", { url: `${origin}/search` });
  await until(
    "!!document.querySelector('#music-search') && Object.keys(document.querySelector('#music-search')).some(k=>k.startsWith('__reactProps'))"
  );
  await evaluate(`(() => {
    const input = document.querySelector('#music-search');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Retry test');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').requestSubmit();
  })()`);
  await until("!!document.querySelector('article button')");
  await evaluate(
    "Array.from(document.querySelectorAll('article button')).find(b=>b.textContent==='Play').click()"
  );
  await until("document.querySelector('audio').currentTime > 0.1");
  assert.ok(requests >= 3, "Audio must retry real HTTP 502s before playing");
  console.log("PASS real media recovers from HTTP 502 without another click");
  alwaysFail = true;
  await evaluate(
    "document.querySelector('audio').dispatchEvent(new Event('error'))"
  );
  await until(
    "document.querySelector('footer').textContent.includes('Retrying')"
  );
  await evaluate(
    "document.querySelector('footer button[aria-label=Pause]').click()"
  );
  const before = requests;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(requests, before);
  console.log("PASS pause cancels pending retry");
  partial = true;
  requests = 0;
  await evaluate(
    "Array.from(document.querySelectorAll('article button')).find(b=>b.textContent==='Play').click()"
  );
  await until(
    "document.querySelector('footer').textContent.includes('Retrying')"
  );
  assert.ok(requests >= 2, "Partial audio must request additional data");
  partial = false;
  alwaysFail = false;
  await until("document.querySelector('audio').currentTime > 0.1");
  assert.ok(requests >= 3, "Interrupted stream must reload before recovery");
  console.log(
    "PASS real media recovers after a partial response followed by HTTP 502"
  );
  await evaluate(
    "document.querySelector('footer button[aria-label=Pause]').click()"
  );
} finally {
  await send("Fetch.disable");
  socket.close();
}
