# PostgreSQL setup

These scripts implement the nine tables in `PLAN.md`, in dependency order.
Use PostgreSQL 14 or later; UUID generation uses built-in `gen_random_uuid()`
and needs no extension. The server uses the `pg` driver to connect these tables
to catalog search, source resolution, metadata inspection, and ready R2 playback.
Set server-only `DATABASE_URL` after applying the migration. The pool is created
on first use and no migrations run automatically. See the root README for
timeouts, connection budgets, fallback behavior, and the R2 read switch.

## Create a local database and its tables

From the repository root, run this once with an account that has `CREATEDB`:

```powershell
psql -X -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -f database/create-database.sql
```

`psql` prompts for a password if required. The bootstrap creates `music_stream`,
connects to it, and applies migrations 0001, 0002, and 0003. The `\connect`
and `\ir` commands require psql. Database creation cannot be part of the schema
transaction; if the migration fails, the empty database remains for a retry.

## Use an existing or hosted database

Connect to an empty development database and apply just the migration:

```powershell
psql -X -h YOUR_HOST -U YOUR_USER -d YOUR_DATABASE -v ON_ERROR_STOP=1 -f database/migrations/0001_initial_schema.sql
```

Alternatively, run the migration's SQL in the provider's SQL editor. The
migration uses the `public` schema and runs in one transaction. Apply it once;
it deliberately fails on existing tables instead of hiding schema differences.
Record applied migration versions in your deployment process and add subsequent
numbered migrations for future changes. No existing database is dropped or reset.

Apply `migrations/0002_cache_objects.sql` next, including on existing installations:

```powershell
psql -X -h YOUR_HOST -U YOUR_USER -d YOUR_DATABASE -v ON_ERROR_STOP=1 -f database/migrations/0002_cache_objects.sql
```

This adds `cache_objects` for shared capacity reservations and cleanup of uploaded
objects after crashes or failed database commits. Existing asset objects are
included in its initial accounting. Run `pnpm cache:worker` alongside the app to
process jobs when `AUDIO_CACHE_ENABLED=true`; see the root README for configuration.

## Schema behavior

Apply `migrations/0003_library_accounts.sql` next for Library username/password
accounts, hashed opaque sessions, and shared sign-in throttling. It adds three
tables and leaves existing users, likes, playlists, and catalog/source data
intact. The application does not automatically migrate an existing database.
See the root README for sign-in behavior and the isolated library browser check.

```powershell
psql -X -h YOUR_HOST -U YOUR_USER -d YOUR_DATABASE -v ON_ERROR_STOP=1 -f database/migrations/0003_library_accounts.sql
```

- Catalog identity is `(provider, provider_track_id, storefront)`. Normalize
  storefronts to uppercase two-letter country codes and validate them against
  supported countries in server code. External IDs stay text.
- Sources enforce 11-character video IDs, canonical URLs, and at most one
  selected source per catalog track. Explicit rematching must deselect then
  select in the same transaction.
- Ready assets require complete descriptors; the worker must additionally
  verify that the private storage object is complete and readable. Sizes and
  durations cannot be negative; floating durations also reject infinity/NaN.
- Only one queued/running cache job is allowed per asset. Running jobs require
  a complete lease; other states require cleared lease fields. The cache worker
  implements claims, renewable leases, bounded retries, and stale-token protection.
- Playlist entries permit repeated songs. To reorder, use a transaction with
  `SET CONSTRAINTS playlist_items_order DEFERRED`, then assign distinct final
  positions before commit. Server operations must check and increment the
  playlist revision within the same transaction as each name/item edit.
- Deleting users cascades to their likes/playlists/items. Referenced catalog,
  source, and asset records cannot be deleted. Eviction changes asset state
  and removes storage objects without removing saved music.
- Applications must maintain `updated_at`; no automatic timestamp triggers
  are installed, matching the plan. Resolve ownership from authenticated
  server sessions for every library read/write. These tables are not a public
  authorization API and do not install provider-specific roles or RLS policies.

## Validate constraints

After applying the migration to an isolated test database:

```powershell
psql -X -h 127.0.0.1 -U postgres -d music_stream -v ON_ERROR_STOP=1 -f database/tests/schema.sql
```

The test runs inside a transaction and rolls back all fixtures. It checks
identity/selection uniqueness, finite durations, ready assets, active jobs and
leases, duplicate playlist songs, deferred reordering, revision checks,
restricted deletion, cascading ownership deletion, and saved-track preservation.
