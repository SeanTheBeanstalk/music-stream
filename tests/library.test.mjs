import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCommand,
  playlistName,
  sameOrigin,
  readJson,
} from "../lib/server/library-validation.ts";
import {
  credentials,
  hashPassword,
  verifyPassword,
  newToken,
  tokenHash,
} from "../lib/server/account-crypto.ts";
import { createLibraryRepository } from "../lib/server/library-repository.ts";
import { sessionToken, sessionCookie } from "../lib/server/library-account.ts";

const playlistId = "00000000-0000-4000-8000-000000000001";
test("library inputs preserve storefront identity and reject malformed edits", () => {
  assert.deepEqual(
    parseCommand({
      action: "like",
      trackId: 42,
      country: "sg",
      liked: true,
      userId: "attacker",
      metadata: { title: "fake" },
    }),
    { action: "like", trackId: 42, country: "SG", liked: true }
  );
  for (const value of [
    null,
    {},
    { action: "like", trackId: "42", country: "US", liked: true },
    { action: "like", trackId: 42, country: "ZZ", liked: true },
    { action: "like", trackId: 42, country: "US", liked: "yes" },
    { action: "delete", playlistId, revision: -1 },
    {
      action: "reorder",
      playlistId,
      revision: 0,
      itemIds: [playlistId, playlistId],
    },
  ])
    assert.throws(() => parseCommand(value));
  assert.equal(playlistName("  Road trip  "), "Road trip");
  for (const name of [" ", "x".repeat(101), "bad\nname"])
    assert.throws(() => playlistName(name));
});
test("library requests enforce same origin, JSON and bounded request size", async () => {
  sameOrigin(
    new Request("https://music.example/api/library", {
      headers: { origin: "https://music.example" },
    })
  );
  sameOrigin(
    new Request("http://localhost:3012/api/library", {
      headers: { host: "127.0.0.1:3012", origin: "http://127.0.0.1:3012" },
    })
  );
  for (const origin of ["https://evil.example", "null"])
    assert.throws(() =>
      sameOrigin(
        new Request("https://music.example/api/library", {
          headers: { origin },
        })
      )
    );
  assert.throws(() =>
    sameOrigin(new Request("https://music.example/api/library"))
  );
  await assert.rejects(
    readJson(
      new Request("https://music.example", { method: "POST", body: "{}" })
    ),
    /Expected JSON/
  );
  await assert.rejects(
    readJson(
      new Request("https://music.example", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(65537),
      })
    ),
    /too large/
  );
});
test("passwords use salted hashes and sessions use opaque tokens", async () => {
  const password = "a long test password";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("incorrect password", first), false);
  assert.equal(await verifyPassword(password, undefined), false);
  assert.equal(
    credentials({ username: " Listener_1 ", password }).username,
    "listener_1"
  );
  assert.throws(() => credentials({ username: "bad user", password }));
  assert.throws(() => credentials({ username: "listener", password: "short" }));
  const token = newToken();
  assert.notEqual(tokenHash(token), token);
  assert.equal(
    sessionToken(
      new Request("https://music.example", {
        headers: { cookie: `other=x; music_session=${token}` },
      })
    ),
    token
  );
  assert.equal(
    sessionToken(
      new Request("https://music.example", {
        headers: { cookie: "music_session=bad" },
      })
    ),
    null
  );
  const cookie = sessionCookie(new Request("https://music.example"), token);
  for (const flag of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/"])
    assert.ok(cookie.includes(flag));
  assert.ok(
    sessionCookie(new Request("https://music.example"), "", true).includes(
      "Max-Age=0"
    )
  );
});
test("playlist ownership failures and stale revisions roll back without writing", async () => {
  for (const [rows, status] of [
    [[], 404],
    [[{ revision: 2 }], 409],
  ]) {
    const statements = [];
    let released;
    const client = {
      query: async (sql) => {
        statements.push(sql);
        return { rows: sql.startsWith("SELECT revision") ? rows : [] };
      },
      release: (broken) => {
        released = broken;
      },
    };
    const repository = createLibraryRepository({ connect: async () => client });
    await assert.rejects(
      repository.mutate("owner", { action: "delete", playlistId, revision: 1 }),
      (error) => error.status === status
    );
    assert.equal(statements.at(-1), "ROLLBACK");
    assert.ok(!statements.some((sql) => sql.startsWith("DELETE")));
    assert.equal(released, false);
  }
});
