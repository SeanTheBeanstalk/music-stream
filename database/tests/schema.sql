-- Use only against an isolated test database after applying the migration.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.expect_failure(statement TEXT, expected_state TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    actual_state TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
        IF actual_state = ANY(string_to_array(expected_state, ',')) THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'Expected SQLSTATE %, got %: %', expected_state, actual_state, SQLERRM;
    END;
    RAISE EXCEPTION 'Expected SQLSTATE %, but statement succeeded: %', expected_state, statement;
END;
$$;

DO $$
DECLARE
    track UUID;
    asset UUID;
    job UUID;
    owner UUID;
    playlist UUID;
    first_item UUID;
    second_item UUID;
    changed INTEGER;
    invalid_duration TEXT;
BEGIN
    INSERT INTO public.catalog_tracks (provider_track_id, storefront, title, fetched_at, refresh_after)
    VALUES ('schema-test', 'US', 'Test song', now(), now() + interval '1 hour') RETURNING id INTO track;
    PERFORM pg_temp.expect_failure($sql$
        INSERT INTO public.catalog_tracks (provider_track_id, storefront, title, fetched_at, refresh_after)
        VALUES ('schema-test', 'US', 'Duplicate', now(), now())
    $sql$, '23505');
    -- Storefront is part of identity, and missing artist/album/duration is allowed.
    INSERT INTO public.catalog_tracks (provider_track_id, storefront, title, fetched_at, refresh_after)
    VALUES ('schema-test', 'SG', 'Test song', now(), now());

    INSERT INTO public.youtube_sources (video_id, canonical_url) VALUES
        ('testvideo01', 'https://www.youtube.com/watch?v=testvideo01'),
        ('testvideo02', 'https://www.youtube.com/watch?v=testvideo02');
    PERFORM pg_temp.expect_failure(
        'UPDATE public.youtube_sources SET canonical_url = ''https://example.com'' WHERE video_id = ''testvideo01''',
        '23514');
    FOREACH invalid_duration IN ARRAY ARRAY['-1', 'Infinity', '-Infinity', 'NaN'] LOOP
        PERFORM pg_temp.expect_failure(format(
            'UPDATE public.youtube_sources SET duration_seconds = %L::double precision WHERE video_id = ''testvideo01''',
            invalid_duration), '23514');
    END LOOP;

    INSERT INTO public.track_sources (catalog_track_id, video_id, is_selected, selected_at)
    VALUES (track, 'testvideo01', TRUE, now()), (track, 'testvideo02', FALSE, NULL);
    PERFORM pg_temp.expect_failure(format(
        'UPDATE public.track_sources SET is_selected = TRUE, selected_at = now() WHERE catalog_track_id = %L AND video_id = ''testvideo02''',
        track), '23505');
    PERFORM pg_temp.expect_failure(format(
        'UPDATE public.track_sources SET selected_at = NULL WHERE catalog_track_id = %L AND is_selected', track), '23514');

    INSERT INTO public.audio_assets (video_id, profile_key)
    VALUES ('testvideo01', 'original') RETURNING id INTO asset;
    PERFORM pg_temp.expect_failure(format(
        'UPDATE public.audio_assets SET state = ''ready'' WHERE id = %L', asset), '23514');
    UPDATE public.audio_assets SET state = 'ready', object_key = 'audio/test',
        mime_type = 'audio/mp4', codec = 'aac', container = 'm4a', byte_size = 100,
        duration_seconds = 10, checksum = 'test-checksum', updated_at = now()
    WHERE id = asset;
    FOREACH invalid_duration IN ARRAY ARRAY['-1', 'Infinity', '-Infinity', 'NaN'] LOOP
        PERFORM pg_temp.expect_failure(format(
            'UPDATE public.audio_assets SET duration_seconds = %L::double precision WHERE id = %L',
            invalid_duration, asset), '23514');
    END LOOP;
    PERFORM pg_temp.expect_failure(format(
        'UPDATE public.audio_assets SET byte_size = 0 WHERE id = %L', asset), '23514');

    INSERT INTO public.cache_jobs (audio_asset_id) VALUES (asset) RETURNING id INTO job;
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO public.cache_jobs (audio_asset_id) VALUES (%L)', asset), '23505');
    PERFORM pg_temp.expect_failure(format(
        'UPDATE public.cache_jobs SET state = ''running'' WHERE id = %L', job), '23514');
    UPDATE public.cache_jobs SET state = 'running', lease_owner = 'test-worker',
        lease_token = gen_random_uuid(), lease_expires_at = now() - interval '1 minute' WHERE id = job;
    PERFORM pg_temp.expect_failure(format(
        'UPDATE public.cache_jobs SET state = ''completed'' WHERE id = %L', job), '23514');
    -- An expired lease can be requeued after clearing all lease fields.
    UPDATE public.cache_jobs SET state = 'queued', lease_owner = NULL,
        lease_token = NULL, lease_expires_at = NULL, attempt_count = attempt_count + 1 WHERE id = job;
    UPDATE public.cache_jobs SET state = 'completed' WHERE id = job;
    INSERT INTO public.cache_jobs (audio_asset_id) VALUES (asset);
    -- Accept both foreign_key_violation and restrict_violation diagnostics.
    PERFORM pg_temp.expect_failure(format('DELETE FROM public.audio_assets WHERE id = %L', asset), '23503,23001');

    INSERT INTO public.users (auth_provider, auth_subject)
    VALUES ('schema-test', 'owner') RETURNING id INTO owner;
    INSERT INTO public.likes (user_id, catalog_track_id) VALUES (owner, track);
    INSERT INTO public.playlists (user_id, name) VALUES (owner, 'Test playlist') RETURNING id INTO playlist;
    PERFORM pg_temp.expect_failure(format(
        'UPDATE public.playlists SET name = ''   '' WHERE id = %L', playlist), '23514');
    INSERT INTO public.playlist_items (playlist_id, catalog_track_id, position)
    VALUES (playlist, track, 0) RETURNING id INTO first_item;
    INSERT INTO public.playlist_items (playlist_id, catalog_track_id, position)
    VALUES (playlist, track, 1) RETURNING id INTO second_item;
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO public.playlist_items (playlist_id, catalog_track_id, position) VALUES (%L, %L, 1)',
        playlist, track), '23505');

    SET CONSTRAINTS playlist_items_order DEFERRED;
    UPDATE public.playlist_items SET position = 1 WHERE id = first_item;
    UPDATE public.playlist_items SET position = 0 WHERE id = second_item;
    SET CONSTRAINTS playlist_items_order IMMEDIATE;
    IF NOT EXISTS (SELECT 1 FROM public.playlist_items WHERE id = first_item AND position = 1)
        OR NOT EXISTS (SELECT 1 FROM public.playlist_items WHERE id = second_item AND position = 0) THEN
        RAISE EXCEPTION 'Playlist reorder failed';
    END IF;
    UPDATE public.playlists SET revision = revision + 1, updated_at = now()
    WHERE id = playlist AND revision = 0;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN RAISE EXCEPTION 'Expected revision update'; END IF;
    UPDATE public.playlists SET name = 'Stale edit' WHERE id = playlist AND revision = 0;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 0 THEN RAISE EXCEPTION 'Stale revision was accepted'; END IF;

    PERFORM pg_temp.expect_failure(format('DELETE FROM public.catalog_tracks WHERE id = %L', track), '23503,23001');
    PERFORM pg_temp.expect_failure('DELETE FROM public.youtube_sources WHERE video_id = ''testvideo01''', '23503,23001');
    UPDATE public.audio_assets SET state = 'evicted', object_key = NULL WHERE id = asset;
    IF NOT EXISTS (SELECT 1 FROM public.likes WHERE user_id = owner AND catalog_track_id = track)
        OR (SELECT count(*) FROM public.playlist_items WHERE playlist_id = playlist) <> 2 THEN
        RAISE EXCEPTION 'Audio eviction affected saved music';
    END IF;
    DELETE FROM public.users WHERE id = owner;
    IF EXISTS (SELECT 1 FROM public.likes WHERE user_id = owner)
        OR EXISTS (SELECT 1 FROM public.playlists WHERE id = playlist)
        OR EXISTS (SELECT 1 FROM public.playlist_items WHERE playlist_id = playlist) THEN
        RAISE EXCEPTION 'User deletion did not cascade';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.catalog_tracks WHERE id = track) THEN
        RAISE EXCEPTION 'User deletion removed shared catalog metadata';
    END IF;
END;
$$;

ROLLBACK;
\echo Schema constraint checks passed; fixtures rolled back.
