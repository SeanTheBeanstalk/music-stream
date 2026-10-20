import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  normalizePlaylistCover,
  readPlaylistRequest,
  cleanupPlaylistCovers,
} from "../lib/server/playlist-covers.ts";
import { parseCommand } from "../lib/server/library-validation.ts";

test("playlist descriptions are bounded and cover keys cannot be supplied by clients", () => {
  const command = parseCommand({
    action: "update",
    playlistId: "00000000-0000-4000-8000-000000000001",
    revision: 0,
    name: " Mix ",
    description: " Notes\nMore ",
    coverKey: "someone-elses-cover",
  });
  assert.equal(command.description, "Notes\nMore");
  assert.equal(command.name, "Mix");
  assert.ok(!("coverKey" in command));
  for (const description of [null, 42, "a".repeat(2001), "bad\u0000text"])
    assert.throws(() => parseCommand({ ...command, description }));
  assert.throws(() => parseCommand({ ...command, removeCover: "yes" }));
});

test("cover decoder rejects forged images and oversized uploads, normalizes real images", async () => {
  for (const bytes of [
    Buffer.from("<svg></svg>"),
    Buffer.from("not an image"),
    Buffer.alloc(5 * 1024 * 1024 + 1),
  ])
    await assert.rejects(normalizePlaylistCover(bytes));
  const original = await sharp({
    create: { width: 1400, height: 700, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const output = await normalizePlaylistCover(original);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.exif, undefined);
  const huge = await sharp({
    create: { width: 4100, height: 4100, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await assert.rejects(normalizePlaylistCover(huge));
});

test("multipart parsing bounds chunked bodies and validates actual file content", async () => {
  const image = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "blue" },
  })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.set(
    "command",
    JSON.stringify({ action: "create", name: "New", description: "Persistent" })
  );
  form.set("image", new File([image], "misleading.png", { type: "image/png" }));
  const parsed = await readPlaylistRequest(
    new Request("https://music.example/api/library", {
      method: "POST",
      body: form,
    })
  );
  assert.equal(parsed.command.description, "Persistent");
  assert.equal((await sharp(parsed.image).metadata()).format, "webp");
  const forged = new FormData();
  forged.set("command", String(form.get("command")));
  forged.set(
    "image",
    new File(["<script>bad</script>"], "fake.png", { type: "image/png" })
  );
  await assert.rejects(
    readPlaylistRequest(
      new Request("https://music.example", { method: "POST", body: forged })
    ),
    /valid JPG/
  );
  await assert.rejects(
    readPlaylistRequest(
      new Request("https://music.example", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 65537));
            controller.close();
          },
        }),
        duplex: "half",
      })
    ),
    (error) => error.status === 413
  );
});

test("failed cover deletion retains the durable cleanup record", async () => {
  const queries = [];
  await cleanupPlaylistCovers({
    query: async (sql) => {
      queries.push(sql);
      return { rows: [{ object_key: "invalid\\key" }] };
    },
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /available_at<=now\(\)/);
});
