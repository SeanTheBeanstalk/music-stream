-- Run with psql while connected to the postgres maintenance database.
-- Requires CREATEDB permission. For a provider-created database, apply the
-- migration directly instead. This bootstrap is intentionally run only once.
\set ON_ERROR_STOP on

-- CREATE DATABASE must run outside a transaction.
CREATE DATABASE music_stream;
\connect music_stream
\ir migrations/0001_initial_schema.sql
\ir migrations/0002_cache_objects.sql
\ir migrations/0003_library_accounts.sql
\ir migrations/0004_playlist_metadata.sql
