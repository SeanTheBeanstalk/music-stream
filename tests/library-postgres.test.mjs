import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import pg from "pg";
import { createLibraryRepository } from "../lib/server/library-repository.ts";
import { createLibraryAccount } from "../lib/server/library-account.ts";
import { createMusicRepository } from "../lib/server/music-repository.ts";
import { normalizeCatalog } from "../lib/music/catalog.ts";
import { normalizeTrack } from "../lib/music/track.ts";

test(
  "account libraries persist, enforce ownership and revision conflicts, and keep duplicate playlist entries ordered",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const database = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
    });
    const accounts = createLibraryAccount(database),
      library = createLibraryRepository(database),
      music = createMusicRepository(database);
    const username = `library_${randomBytes(6).toString("hex")}`;
    const otherName = `${username}_2`;
    const password = "library integration password";
    const id = randomInt(1_000_000_000, 2_000_000_000);
    const track = normalizeCatalog(
      {
        kind: "song",
        trackId: id,
        trackName: "Trusted title",
        artistName: "Test artist",
      },
      "SG"
    );
    const us = {
      ...track,
      country: "US",
      artist: { ...track.artist, country: "US" },
      album: { ...track.album, country: "US" },
    };
    const source = normalizeTrack({
      id: randomBytes(8).toString("base64url"),
      title: "Existing source",
    });
    const request = (token) =>
      new Request("https://music.example/api/library", {
        headers: { cookie: `music_session=${token}` },
      });
    try {
      const token = await accounts.signIn({ username, password }, true);
      const user = await accounts.current(request(token));
      const otherToken = await accounts.signIn(
        { username: otherName, password },
        true
      );
      const other = await accounts.current(request(otherToken));
      await assert.rejects(
        accounts.signIn({ username, password: "incorrect password" }, false),
        (error) => error.status === 401
      );
      await assert.rejects(
        accounts.signIn({ username, password }, true),
        (error) => error.status === 409
      );
      const secondDevice = await accounts.signIn({ username, password }, false);
      assert.equal((await accounts.current(request(secondDevice))).id, user.id);
      await music.saveCatalog(track);
      await music.saveCatalog(us);
      await music.selectSource(track, source);
      const like = { action: "like", trackId: id, country: "SG", liked: true };
      await Promise.all([
        library.mutate(user.id, like, { ...track, title: "Forged overwrite" }),
        library.mutate(user.id, like, track),
      ]);
      let saved = await library.read(user.id, username);
      assert.equal(saved.likes.length, 1);
      assert.equal(saved.likes[0].track.title, "Trusted title");
      assert.equal((await library.read(other.id, otherName)).likes.length, 0);
      assert.equal((await music.getMapping(id, "SG")).id, source.id);
      await library.mutate(user.id, { ...like, country: "US" }, us);
      assert.equal((await library.read(user.id, username)).likes.length, 2);
      await library.mutate(user.id, {
        action: "create",
        name: "First playlist",
      });
      let playlist = (await library.read(user.id, username)).playlists[0];
      const edit = (action, extra = {}) => ({
        action,
        playlistId: playlist.id,
        revision: playlist.revision,
        ...extra,
      });
      await assert.rejects(
        library.mutate(other.id, edit("rename", { name: "Stolen" })),
        (error) => error.status === 404
      );
      await assert.rejects(
        library.mutate(
          other.id,
          edit("add", { trackId: id, country: "SG" }),
          track
        ),
        (error) => error.status === 404
      );
      await library.mutate(
        user.id,
        edit("add", { trackId: id, country: "SG" }),
        track
      );
      await assert.rejects(
        library.mutate(
          user.id,
          edit("add", { trackId: id, country: "SG" }),
          track
        ),
        (error) => error.status === 409
      );
      playlist = (await library.read(user.id, username)).playlists[0];
      await library.mutate(
        user.id,
        edit("add", { trackId: id, country: "SG" }),
        track
      );
      playlist = (await library.read(user.id, username)).playlists[0];
      assert.equal(playlist.items.length, 2);
      assert.notEqual(playlist.items[0].id, playlist.items[1].id);
      const reversed = playlist.items.map((i) => i.id).reverse();
      await library.mutate(user.id, edit("reorder", { itemIds: reversed }));
      playlist = (await library.read(user.id, username)).playlists[0];
      assert.deepEqual(
        playlist.items.map((i) => i.id),
        reversed
      );
      await assert.rejects(
        library.mutate(user.id, edit("reorder", { itemIds: [reversed[0]] })),
        /every playlist entry/
      );
      assert.equal(
        (await library.read(user.id, username)).playlists[0].revision,
        playlist.revision
      );
      const race = await Promise.allSettled([
        library.mutate(user.id, edit("rename", { name: "Race one" })),
        library.mutate(user.id, edit("rename", { name: "Race two" })),
      ]);
      assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        race.find((r) => r.status === "rejected").reason.status,
        409
      );
      playlist = (await library.read(user.id, username)).playlists[0];
      await library.mutate(user.id, edit("remove", { itemId: reversed[0] }));
      playlist = (await library.read(user.id, username)).playlists[0];
      assert.deepEqual(
        playlist.items.map((i) => i.id),
        [reversed[1]]
      );
      const positions = await database.query(
        "SELECT position FROM public.playlist_items WHERE playlist_id=$1",
        [playlist.id]
      );
      assert.deepEqual(positions.rows, [{ position: 0 }]);
      const firstCover = `playlist-covers/${user.id}/00000000-0000-4000-8000-000000000001.webp`;
      const secondCover = `playlist-covers/${user.id}/00000000-0000-4000-8000-000000000002.webp`;
      await database.query(
        "INSERT INTO public.playlist_cover_cleanup (object_key) VALUES ($1)",
        [firstCover]
      );
      await library.mutate(
        user.id,
        edit("update", {
          name: "With cover",
          description: "Saved description",
        }),
        null,
        firstCover
      );
      let metadata = (await library.read(user.id, username)).playlists[0];
      assert.equal(metadata.description, "Saved description");
      assert.ok(
        metadata.coverUrl.startsWith(`/api/library/covers/${playlist.id}?v=`)
      );
      assert.equal(
        (
          await database.query(
            "SELECT * FROM public.playlist_cover_cleanup WHERE object_key=$1",
            [firstCover]
          )
        ).rowCount,
        0
      );
      await assert.rejects(
        library.mutate(
          user.id,
          edit("update", { name: "Stale", description: "Lost" }),
          null,
          secondCover
        ),
        (error) => error.status === 409
      );
      await assert.rejects(
        library.mutate(other.id, {
          ...edit("update", { name: "Foreign", description: "No" }),
          revision: metadata.revision,
        }),
        (error) => error.status === 404
      );
      playlist = metadata;
      await library.mutate(
        user.id,
        edit("update", { name: "Replacement", description: "Changed" }),
        null,
        secondCover
      );
      assert.equal(
        (
          await database.query(
            "SELECT * FROM public.playlist_cover_cleanup WHERE object_key=$1",
            [firstCover]
          )
        ).rowCount,
        1
      );
      playlist = (await library.read(user.id, username)).playlists[0];
      await library.mutate(
        user.id,
        edit("update", {
          name: "Removed cover",
          description: "Still saved",
          removeCover: true,
        })
      );
      playlist = (await library.read(user.id, username)).playlists[0];
      assert.equal(playlist.coverUrl, null);
      assert.equal(playlist.description, "Still saved");
      assert.equal(
        (
          await database.query(
            "SELECT * FROM public.playlist_cover_cleanup WHERE object_key=$1",
            [secondCover]
          )
        ).rowCount,
        1
      );
      await database.query(
        "DELETE FROM public.playlist_cover_cleanup WHERE object_key=ANY($1::text[])",
        [[firstCover, secondCover]]
      );
      const reloaded = createLibraryRepository(database);
      assert.equal((await reloaded.read(user.id, username)).likes.length, 2);
      await library.mutate(user.id, edit("delete"));
      assert.equal((await library.read(user.id, username)).playlists.length, 0);
      assert.equal(
        (
          await database.query(
            "SELECT id FROM public.playlist_items WHERE playlist_id=$1",
            [playlist.id]
          )
        ).rowCount,
        0
      );
      await library.mutate(user.id, { ...like, liked: false });
      saved = await library.read(user.id, username);
      assert.equal(saved.likes.length, 1);
      assert.equal(saved.likes[0].track.country, "US");
      await accounts.signOut(request(token));
      assert.equal(await accounts.current(request(token)), null);
      assert.ok(await accounts.current(request(secondDevice)));
      await database.query(
        "UPDATE public.account_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [user.id]
      );
      assert.equal(await accounts.current(request(secondDevice)), null);
    } finally {
      await database.query(
        "DELETE FROM public.users WHERE auth_provider='password' AND auth_subject=ANY($1::text[])",
        [[username, otherName]]
      );
      await database.query(
        "DELETE FROM public.account_attempts WHERE username=ANY($1::text[])",
        [[username, otherName]]
      );
      await database.query(
        "DELETE FROM public.track_sources WHERE video_id=$1",
        [source.id]
      );
      await database.query(
        "DELETE FROM public.catalog_tracks WHERE provider_track_id=$1",
        [String(id)]
      );
      await database.query(
        "DELETE FROM public.youtube_sources WHERE video_id=$1",
        [source.id]
      );
      await database.end();
    }
  }
);
