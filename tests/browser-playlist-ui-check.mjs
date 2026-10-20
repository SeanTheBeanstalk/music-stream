// Fixture-only UI check. Run with a dev server and dedicated headless Edge CDP.
// Does not write to the real library or exercise live music providers.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { normalizeCatalog } from "../lib/music/catalog.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3000";
const cdp = process.env.TEST_CDP || "http://127.0.0.1:9232";
const tracks = [1, 2].map((id) =>
  normalizeCatalog(
    {
      kind: "song",
      trackId: id,
      trackName: id === 1 ? "GET IT" : "SOMEBODY",
      artistName: "Fixture artist",
      collectionName: "Fixture album",
      trackTimeMillis: 151000,
      trackExplicitness: "explicit",
    },
    "SG"
  )
);
const playlist = {
  id: "fixture-playlist",
  name: "Evening favorites",
  revision: 1,
  updatedAt: new Date().toISOString(),
  items: [0, 1, 0].map((i, n) => ({ id: `entry-${n}`, track: tracks[i] })),
};
const library = {
  user: { name: "Music lover" },
  likes: [],
  playlists: [playlist],
};
let failResolve = false;
const resolutions = [];
const pages = await (await fetch(`${cdp}/json`)).json();
const page = pages.find((p) => p.type === "page");
assert.ok(page, "Start a dedicated headless Edge CDP session");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) =>
  socket.addEventListener("open", resolve, { once: true })
);
const pending = new Map();
const fieldWarnings = [];
let sequence = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
socket.onmessage = async (event) => {
  const data = JSON.parse(event.data);
  if (data.id) {
    const job = pending.get(data.id);
    if (!job) return;
    clearTimeout(job.timer);
    pending.delete(data.id);
    if (data.error) job.reject(new Error(JSON.stringify(data.error)));
    else job.resolve(data.result);
  } else if (data.method === "Runtime.consoleAPICalled") {
    const message = data.params.args.map((arg) => arg.value ?? "").join(" ");
    if (/uncontrolled|controlled FieldControl/.test(message))
      fieldWarnings.push(message);
  } else if (data.method === "Fetch.requestPaused") {
    const { request, requestId } = data.params;
    const url = new URL(request.url);
    let body = library;
    let status = 200;
    if (url.pathname === "/api/library" && request.method === "POST") {
      const headers = new Headers(request.headers);
      let command;
      if (headers.get("content-type")?.startsWith("multipart/form-data")) {
        const form = await new Request(request.url, {
          method: "POST",
          headers,
          body: request.postData,
        }).formData();
        command = JSON.parse(String(form.get("command")));
        playlist.coverUrl =
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
      } else command = JSON.parse(request.postData);
      if (command.action === "rename" || command.action === "update")
        playlist.name = command.name;
      if (command.action === "update")
        playlist.description = command.description;
      if (command.action === "reorder")
        playlist.items.sort(
          (a, b) =>
            command.itemIds.indexOf(a.id) - command.itemIds.indexOf(b.id)
        );
      if (command.action === "remove")
        playlist.items = playlist.items.filter(
          (item) => item.id !== command.itemId
        );
      playlist.revision++;
    } else if (url.pathname === "/api/resolve") {
      resolutions.push(Number(url.searchParams.get("id")));
      const catalog = tracks[Number(url.searchParams.get("id")) - 1];
      body = failResolve
        ? { error: "Fixture track unavailable. Please retry." }
        : {
            track: {
              id: catalog.trackId === 1 ? "rboiHxBqdZk" : "dQw4w9WgXcQ",
              title: catalog.title,
              url: "https://www.youtube.com/watch?v=rboiHxBqdZk",
              uploader: null,
              duration: 151,
              catalog,
            },
          };
      if (failResolve) status = 503;
    }
    void send("Fetch.fulfillRequest", {
      requestId,
      responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    }).catch(() => {});
  }
};
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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${expression}`);
}
const click = (selector) =>
  evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function fill(selector, text) {
  await evaluate(
    `document.querySelector(${JSON.stringify(selector)}).focus(); document.querySelector(${JSON.stringify(selector)}).select()`
  );
  await send("Input.insertText", { text });
}
async function selectImage(name, type = "image/png") {
  await evaluate(`(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    const files = new DataTransfer();
    files.items.add(new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
    const input = document.querySelector('input[type=file]');
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}
async function key(key, code = key) {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    ...(key === "Enter" ? { text: "\r" } : {}),
    windowsVirtualKeyCode: key === "Enter" ? 13 : 27,
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Fetch.enable", {
    patterns: [
      { urlPattern: "*/api/library" },
      { urlPattern: "*/api/resolve?*" },
      { urlPattern: "*/api/stream/*" },
    ],
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${origin}/library` });
  await until(
    "!!document.querySelector('button[aria-label=\"Open Evening favorites\"]')"
  );
  await click('button[aria-label="Open Evening favorites"]');
  await until(
    "document.querySelectorAll('ol[aria-label=\"Playlist songs\"] > li').length === 3"
  );
  // The playlist editor is a modal with labeled fields and keyboard focus return.
  await evaluate(
    "document.querySelector('main header button[aria-label=\"Edit Evening favorites\"]').focus()"
  );
  await key("Enter");
  await until("!!document.querySelector('[data-slot=dialog-content]')");
  assert.equal(await evaluate("document.activeElement.name"), "name");
  assert.deepEqual(
    await evaluate(
      "Array.from(document.querySelectorAll('[data-slot=dialog-content] label')).map(el=>el.textContent.trim())"
    ),
    ["Name", "Description", "Change album image"]
  );
  assert.ok(
    await evaluate(
      "!!document.querySelector('button[aria-label=\"Edit Evening favorites\"] .lucide-pencil')"
    )
  );
  await fill('input[name="name"]', "Evening favorites updated");
  await fill('textarea[name="description"]', "A quiet evening");
  await selectImage("invalid.txt", "text/plain");
  await until(
    "document.querySelector('[role=alert]')?.textContent.includes('Choose a JPG')"
  );
  await selectImage("album.png");
  await until(
    "document.querySelector('img[alt=\"Selected album image preview\"]')?.naturalWidth === 1"
  );
  await evaluate(
    "document.querySelector('[data-slot=dialog-content] form').requestSubmit()"
  );
  await until("!document.querySelector('[data-slot=dialog-content]')");
  await until(
    "document.activeElement.getAttribute('aria-label') === 'Edit Evening favorites updated'"
  );
  await key("Enter");
  await until("!!document.querySelector('[data-slot=dialog-content]')");
  assert.equal(
    await evaluate("document.querySelector('textarea').value"),
    "A quiet evening"
  );
  assert.equal(
    await evaluate("document.querySelector('input[name=name]').value"),
    "Evening favorites updated"
  );
  await until(
    "document.querySelector('[data-slot=dialog-content] img')?.naturalWidth === 1"
  );
  await fill('textarea[name="description"]', "Discard this draft");
  await selectImage("discard.png");
  await key("Escape");
  await until("!document.querySelector('[data-slot=dialog-content]')");
  await key("Enter");
  await until("!!document.querySelector('[data-slot=dialog-content]')");
  assert.equal(
    await evaluate("document.querySelector('textarea').value"),
    "A quiet evening"
  );
  assert.ok(
    await evaluate(
      "document.querySelector('[data-slot=dialog-content] img')?.src.startsWith('data:image/png')"
    )
  );
  await fill('input[name="name"]', "Evening favorites");
  await evaluate(
    "document.querySelector('[data-slot=dialog-content] form').requestSubmit()"
  );
  await until("!document.querySelector('[data-slot=dialog-content]')");
  // Activate the row dropdown with the keyboard and verify focus restoration.
  await evaluate(
    "document.querySelector('button[aria-label=\"Actions for GET IT, entry 1\"]').focus()"
  );
  await key("Enter");
  await until("!!document.querySelector('[data-slot=dropdown-menu-content]')");
  assert.ok(
    await evaluate(
      "document.body.textContent.includes('Add to queue') && document.body.textContent.includes('Remove from playlist')"
    )
  );
  assert.deepEqual(
    await evaluate(
      "Array.from(document.querySelectorAll('[role=menuitem]')).map(el => el.textContent.trim())"
    ),
    [
      "Play",
      "Add to queue",
      "Like",
      "Add to playlist",
      "Move up",
      "Move down",
      "Remove from playlist",
    ]
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[role=menuitem]')[4].getAttribute('aria-disabled')"
    ),
    "true"
  );
  await key("Escape");
  await until("!document.querySelector('[data-slot=dropdown-menu-content]')");
  assert.equal(
    await evaluate("document.activeElement.getAttribute('aria-label')"),
    "Actions for GET IT, entry 1"
  );
  await click("main header button");
  await until(
    "document.body.innerText.includes('Playlist selected for playback.')"
  );
  assert.deepEqual(
    resolutions,
    [1, 2],
    "Repeated entries reuse one source lookup"
  );
  assert.ok(
    await evaluate(
      "document.querySelector('footer').innerText.includes('GET IT')"
    )
  );
  // Existing player queue count confirms both repeated occurrences remain queued.
  assert.ok(
    await evaluate(
      "!!document.querySelector('button[aria-label=\"Open queue (2 upcoming)\"]')"
    )
  );
  await evaluate(
    "Array.from(document.querySelectorAll('main header button')).find(b=>b.textContent.trim()==='Shuffle').click()"
  );
  await until(
    "document.body.innerText.includes('Playlist shuffled and selected for playback.')"
  );
  failResolve = true;
  await click('button[aria-label="Play GET IT, entry 1"]');
  await until(
    "document.body.innerText.includes('Fixture track unavailable. Please retry.')"
  );
  assert.equal(
    await evaluate("document.querySelector('main header button').disabled"),
    false
  );
  failResolve = false;
  await click('button[aria-label="Actions for GET IT, entry 1"]');
  await until("!!document.querySelector('[data-slot=dropdown-menu-content]')");
  await click('[role=menuitem][aria-label="Move GET IT, entry 1, down"]');
  await until(
    "document.querySelector('ol li button').getAttribute('aria-label') === 'Play SOMEBODY, entry 1'"
  );
  await key("Escape");
  await click('button[aria-label="Actions for SOMEBODY, entry 1"]');
  await until("!!document.querySelector('[data-slot=dropdown-menu-content]')");
  await click(
    '[role=menuitem][aria-label="Remove SOMEBODY, entry 1, from playlist"]'
  );
  await until(
    "document.querySelectorAll('ol[aria-label=\"Playlist songs\"] > li').length === 2"
  );
  await key("Escape");
  for (const width of [320, 375, 768, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    assert.ok(
      await evaluate("document.documentElement.scrollWidth <= innerWidth"),
      `No horizontal overflow at ${width}px`
    );
    await click('main header button[aria-label="Edit Evening favorites"]');
    await until("!!document.querySelector('[data-slot=dialog-content]')");
    assert.ok(
      await evaluate(
        "(() => { const r = document.querySelector('[data-slot=dialog-content]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()"
      ),
      `Dialog fits at ${width}px`
    );
    await key("Escape");
    await until("!document.querySelector('[data-slot=dialog-content]')");
    if (width === 375 || width === 1440) {
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(
        `.next/playlist-ui-${width}.png`,
        Buffer.from(shot.data, "base64")
      );
    }
  }
  // Empty playlists keep their header and disable playback actions.
  playlist.items = [];
  await send("Page.reload");
  await until(
    "!!document.querySelector('button[aria-label=\"Open Evening favorites\"]')"
  );
  await click('button[aria-label="Open Evening favorites"]');
  await until("document.body.innerText.includes('waiting for its first song')");
  assert.ok(
    await evaluate(
      "Array.from(document.querySelectorAll('main header button')).every(b=>b.textContent.trim()==='Play'||b.textContent.trim()==='Shuffle'?b.disabled:true)"
    )
  );
  assert.deepEqual(
    fieldWarnings,
    [],
    "No uncontrolled field warnings after renaming"
  );
  console.log(
    "PASS: Edge fixture playlist UI; Play/Shuffle, duplicate queue entries, recoverable failure, keyboard dropdown/focus, reorder/remove, empty state, and 320/375/768/1440px layouts."
  );
} finally {
  socket.close();
  for (const job of pending.values()) clearTimeout(job.timer);
}
