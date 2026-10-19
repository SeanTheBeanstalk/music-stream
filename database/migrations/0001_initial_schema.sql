-- Initial PostgreSQL schema from PLAN.md. Requires PostgreSQL 14+.
-- Apply once to an empty database. All schema changes succeed or roll back.
BEGIN;

CREATE TABLE public.catalog_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'itunes',
    provider_track_id TEXT NOT NULL,
    storefront TEXT NOT NULL,
    title TEXT NOT NULL,
    artist_id TEXT,
    artist_name TEXT,
    album_id TEXT,
    album_name TEXT,
    duration_ms INTEGER,
    artwork_url TEXT,
    store_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    fetched_at TIMESTAMPTZ NOT NULL,
    refresh_after TIMESTAMPTZ NOT NULL,
    CONSTRAINT catalog_tracks_identity UNIQUE (provider, provider_track_id, storefront),
    CONSTRAINT catalog_tracks_storefront CHECK (storefront ~ '^[A-Z]{2}$'),
    CONSTRAINT catalog_tracks_duration CHECK (duration_ms >= 0)
);

CREATE TABLE public.youtube_sources (
    video_id TEXT PRIMARY KEY,
    canonical_url TEXT NOT NULL UNIQUE,
    upload_title TEXT,
    uploader TEXT,
    duration_seconds DOUBLE PRECISION,
    availability TEXT NOT NULL DEFAULT 'unknown',
    metadata_fetched_at TIMESTAMPTZ,
    availability_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT youtube_sources_video_id CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
    CONSTRAINT youtube_sources_canonical_url CHECK (
        canonical_url = 'https://www.youtube.com/watch?v=' || video_id
    ),
    -- PostgreSQL orders NaN above Infinity; this also rejects NaN.
    CONSTRAINT youtube_sources_duration CHECK (
        duration_seconds >= 0 AND duration_seconds < 'Infinity'::double precision
    ),
    CONSTRAINT youtube_sources_availability CHECK (
        availability IN ('unknown', 'available', 'unavailable')
    )
);

CREATE TABLE public.track_sources (
    catalog_track_id UUID NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE RESTRICT,
    video_id TEXT NOT NULL REFERENCES public.youtube_sources(video_id) ON DELETE RESTRICT,
    is_selected BOOLEAN NOT NULL DEFAULT FALSE,
    match_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    selected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (catalog_track_id, video_id),
    CONSTRAINT track_sources_selection_timestamp CHECK (NOT is_selected OR selected_at IS NOT NULL)
);

CREATE UNIQUE INDEX track_sources_one_selected
    ON public.track_sources (catalog_track_id) WHERE is_selected;
CREATE INDEX track_sources_video_id ON public.track_sources (video_id);

CREATE TABLE public.audio_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id TEXT NOT NULL REFERENCES public.youtube_sources(video_id) ON DELETE RESTRICT,
    profile_key TEXT NOT NULL,
    object_key TEXT,
    state TEXT NOT NULL DEFAULT 'pending',
    mime_type TEXT,
    codec TEXT,
    container TEXT,
    byte_size BIGINT,
    duration_seconds DOUBLE PRECISION,
    checksum TEXT,
    last_accessed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT audio_assets_source_profile UNIQUE (video_id, profile_key),
    CONSTRAINT audio_assets_state CHECK (
        state IN ('pending', 'downloading', 'ready', 'failed', 'deleting', 'evicted')
    ),
    CONSTRAINT audio_assets_size CHECK (byte_size >= 0),
    CONSTRAINT audio_assets_duration CHECK (
        duration_seconds >= 0 AND duration_seconds < 'Infinity'::double precision
    ),
    CONSTRAINT audio_assets_ready_metadata CHECK (
        state <> 'ready' OR (
            object_key IS NOT NULL AND mime_type IS NOT NULL
            AND codec IS NOT NULL AND container IS NOT NULL
            AND byte_size IS NOT NULL AND byte_size > 0
            AND duration_seconds IS NOT NULL AND checksum IS NOT NULL
        )
    )
);

CREATE INDEX audio_assets_eviction ON public.audio_assets (last_accessed_at, created_at)
    WHERE state = 'ready';
CREATE INDEX audio_assets_expiry ON public.audio_assets (expires_at)
    WHERE state = 'ready' AND expires_at IS NOT NULL;

CREATE TABLE public.cache_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audio_asset_id UUID NOT NULL REFERENCES public.audio_assets(id) ON DELETE RESTRICT,
    state TEXT NOT NULL DEFAULT 'queued',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_owner TEXT,
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT cache_jobs_state CHECK (
        state IN ('queued', 'running', 'completed', 'failed', 'cancelled')
    ),
    CONSTRAINT cache_jobs_attempt_count CHECK (attempt_count >= 0),
    CONSTRAINT cache_jobs_lease CHECK (
        (state = 'running' AND lease_owner IS NOT NULL
            AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state <> 'running' AND lease_owner IS NULL
            AND lease_token IS NULL AND lease_expires_at IS NULL)
    )
);

CREATE UNIQUE INDEX cache_jobs_one_active ON public.cache_jobs (audio_asset_id)
    WHERE state IN ('queued', 'running');
CREATE INDEX cache_jobs_due ON public.cache_jobs (next_attempt_at)
    WHERE state = 'queued';
CREATE INDEX cache_jobs_expired_leases ON public.cache_jobs (lease_expires_at)
    WHERE state = 'running';

CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_provider TEXT NOT NULL,
    auth_subject TEXT NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_auth_identity UNIQUE (auth_provider, auth_subject)
);

CREATE TABLE public.likes (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    catalog_track_id UUID NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, catalog_track_id)
);

CREATE INDEX likes_owner_created ON public.likes (user_id, created_at);
CREATE INDEX likes_catalog_track_id ON public.likes (catalog_track_id);

CREATE TABLE public.playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT playlists_name CHECK (length(btrim(name)) > 0),
    CONSTRAINT playlists_revision CHECK (revision >= 0)
);

CREATE INDEX playlists_user_id ON public.playlists (user_id);

CREATE TABLE public.playlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    catalog_track_id UUID NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT playlist_items_position CHECK (position >= 0),
    CONSTRAINT playlist_items_order UNIQUE (playlist_id, position)
        DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX playlist_items_catalog_track_id ON public.playlist_items (catalog_track_id);

COMMIT;
