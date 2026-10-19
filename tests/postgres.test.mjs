import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomInt, randomBytes } from "node:crypto";
import { normalizeCatalog } from "../lib/music/catalog.ts";
import { normalizeTrack } from "../lib/music/track.ts";
import { createMusicRepository, AUDIO_PROFILE } from "../lib/server/music-repository.ts";

// Use only an isolated database with migration 0001 applied. Default tests skip
// this suite rather than reading or modifying the application's DATABASE_URL.
test("Postgres repositories persist metadata, serialize selections, and isolate asset versions", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const database = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  const repository = createMusicRepository(database);
  const trackId = randomInt(1_000_000_000, 2_000_000_000);
  const track = normalizeCatalog({ kind: "song", trackId, trackName: "Repository test", artistName: "Test artist", trackTimeMillis: 120000 }, "SG");
  const source = normalizeTrack({ id: randomBytes(8).toString("base64url"), title: "Repository test source", uploader: "Test artist", duration: 120 });
  const other = { ...source, id: randomBytes(8).toString("base64url"), title: "Other source" };
  let catalogIds = [];
  try {
    await Promise.all([repository.saveCatalog(track), repository.saveCatalog({ ...track, country: "US" })]);
    await repository.saveCatalog({ ...track, title: "Updated" });
    assert.equal((await repository.getCatalog(trackId, "SG")).title, "Updated");
    assert.equal((await repository.getCatalog(trackId, "US")).title, track.title);
    const catalogRows = await database.query("SELECT id FROM public.catalog_tracks WHERE provider_track_id=$1", [String(trackId)]);
    catalogIds = catalogRows.rows.map(row => row.id);
    assert.equal(catalogIds.length, 2);

    const selections = await Promise.all([repository.selectSource(track, source), repository.selectSource(track, other)]);
    assert.equal(selections[0].id, selections[1].id);
    const selected = await repository.getMapping(trackId, "SG");
    assert.equal(selected.id, selections[0].id);
    assert.equal(await repository.getMapping(trackId, "US"), null);
    await repository.selectSource(track, selected.id === source.id ? other : source);
    assert.equal((await repository.getMapping(trackId, "SG")).id, selected.id);

    await repository.saveSource({ ...selected, title: "Refreshed upload title" });
    assert.equal((await repository.getSource(selected.id)).title, "Refreshed upload title");
    await database.query("UPDATE public.catalog_tracks SET refresh_after=now()-interval '1 day' WHERE id=ANY($1::uuid[])", [catalogIds]);
    assert.equal(await repository.getCatalog(trackId, "SG"), null);
    assert.equal((await repository.getCatalog(trackId, "SG", false)).title, "Updated");

    const ready = await database.query(`INSERT INTO public.audio_assets
      (video_id,profile_key,object_key,state,mime_type,codec,container,byte_size,duration_seconds,checksum)
      VALUES ($1,$2,'verification/repository/1.webm','ready','audio/webm','opus','webm',100,120,'test') RETURNING id`, [selected.id, AUDIO_PROFILE]);
    const asset = await repository.getReadyAsset(selected.id);
    assert.equal(asset.id, ready.rows[0].id);
    await repository.touchAsset(asset);
    const firstTouch = await database.query("SELECT last_accessed_at FROM public.audio_assets WHERE id=$1", [asset.id]);
    await repository.touchAsset(asset);
    const nextTouch = await database.query("SELECT last_accessed_at FROM public.audio_assets WHERE id=$1", [asset.id]);
    assert.deepEqual(nextTouch.rows, firstTouch.rows);
    await database.query("UPDATE public.audio_assets SET object_key='verification/repository/2.webm' WHERE id=$1", [asset.id]);
    await repository.invalidateAsset(asset);
    assert.equal((await repository.getReadyAsset(selected.id)).object_key, "verification/repository/2.webm");
    const replacement = await repository.getReadyAsset(selected.id);
    await repository.invalidateAsset(replacement);
    assert.equal(await repository.getReadyAsset(selected.id), null);
    await database.query("UPDATE public.audio_assets SET state='ready',expires_at=now()-interval '1 day' WHERE id=$1", [asset.id]);
    assert.equal(await repository.getReadyAsset(selected.id), null);
  } finally {
    // Delete only this run's fixtures, including partial failures.
    await database.query("DELETE FROM public.audio_assets WHERE video_id=ANY($1::text[])", [[source.id, other.id]]);
    await database.query("DELETE FROM public.track_sources WHERE catalog_track_id IN (SELECT id FROM public.catalog_tracks WHERE provider_track_id=$1)", [String(trackId)]);
    await database.query("DELETE FROM public.catalog_tracks WHERE provider_track_id=$1", [String(trackId)]);
    await database.query("DELETE FROM public.youtube_sources WHERE video_id=ANY($1::text[])", [[source.id, other.id]]);
    await database.end();
  }
});
