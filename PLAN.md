# Music Streaming Web App Plan

## Current Foundation

The repository has a Next.js/TypeScript foundation, Tailwind styling, responsive Home and Search screens, a shared audio player with an interactive queue panel, and YouTube search, metadata, and audio streaming routes backed by `yt-dlp`. Search now uses the iTunes Search API for structured catalog metadata and resolves selected tracks to title-and-artist YouTube matches on demand, retaining YouTube for playback. Planned work also includes library features and persistent storage.

Last reviewed: **2026-10-19**, against the current working tree (package version **0.0.1**). The app currently delivers search, play, and queue; the first search → play → save milestone remains incomplete because saving is not implemented. Home is a landing page, and navigation currently includes Home and Search only.

## Feature Checklist

### PostgreSQL Schema Foundation

- [x] Database creation script and transactional, versioned migration for the
  nine catalog, source, asset/job, account, and library tables.
- [x] Schema constraints for catalog/video identity, selected mappings, ready
  assets, active jobs and leases, and ordered playlists with repeated songs.
- [x] Document setup and provide rollback-only SQL constraint checks in
  `database/tests/schema.sql`.
- [x] Run the migration and SQL constraint checks against an isolated PostgreSQL
  database. On 2026-10-19, PostgreSQL **18.6** passed
  `database/create-database.sql` and `database/tests/schema.sql` on a temporary
  loopback-only cluster on port 55432. All nine tables were created and all
  nine were empty after the test transaction rolled back. The test server was
  stopped afterward; the existing local database was not modified.
- [x] Connect server-side repositories and shared metadata/mapping persistence
  to search, resolution, and source metadata inspection.
- [ ] Connect durable cache workers and authenticated library operations.

### Cloudflare R2 Storage Foundation

- [x] Implement the lean `cloudflare_r2_integration_guide.md` using a lazy,
  server-only S3 client, region `auto`, and one configured bucket.
- [x] Audio buffer uploads, private signed playback/direct-upload URLs, HEAD,
  ranged GET, and delete helpers with input validation, timeout, and cancellation.
- [x] Document server-only environment variables and provide `pnpm r2` for
  manual upload, inspection, and signed URL generation.
- [x] Offline regression tests for configuration, signatures, invalid inputs,
  byte ranges, cancellation, and storage failures.
- [x] Verify private uploads, reads, byte ranges, and signed URLs against a
  configured R2 bucket. Recorded live access verification on 2026-10-19 passed SDK upload, HEAD size/type,
  byte-identical full reads, ranged reads (206 and correct Content-Range),
  signed playback GET, and signed direct-upload PUT. Both temporary test
  objects were deleted and confirmed absent with HEAD 404.
- [x] Verify browser seeking and duration against actual R2 audio in Edge.
  On 2026-10-19, Edge **155.0.4283.62** reported the generated WAV's exact
  **12-second** duration, sought forwards/backwards, and played the full file
  through both a private signed R2 URL and an isolated adapter-backed proxy.
  `tests/browser-r2-check.mjs` also passed real R2 206/Content-Range, 416,
  missing-object 404, unsigned-read rejection, and client cancellation with
  adapter body destruction before EOF. The temporary object was deleted and
  HEAD confirmed 404. This tests the storage adapter and a test proxy, not the
  application's stream route, long tracks, other formats, or direct-fetch CORS.
  After adding the repeatable browser check, `pnpm test` passed all **52 tests**,
  and `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed. An initial build
  encountered a locked temporary Edge profile; closing the dedicated browser
  and rerunning the build resolved it.
- [x] Connect ready, unexpired audio assets to private ranged playback through
  the stream route, with missing-object invalidation and YouTube fallback.
- [ ] Connect durable jobs and worker cache fills; ready-asset reads do not
  download or publish assets automatically.

Checked items are implemented in the current working tree. They do not imply that live playback, browser compatibility, or deployment has been fully validated.

Application storage integration verified on 2026-10-19: all **68 tests** passed
with a temporary PostgreSQL **18.6** server, including concurrent mapping selection,
metadata/storefront isolation, freshness and asset-version safety. Without
`TEST_DATABASE_URL`, the isolated Postgres test skips (67 pass, one skip).
`pnpm lint`, `pnpm typecheck`, and `pnpm build` passed. The new
`tests/browser-storage-integration-check.mjs` passed against the production app
stream route and live private R2 using Edge **155.0.4283.62**: byte-identical full,
bounded/suffix/open ranges, 416 responses, 12-second browser duration, forward and
backward seeks, and advancing playback. Fixture database rows and the R2 object
were removed, with HEAD confirming 404. This check does not exercise automatic
cache fills, long tracks, or authenticated libraries.

### App Foundation and Navigation

- [x] Next.js App Router with TypeScript, Tailwind styling, theme provider, and reusable UI primitives.
- [x] Home landing page with a link to music search.
- [x] Search page built from separate input, result, and track-action components.
- [x] Responsive app shell with a desktop sidebar, mobile navigation, and active-page indicators.
- [x] Bottom player with independently scrolling page content.
- [x] Accessibility support through a skip link, labeled controls, keyboard focus styles, and live search/player status announcements.

### Existing Search Foundation

- [x] Submit a song, artist, or album query with Enter or the Search button; no search subprocess on each keystroke.
- [x] Request and display at most five iTunes song results, preserving upstream order.
- [x] Original YouTube search foundation retained in the on-demand resolver; `/api/search` now returns iTunes catalog results.
- [x] Trim and validate queries, rejecting empty, oversized, and control-character input.
- [x] Normalize tracks with a validated video ID, canonical watch URL, title, artwork, and optional uploader and duration.
- [x] Inspect the selected upload title, uploader, and YouTube link after catalog source resolution.
- [x] Search and queue cards show title, artist, and album, with catalog duration, genre, release date, explicitness, storefront, and available store/source links in keyboard-accessible details popups.
- [x] Play and Add to queue actions with queue confirmation feedback.
- [x] Initial, loading, no-result, success, and recoverable search-error states.
- [x] Cancel superseded searches and requests on unmount; prevent stale results from replacing the latest search.
- [x] Current `/api/metadata/{videoId}` retrieves normalized YouTube metadata for a validated video ID; retain it for playback-source inspection.

### Shared Playback and Queue

- [x] One audio element and playback provider mounted in the root layout to preserve playback across Home/Search navigation.
- [x] Playback and queue state separated from search UI and track normalization.
- [x] Play/pause, previous/next, volume, elapsed time, and duration controls.
- [x] Fixed-width elapsed/duration labels with tabular numerals to keep the seek bar stable as timestamps change.
- [x] Player displays the catalog song title, artist, and album separately from YouTube upload metadata; playback timing uses the browser audio resource.
- [x] Seek control enabled when the browser reports a seekable resource and finite duration.
- [x] In-memory queue retaining selected video IDs and metadata without repeating text searches.
- [x] Queue additions preserve the active track and upcoming order; the first track stays in Up next until Play makes it current.
- [x] Playing a selection inserts it after the current track and preserves upcoming tracks; replaying the same video is supported.
- [x] Advance to the next queued track when playback ends; stop at the queue boundary when repeat is Off.
- [x] Empty-player, empty-queue, end-of-queue, upcoming-track, and queued-count displays.
- [x] Buffering and playback-failure messages with automatic retries (1s exponential backoff capped at 30s, no attempt limit), pause-to-cancel and skip controls; browser autoplay restrictions require Play.
- [x] Restore the last playback position after failed-stream reloads; cancel pending retries on pause, track changes, and provider cleanup, and ignore stale play-promise failures.
- [x] Visible, interactive queue panel showing the current track and upcoming tracks in playback order.
- [x] Queue controls to play a queued track, remove tracks, reorder upcoming tracks, and clear upcoming tracks without interrupting current playback.
- [x] Responsive, keyboard-accessible queue UI with empty states, status announcements, focus handling, and meaningful tests for queue interactions.
- [x] Loop playback with Off, Repeat track, and Repeat queue modes, an accessible player control showing the active mode, and meaningful tests for track endings and empty/single-track queues.

### Streaming and Server Safeguards

- [x] `/api/stream/{videoId}` resolves and proxies the best available audio using yt-dlp's quality ranking across formats, without transcoding.
- [x] Forward valid byte-range requests and upstream range/content headers to support seeking.
- [x] Validate video IDs before subprocess calls and restrict resolved audio URLs to HTTPS Google video hosts.
- [x] Shared server-side `yt-dlp` runner using separate arguments and no shell execution.
- [x] Subprocess limits: 30-second timeout, 2 MiB combined output, and four concurrent processes per worker.
- [x] Kill subprocesses on cancellation and release timers, listeners, and concurrency slots on completion.
- [x] Upstream audio requests use cancellation signals and a 120-second timeout.
- [x] Return structured errors for invalid input, unavailable services/tracks, busy workers, and timeouts.
- [x] Optional `YT_DLP_PATH` configuration documented without secrets in `.env.example`.

### Tests and Setup Documentation

- [x] Unit tests for track normalization and canonical identity, queue order, replay, queue boundaries, queued selection, removal, reordering, clearing, and invalid edits.
- [x] Unit tests for subprocess cancellation, missing executables, concurrency, output limits, failures, and timeouts.
- [x] Unit tests for retry backoff, duplicate failure events, pause and track-change cancellation, stale play-promise failures, position restoration, and browser autoplay restrictions.
- [x] Unit tests for catalog normalization and provenance, separate catalog/video identities, title-and-artist matching, cache coalescing and cancellation, storefront isolation, request budgets, upstream errors, the five-result limit, and player metadata.
- [x] Browser smoke-test script covering live search/playback, seeking, keyboard controls, navigation persistence, mobile overflow, stale results, and empty/error states.
- [x] Browser queue regression script with stubbed search/audio covering selection, removal, reordering, clearing, navigation persistence, keyboard controls, focus handling, and layouts at 320, 375, 768, and 1280 pixels.
- [x] Browser catalog regression script with stubbed catalog/resolution/audio covering submit-only search, storefront selection, details popups, keyboard access, failed-match safety and retry, stale searches/actions, empty/throttled states, playback preservation, and responsive layouts.
- [x] Browser retry regression script (`tests/browser-retry-check.mjs`) using real Edge media playback with stubbed HTTP 502 and WAV responses to check automatic recovery, pause cancellation, and recovery after a partial response. This does not validate the live YouTube source.
- [x] README setup instructions for Node.js, pnpm, `yt-dlp`, environment configuration, checks, and manual/browser validation.

Verification during the 2026-10-19 review: `pnpm test` passed all **47 tests**; `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed. Browser scripts and live-source playback checks were not run during this review. Checked browser-script items record available coverage, not a fresh successful browser run.

Checklist refresh on 2026-10-19: `pnpm test` passed all **52 tests**, including
the R2 regressions. This refresh changes documentation only; lint, typecheck,
build, browser scripts, PostgreSQL checks, and live-provider checks were not
rerun. Live results below and in the R2 section retain their earlier recorded
verification scope.

Follow-up Edge verification on 2026-10-19 (Edge **155.0.4283.62**, production server):

- [x] Queue, catalog, and real-media/stubbed-response retry browser scripts pass. Queue keyboard/focus checks and layouts pass at 320, 375, 768, and 1280 pixels.
- [x] Live iTunes search → YouTube resolution → playback passes for Rick Astley's "Never Gonna Give You Up" (`dQw4w9WgXcQ`). The browser reports **213.061 seconds**, a seekable range, and working seeking and keyboard seek/volume controls. Queueing, navigation persistence, and the mobile viewport smoke check pass.
- [x] Live audio advances continuously past **140 seconds of wall time** without a media error or pause.
- [x] Live seeking and playback pass with **32 KiB/s bandwidth and 250 ms latency**; forcing a stream reload offline triggers retries, and restoring connectivity resumes around the previous **160-second** position.
- [x] Observe the live track's natural end after recovery, automatic advancement to the queued selection, and cancellation of a separate live stream request from the client. End/cancellation checks were also exercised separately after the sustained/offline test.
- [ ] Verify an individual upstream transfer lasting longer than 120 seconds. Sustained playback can use buffered audio and does not prove this; the proxy's absolute 120-second timeout remains unchanged.
- [ ] Instrument server-side upstream cleanup after listener disconnect; unit tests cover subprocess cancellation, but client cancellation alone cannot prove upstream cleanup.
- [ ] Repeat on physical mobile devices and other supported browser engines. Edge viewport emulation establishes layout behavior only.

The original live smoke query, "daft punk get lucky", returned a recoverable no-confident-match response for its first catalog result; it did not start audio. Matching rules were preserved. The smoke test now supports `TEST_QUERY`, defaults to the verified Rick Astley query, respects `TEST_ORIGIN` when selecting a tab, and recognizes result-card errors while waiting for playback. `tests/browser-live-playback-check.mjs` adds repeatable sustained/throttled/offline/end/cancellation checks after the smoke test.

### Remaining Roadmap and Verification

- [x] iTunes catalog search through a validated, cached server route, with storefront selection and rate-limit handling.
- [x] Structured iTunes track metadata in search results, with separate catalog and playback identities.
- [x] Resolve selected catalog tracks on Play or Add to queue using core-title/artist evidence, compatible recording descriptors, ranked candidates, and one bounded fallback query.
- [x] Display validated iTunes cover metadata in search, queue, and player with missing/broken-image fallbacks, as requested. Audio previews remain disabled.
- [x] PostgreSQL schema, versioned migration, setup documentation, and rollback-only constraint checks; isolated database verification recorded above.
- [x] Private R2 storage adapter, manual CLI, and offline regression tests; live storage and Edge seeking verification recorded above.
- [x] Connect server-side repositories and durable catalog/source mapping persistence to PostgreSQL.
- [ ] Integrate ready R2 assets into the application stream route, with durable cache-fill jobs, workers, cleanup, and eviction.
- [ ] Library screen and navigation, with empty states and liked songs.
- [ ] Personal playlists with create, rename, delete, add/remove track, and ordering operations, covered by meaningful tests.
- [ ] Like and Add to playlist actions that save catalog identity, storefront, and metadata without requiring audio resolution; preserve an existing playback-source mapping when present.
- [ ] Persistent library storage so likes and playlists survive a reload, kept separate from transient playback state.
- [ ] Accounts and cross-device library access.
- [ ] Listening history, recently played tracks, and featured playlists on Home.
- [x] Artist and album records populated from structured iTunes metadata, leaving missing fields unknown and retaining source provenance and storefront.
- [ ] Verify seeking and duration against the actual audio source across supported browsers.
- [ ] Validate desktop/mobile playback under slow connections, failed requests, and listener disconnects.
- [ ] Complete the search-to-play-to-save browser journey once saving is implemented.
- [ ] Confirm deployment requirements and select hosting that supports subprocesses and audio proxying.

### Recommended Next Steps

1. **Finish the remaining playback and storage verification.** Earlier Edge checks cover live seeking, sustained playback, retry recovery, and slow connections. PostgreSQL migration/SQL constraints and short WAV playback/seeking from private R2 now pass in isolation. Verify an individual upstream transfer beyond 120 seconds and instrument the application's upstream cleanup after listener disconnect. Application database connection/pooling, outages, integrated R2 stream delivery, and concurrent repository/worker operations remain to be verified when implemented. Keep broader browser/mobile verification open until exercised on those targets.
2. **Complete the save part of the first milestone.** Add the Library screen, catalog-only likes, personal playlists, and storage that survives reloads. Preserve storefront and any selected video mapping, keep library state separate from playback, and cover playlist operations plus the search → play → save → reload journey. Accounts and cross-device sync follow as a separate step.
3. **Prepare deployment after the core journey is verified.** Confirm a Node host can run `yt-dlp` and proxy audio, then validate stream lifetimes, disconnect cleanup, and the iTunes request budget for the intended worker count.

The five phases below remain the implementation roadmap. The catalog integration is implemented; live audio reliability, library storage, and deployment verification remain open. Search supports a curated set of storefronts; JSON caches and coalescing are worker-local, and static worker budgets require ITUNES_WORKER_COUNT configuration across every worker.

Build the app in five phases, with a working **search → play → save** experience as the first milestone.

## 1. Add iTunes Catalog Metadata and YouTube Matching

Use the iTunes Search API to search for songs by song, artist, or album text and present structured catalog metadata in the frontend. Keep YouTube as the audio source through the existing `yt-dlp` integration. The checked search items above describe the implemented iTunes catalog and on-demand YouTube matching flow.

Keep both integrations in server-only modules, separate from UI and playback state. Request `https://itunes.apple.com/search` with encoded parameters such as `term`, `media=music`, `entity=song`, a bounded `limit`, and an explicitly selected two-letter `country` storefront. Make the storefront configurable and include it in cache keys. No Apple Music API integration or developer token is required for this Search API flow.

Normalize iTunes track ID, title, artist ID/name, album ID/name, catalog duration, genre, explicitness, available release date, store URL, and permitted artwork URL. Leave missing fields unknown. Use bounded caching for search and lookup JSON, deduplicate concurrent requests, and handle upstream failures and throttling. Apple documents approximately 20 calls per minute, subject to change; budget calls across requests and account for multiple app workers rather than assuming each user has an independent allowance.

Resolve a selected catalog track to a YouTube upload only when Play or Add to queue needs a playback source. Separate core titles from recognized recording descriptors, featured-artist labels and upload presentation labels. Require normalized artist attribution and the complete core title, allowing all-word matching for titles of at least three words. Require compatible recording descriptors (including named remixers), with optional remaster labels. Rank qualifying results using title phrase evidence, matching version labels and optional duration proximity; retain YouTube order on ties. Catalog explicitness alone does not constrain the source. Search up to five candidates with the full metadata query, then try one distinct simplified artist/core-title query only if no match qualifies. Limit the complete search phase to 45 seconds, retain cancellation and subprocess safeguards, and propagate upstream errors without fallback. If no confident match exists, leave the current player and queue unchanged. Keep matching criteria explicit and covered by tests.

Store the validated selected video ID and canonical watch URL (`https://www.youtube.com/watch?v={videoId}`) separately from catalog metadata. Retain `/api/metadata/{videoId}` for playback-source inspection. Show the selected upload's title, uploader, and YouTube link alongside catalog details once resolved, so users can inspect the source. Playback reliability and deployment requirements still need verification.

Descriptor normalization supports equivalent labels such as "Sped Up" / "Sped Up Version", "Slowed" / "Slowed Down Version", and "Radio Edit" / "Radio Version". Preserve unknown parenthetical subtitles and ordinary title words such as "Live and Let Die" and "Version of Me".

### Apple Asset Use

Per the requested cover update, retain validated HTTPS mzstatic.com artwork URLs from iTunes metadata and display them directly in the browser, with placeholders for missing or failed images. Do not proxy or persist artwork media. Audio previews remain disabled. Apple's [Search API usage conditions](https://performance-partners.apple.com/search-api) still apply; enabling display does not establish licensing permission for a deployment.

## 2. Build the First Usable Version

Start with three screens:

- **Home:** featured playlists and recently played tracks as library data becomes available.
- **Search:** submit a song, artist, or album query and display iTunes song results with title, artist, album, catalog duration, store link, and permitted artwork or a placeholder. Show YouTube source details once a selection is resolved for playback.
- **Library:** liked songs and personal playlists.

Use a persistent player across navigation, with play/pause, previous/next, seeking, volume, and a queue. Adapt the existing `MusicPlayer` component.

### Search Implementation

1. Reuse separate search input, result, and track-action components and existing UI primitives. Submit on Enter or the Search button; do not request upstream searches on every keystroke.
2. Update `/api/search?q=...&country=...` to return normalized iTunes song results. Trim and validate queries, reject empty, oversized, or control-character input, and validate the storefront. Use timeouts, cancellation, bounded result counts, caching, and structured upstream-error responses.
3. Add a server-side playback-resolution route accepting a validated iTunes track ID and storefront. Obtain trusted catalog fields through lookup/cache rather than trusting client-supplied matching metadata. Search YouTube for bounded candidates without downloading audio. Pass arguments separately to `spawn`; never construct shell commands from user input or external metadata.
4. Match candidates using the criteria in phase 1 and return catalog metadata plus a separate selected YouTube source. Provide resolving, no-match, unavailable-source, and retry states. Resolve before inserting a new catalog selection into the playable queue; coalesce duplicate resolution requests and prevent stale or cancelled actions from changing playback. Connect Like and Add to playlist when library operations are implemented; saving catalog metadata alone need not resolve audio.
5. Send `/api/stream/{videoId}` to the existing shared player mounted in the app layout. Preserve the audio element, playback state, and queue across navigation. Use the browser-reported audio duration and seekable ranges for playback controls; iTunes duration is catalog metadata and may differ from the selected upload.
6. Handle initial, loading, no-result, throttled, and recoverable search-error states. Cancel superseded requests and prevent stale responses from replacing the latest result. A catalog outage or failed match must not interrupt existing playback or discard queued tracks with stored video IDs.
7. Preserve subprocess timeouts, output and concurrency limits, and cleanup on cancellation. Validate resolved video IDs before passing them to the metadata or streaming routes. Keep existing YouTube-only queue entries playable during the transition.

For the interface, use a desktop sidebar, mobile navigation, permitted album artwork or placeholders, and a bottom player.

**Completion check:** a user can find an iTunes catalog track, resolve a suitable YouTube source, play it, navigate elsewhere without interrupting playback, and queue another song. Uncertain matches produce a recoverable no-match state.

## 3. Add Catalog and Library Data

Define these core records:

- `Track`, `Artist`, and `Album`
- Separate playback-source records mapping catalog tracks to validated YouTube video IDs
- `Playlist` and ordered playlist tracks
- User likes and listening history

Use a provider-qualified iTunes track ID as catalog identity and retain storefront context for availability, lookup, and matching. Keep the YouTube video ID as playback-source identity, and retain independent queue-entry IDs so repeated tracks remain distinct. Store catalog metadata, provenance, and the selected source mapping when available; do not repeat text searches to identify saved tracks or silently replace an existing video mapping. Catalog-only likes and playlist entries can resolve their source on first playback. Preserve existing YouTube-only entries with their original video IDs and metadata without inventing iTunes matches.

Refresh catalog metadata by iTunes ID and storefront and resolve audio from the stored video ID as needed. If a video becomes unavailable, show an unavailable state with an explicit retry/rematch action; do not silently select a different recording. Keep sample catalog data separate from production integrations.

Add persistent storage and accounts once the playback flow works. Use the **Shared Postgres Database and Audio Cache Implementation Outline** below for the schema, deduplication rules, rollout, and verification. Keep playback state separate from catalog and library data. Populate artist and album records from structured iTunes metadata, leave missing fields unknown, and retain provider IDs, storefront, and provenance. Keep YouTube upload metadata separate from catalog fields.

**Completion check:** playlists and likes survive a reload; signed-in users retain them across devices.

## 4. Make Playback Reliable

Validate the audio source early:

- Verify seeking and duration reporting.
- Use actual audio duration for playback controls even when it differs from iTunes catalog duration.
- Preserve resolved playback during iTunes outages and handle failed or uncertain source matching without interrupting the current track.
- Show buffering, unavailable-track, and playback-error states.
- Handle failed tracks and queue transitions.
- Clean up streams when listeners disconnect.
- Harden all `yt-dlp` routes with input validation, timeouts, output and concurrency limits, and process cleanup.

**Completion check:** playback works on desktop and mobile, including slow connections and failed requests.

## 5. Test and Prepare Deployment

Run the existing checks:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`

Add focused tests for queue behavior, playlist operations, and a browser journey covering search → play → save. Check keyboard controls, mobile layouts, and playback persistence during navigation.

Cover query and storefront validation, iTunes response normalization, missing metadata, empty results, cache keys and bounds, request deduplication, throttling, upstream failures, subprocess failures and timeouts, cancellation, and stale-response handling. Test title/artist evidence, score ordering and ties, descriptor aliases, incompatible versions, preserved subtitles, missing durations, bounded fallback, deduplicated queries, upstream errors and cancellation. Verify that saved tracks retain catalog identity, storefront, metadata, and any selected video mapping; repeated queue entries and legacy YouTube-only entries must remain valid. Verify catalog-only saves, explicit rematching, actual-source duration, and continued playback during catalog outages. Use Edge for browser tests.

Choose hosting after confirming the audio delivery requirements.

## Shared Postgres Database and Audio Cache Implementation Outline

Status: PostgreSQL repositories now persist catalog/source metadata and selected mappings through search, resolution, and metadata routes. The stream route can serve ready private R2 assets with `R2_PLAYBACK_ENABLED=true`, retaining YouTube fallback. Download/publication workers and authenticated library operations remain unimplemented. Test clusters are temporary; verification does not establish a provisioned application database or production deployment. Keep iTunes as the catalog and YouTube as the existing playback source.

### 1. Storage Responsibilities and Identity

- Use one shared Postgres database for catalog metadata, YouTube source records, source mappings, cache jobs, and eventually private user libraries.
- Store audio bytes in a private **Cloudflare R2 Standard** bucket using its S3-compatible API. Postgres records the object key and media properties, rather than storing the audio itself.
- Deduplicate YouTube sources by validated **video ID**, extracted from accepted YouTube URL forms. Store one canonical `https://www.youtube.com/watch?v={videoId}` URL per source. Tracking and timestamp parameters must not create new entries. Reject unsupported hosts and malformed IDs before external work.
- Enforce uniqueness in Postgres, not only with an application lookup. Use parameterized `INSERT ... ON CONFLICT` operations for simultaneous requests.
- Keep catalog identity separate: the same YouTube upload may map to multiple storefront/catalog records, and different YouTube uploads of the same song remain different sources. Never deduplicate by title alone.
- Treat liked songs and playlists as durable user data. Audio is an evictable cache; deleting an audio object must not remove a source, catalog track, like, or playlist entry.

### 2. Proposed Tables and Constraints

| Table | Main fields and rules |
| --- | --- |
| `catalog_tracks` | UUID primary key; provider, provider track ID, storefront; title, artist/album IDs and names, catalog duration, artwork/store URLs, provenance, fetched/refresh timestamps. Unique `(provider, provider_track_id, storefront)`. Keep external IDs as text. |
| `youtube_sources` | Validated `video_id` primary key; unique canonical URL; upload title, uploader, source duration, availability, metadata timestamps. Retain unavailable sources so saved references remain valid. |
| `track_sources` | Catalog-track foreign key and video-ID foreign key; match evidence, selected timestamp. Unique `(catalog_track_id, video_id)` and at most one selected mapping per catalog track. Existing mappings change only through explicit rematching. |
| `audio_assets` | UUID primary key; source foreign key; format/profile key; object key, MIME type, codec/container, byte size, measured duration, checksum, cache state, access/creation/expiry timestamps. Unique `(video_id, profile_key)`; start with one original-audio profile and no transcoding. |
| `cache_jobs` | Asset foreign key; state, attempt count, next-attempt time, lease owner/token/expiry, last error. At most one active job per asset; indexed for due-job claims. |
| `users` | Internal user ID and unique authenticated identity mapping, introduced with accounts. Never accept a client-supplied owner ID as authorization. |
| `likes` | Owner foreign key and catalog-track foreign key; unique `(user_id, catalog_track_id)`; creation timestamp. Catalog-only saves need no source resolution. |
| `playlists` | UUID primary key, owner foreign key, name, timestamps, revision for concurrent edits. |
| `playlist_items` | Independent item UUID, playlist foreign key, catalog-track foreign key, position. Unique `(playlist_id, position)` with transactional reordering; allow repeated tracks. |

Use foreign keys, nonnegative size/duration checks, explicit cache-state checks, and indexes for owner listings, playlist order, source lookup, and cache eviction. Existing YouTube-only queue entries remain playable through `youtube_sources`; do not fabricate catalog identities to migrate them. Queue-entry IDs remain independent from database source keys.

#### Detailed Column Schema

This schema is implemented in `database/migrations/0001_initial_schema.sql` and was verified against an isolated test database, as recorded above. Application database setup and repository integration remain pending. `PK` means primary key, `FK` means foreign key, and `?` means nullable. All other columns are required. UUID primary keys are generated on insert; creation timestamps default to the current time. Application updates must maintain `updated_at`.

**`catalog_tracks`** — trusted catalog metadata, independent of source resolution.

| Column | Postgres type | Purpose / constraint |
| --- | --- | --- |
| `id` | UUID, PK | Internal track identifier |
| `provider` | TEXT | Initially `itunes` |
| `provider_track_id` | TEXT | Original catalog track ID |
| `storefront` | TEXT | Validated two-letter country code |
| `title` | TEXT | Song title |
| `artist_id`, `artist_name` | TEXT? | Catalog artist identifier and name |
| `album_id`, `album_name` | TEXT? | Catalog album identifier and name |
| `duration_ms` | INTEGER? | Nonnegative catalog duration |
| `artwork_url`, `store_url` | TEXT? | Validated external links; no stored artwork bytes |
| `metadata` | JSONB | Additional fields and provenance; default `{}` |
| `fetched_at` | TIMESTAMPTZ | Last successful metadata fetch |
| `refresh_after` | TIMESTAMPTZ | Metadata refresh deadline |

Unique constraint: `(provider, provider_track_id, storefront)`. External identifiers remain text. Missing artist, album, and duration fields stay null rather than using invented values.

**`youtube_sources`** — one durable row per YouTube video.

| Column | Postgres type | Purpose / constraint |
| --- | --- | --- |
| `video_id` | TEXT, PK | Validated YouTube video ID |
| `canonical_url` | TEXT, UNIQUE | Must equal `https://www.youtube.com/watch?v=` plus `video_id` |
| `upload_title` | TEXT? | YouTube upload title |
| `uploader` | TEXT? | Channel/uploader name |
| `duration_seconds` | DOUBLE PRECISION? | Finite, nonnegative source-reported duration |
| `availability` | TEXT | `unknown`, `available`, or `unavailable`; default `unknown` |
| `metadata_fetched_at` | TIMESTAMPTZ? | Last successful metadata fetch |
| `availability_checked_at` | TIMESTAMPTZ? | Last availability check |
| `created_at` | TIMESTAMPTZ | First recorded |

URL variants, timestamps, and tracking parameters resolve to the same video-ID primary key. Unavailable videos retain their rows and saved references.

**`track_sources`** — catalog-to-video mappings and matching evidence.

| Column | Postgres type | Purpose / constraint |
| --- | --- | --- |
| `catalog_track_id` | UUID, FK | References `catalog_tracks.id` |
| `video_id` | TEXT, FK | References `youtube_sources.video_id` |
| `is_selected` | BOOLEAN | Current selected mapping; default `false` |
| `match_evidence` | JSONB | Matching evidence; default `{}` |
| `selected_at` | TIMESTAMPTZ? | Selection timestamp; required when selected |
| `created_at` | TIMESTAMPTZ | Mapping creation time |

Composite PK: `(catalog_track_id, video_id)`. Partial unique index on `catalog_track_id WHERE is_selected` permits at most one selected source per catalog track. Source changes require explicit rematching and transactional deselection/selection. Several catalog tracks may reference the same video.

**`audio_assets`** — cached file descriptors; audio bytes remain in object storage.

| Column | Postgres type | Purpose / constraint |
| --- | --- | --- |
| `id` | UUID, PK | Asset identifier |
| `video_id` | TEXT, FK | References `youtube_sources.video_id` |
| `profile_key` | TEXT | Audio selection profile; initially one original-audio profile |
| `object_key` | TEXT? | Private storage object key |
| `state` | TEXT | `pending`, `downloading`, `ready`, `failed`, `deleting`, or `evicted`; default `pending` |
| `mime_type` | TEXT? | Audio content type |
| `codec`, `container` | TEXT? | Actual media format |
| `byte_size` | BIGINT? | Nonnegative completed size |
| `duration_seconds` | DOUBLE PRECISION? | Finite, nonnegative measured duration |
| `checksum` | TEXT? | Verified integrity checksum |
| `last_accessed_at` | TIMESTAMPTZ? | Supports cache eviction |
| `expires_at` | TIMESTAMPTZ? | Retention deadline |
| `created_at`, `updated_at` | TIMESTAMPTZ | Lifecycle timestamps |

Unique constraint: `(video_id, profile_key)`. A ready asset requires a non-null object key, MIME type, codec, container, positive byte size, measured duration, and checksum; publication also requires worker verification that the object is complete and readable. Store object keys rather than expiring signed URLs. Refreshes may replace the underlying object without changing the asset's identity.

**`cache_jobs`** — durable work coordination across worker instances.

| Column | Postgres type | Purpose / constraint |
| --- | --- | --- |
| `id` | UUID, PK | Job identifier |
| `audio_asset_id` | UUID, FK | References `audio_assets.id` |
| `state` | TEXT | `queued`, `running`, `completed`, `failed`, or `cancelled`; default `queued` |
| `attempt_count` | INTEGER | Nonnegative; default `0` |
| `next_attempt_at` | TIMESTAMPTZ | Retry scheduling; default current time |
| `lease_owner` | TEXT? | Worker holding the job |
| `lease_token` | UUID? | Identifies the current claim |
| `lease_expires_at` | TIMESTAMPTZ? | Enables recovery after worker failure |
| `last_error` | TEXT? | Sanitized failure information |
| `created_at`, `updated_at` | TIMESTAMPTZ | Job timestamps |

Partial unique index on `audio_asset_id WHERE state IN ('queued', 'running')` prevents duplicate active jobs. Running jobs require all lease fields; inactive jobs clear them. Index due queued jobs by `next_attempt_at` and running jobs by `lease_expires_at`. A retry requeues the same job; a later refill may create a new job after the previous one is terminal.

**`users`** — internal identity for account-backed libraries.

| Column | Postgres type | Purpose / constraint |
| --- | --- | --- |
| `id` | UUID, PK | Internal user identifier |
| `auth_provider` | TEXT | Authentication provider |
| `auth_subject` | TEXT | Provider's stable user ID |
| `display_name` | TEXT? | Optional display name |
| `created_at`, `updated_at` | TIMESTAMPTZ | Account timestamps |

Unique constraint: `(auth_provider, auth_subject)`. Resolve ownership from the authenticated server session, never a client-supplied owner ID.

**`likes`** — saved catalog songs, requiring no audio resolution.

| Column | Postgres type | Purpose / constraint |
| --- | --- | --- |
| `user_id` | UUID, FK | References `users.id` |
| `catalog_track_id` | UUID, FK | References `catalog_tracks.id` |
| `created_at` | TIMESTAMPTZ | When the song was liked |

Composite PK: `(user_id, catalog_track_id)`. Index `(user_id, created_at)` for library listings.

**`playlists`** — playlist ownership and editing version.

| Column | Postgres type | Purpose / constraint |
| --- | --- | --- |
| `id` | UUID, PK | Playlist identifier |
| `user_id` | UUID, FK | References `users.id` |
| `name` | TEXT | Nonempty after trimming |
| `revision` | INTEGER | Nonnegative concurrency version; default `0` |
| `created_at`, `updated_at` | TIMESTAMPTZ | Playlist timestamps |

Index `user_id` for owner listings. Playlist names need not be unique. Every item/name edit checks and increments the playlist revision within the same transaction.

**`playlist_items`** — independently identified, ordered playlist entries.

| Column | Postgres type | Purpose / constraint |
| --- | --- | --- |
| `id` | UUID, PK | Independent playlist-entry identifier |
| `playlist_id` | UUID, FK | References `playlists.id` |
| `catalog_track_id` | UUID, FK | References `catalog_tracks.id` |
| `position` | INTEGER | Nonnegative order within the playlist |
| `added_at` | TIMESTAMPTZ | When the entry was added |

Unique constraint: `(playlist_id, position)`, deferrable for transactional reordering. Do not add uniqueness on `(playlist_id, catalog_track_id)`; repeated songs are allowed.

**Relationships and deletion rules:** user deletion cascades to owned likes/playlists, and playlist deletion cascades to its items. Catalog/source deletion is restricted while referenced. Audio eviction deletes the storage object and changes asset state; it does not delete catalog or source rows. Cache-job records reference durable asset rows. Queue entries remain transient and retain their independent IDs outside these tables.

### 3. Database Foundation

1. Add a server-only pooled Postgres client and versioned SQL migrations. Prefer a small Postgres driver and SQL migrations initially; explain any added dependency before installation. Keep connections bounded across web and worker instances.
2. Separate modules for database access, catalog/source repositories, library operations, object storage, and worker jobs. No database credentials or storage SDK in client components.
3. Document `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `AUDIO_CACHE_ENABLED`, `AUDIO_CACHE_MAX_BYTES`, `AUDIO_CACHE_RETENTION_DAYS`, and `AUDIO_CACHE_WORKER_CONCURRENCY` in `.env.example` without real values. Derive the R2 S3 endpoint from the account ID and use SDK region `auto`. Keep credentials server-only. R2 is the planned audio-storage provider; select the Postgres host before provisioning.
4. Migrate in order: catalog/source tables, assets/jobs, then account/library tables. Use an isolated test database, automated backups, and a restore check before production rollout.

### 4. Shared Metadata and Mapping Cache

1. Upsert trusted catalog metadata from validated server responses during lookup/resolution. Store source metadata once a video is selected for playback; queued selections may warm metadata but must not automatically download every queued song.
2. Look up the stored catalog-to-source mapping before searching YouTube again. Reuse the video ID and refresh stale metadata independently. Keep short-lived signed upstream media URLs out of durable source identity.
3. Preserve existing playback during database or catalog failures where the current validated source is already available. Cache-write failures must not stop a working stream.
4. Record metadata freshness separately from source availability and audio-cache readiness. Apply bounded refreshes and backoff; a temporary upstream failure must not delete saved metadata.

### 5. Playback and Audio Cache Fill

1. On an actual Play/stream request, validate the video ID and find the source and preferred asset. A cache hit requires a completed, readable object, not just a database row.
2. For a ready asset, serve it through the existing stream route with correct MIME, length, and byte-range responses. Preserve seeking, cancellation, and browser-reported duration. Keep the bucket private.
3. On a miss, preserve the current live proxy behavior and atomically enqueue one fill job. Initial fills use a separate worker download so playback is not blocked by storage uploads; document the temporary duplicate upstream transfer. Do not tie a durable job to the Next.js request lifetime.
4. Workers claim due jobs in short transactions using row locking and `SKIP LOCKED`, set renewable leases, and download outside the transaction. Bound subprocess time, output, file size, concurrency, and retries. Continue separate-argument subprocess invocation without shell commands.
5. Download/upload to a unique staging object; verify completion, media properties, byte size, and checksum before publishing it as ready. Use lease tokens and conditional updates so an expired worker cannot publish over its replacement. Never serve partial objects.
6. Recover abandoned leases after worker crashes. Reconcile uploads that succeeded before a database failure, clean orphan/staging objects, and remove temporary local files on success, failure, or cancellation.
7. On missing/corrupt objects, mark the asset unavailable and refill with backoff while falling back to the current source where available. Never silently substitute a different recording. Source rematching remains explicit.

Audio retention/re-serving must be enabled only for content the deployment is authorized to store and serve. Keep the worker independently configurable; metadata persistence can ship first without enabling audio caching.

#### Cloudflare R2 Setup and Delivery

- Create separate development and production buckets using **Standard** storage. Disable public access, including the `r2.dev` endpoint. Issue bucket-scoped API credentials with only the object permissions needed by the web server and download/cleanup workers.
- Implement a server-only R2 adapter for upload, head, ranged get, and delete using the S3-compatible SDK. Explain the SDK dependency when implementing it. Keep storage details behind this adapter so playback and library components do not depend on R2.
- Use application-generated keys such as `audio/{videoId}/{profileKey}/{assetVersion}.{extension}` and `staging/{jobId}/{leaseToken}`. Derive extensions from verified media properties, never arbitrary user input. Persist the final object key in `audio_assets`; do not persist signed URLs.
- Initially proxy private R2 reads through the existing stream route. Pass supported byte ranges to R2 and preserve correct `206`, `416`, `Content-Range`, `Content-Length`, and content-type behavior. Browser requests stay same-origin, so direct browser-to-R2 CORS is unnecessary for this phase. Verify R2 behavior against its S3 compatibility documentation rather than assuming full AWS parity.
- Budget for R2 Standard's current free allowance: **10 GB-month storage, 1 million Class A operations, and 10 million Class B operations per month**, with no R2 internet egress charge. These are allowances, not hard spending caps; recheck pricing before deployment. The app host can still charge for bandwidth used by the proxy.
- Start with an **8 GB cache budget** to leave headroom for staging objects and replacements. Reserve expected space before claiming downloads, enforce per-file and staging limits, and include pending/deleting objects in accounting. Evict eligible least-recently-used audio before admitting more fills; skip fills when capacity cannot be reserved. This application budget reduces usage but does not guarantee a zero bill.
- Configure R2 lifecycle cleanup for stale staging objects and incomplete multipart uploads. Coordinate final-object eviction through the database cleanup worker so ready assets are not silently removed by bucket lifecycle rules. Reconcile objects and database rows periodically.
- Monitor storage and Class A/B usage, configure available billing notifications, and keep an application switch to stop new cache fills while allowing current playback and valid cache hits. Avoid excessive per-play HEAD/list calls and frequent full-bucket scans.
- Before enabling production fills, test private-bucket access, duplicate concurrent requests, upload interruption, missing objects, seek/range behavior in Edge, staging cleanup, eviction, and recovery after R2 errors. No Cloudflare Worker is required for this initial design; web and download workers access R2 through its S3 API.

R2 references: [pricing and free allowances](https://developers.cloudflare.com/r2/pricing/), [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/), [API credentials](https://developers.cloudflare.com/r2/api/tokens/), and [object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

### 6. Library Integration

1. Implement catalog-only likes and ordered playlists against repository interfaces, then connect the Library screen and navigation. Resolve playback only when needed.
2. Introduce authenticated ownership before exposing shared-database library writes. Cross-device libraries belong to this account-backed stage; the global song cache itself needs no public user profiles.
3. Enforce ownership server-side for every read/edit. Use transactions for playlist add/remove/reorder and revision checks for concurrent edits. Users may reference shared records but may not overwrite trusted catalog/source metadata.
4. Keep the shared player mounted across navigation. Reuse existing components/UI primitives and keep library state separate from transient playback and queue state.

### 7. Cache Operations and Failure Handling

- Set configurable byte and age limits. Evict least-recently-used eligible audio, with a grace period for active delivery; throttle access-timestamp writes.
- Track deletion state and retry failed object deletions. Reconcile database/object-storage differences periodically; library foreign keys reference durable tracks, not evictable assets.
- Measure metadata/source cache hits, audio hits/misses, downloaded/stored bytes, fill failures, lease recovery, and queue age. Do not log credentials or signed media URLs.
- Retain current subprocess safeguards. Use a separately bounded worker download timeout appropriate for whole tracks instead of the stream proxy's absolute timeout. Test long tracks and early listener disconnect independently.
- Global deployment means shared state across app instances; it does not require multiple writable database regions initially. Keep app, worker, database, and storage near each other and revisit regional delivery after measuring demand.

### 8. Delivery Order and Acceptance Checks

1. **Metadata persistence:** migrations, repositories, YouTube-ID uniqueness, trusted catalog upserts, and mapping reuse. Concurrent URL variants must produce one source row and preserve existing selected mappings.
2. **Audio cache:** private object-storage adapter, durable fill worker, range-aware cache hits, cleanup, and eviction. Concurrent misses must create one active fill job; crash recovery must not publish partial or stale output.
3. **Library persistence:** account ownership, likes, playlist operations, Library UI, and reload/cross-device persistence. Audio eviction must leave saved music intact.
4. **Release validation:** meaningful database integration tests for unique constraints, concurrent jobs, lease recovery, transaction rollback, playlist ordering/ownership, and metadata preservation. Exercise storage failures, missing objects, bounded retries, and database outages.
5. Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` after implementation. Use Edge to verify cache miss then hit, seeking/duration on cached audio, long tracks, navigation persistence, keyboard/mobile layouts, and search -> play -> save -> reload. Keep provider-backed tests separate from stubbed coverage.

Technical references: [Postgres INSERT / ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html), [Postgres row-locking SELECT](https://www.postgresql.org/docs/current/sql-select.html), [S3 GetObject and byte ranges](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html). Source-use constraints: [YouTube terms](https://www.youtube.com/static?template=terms).

## First Implementation Scope

Implement iTunes song search and frontend metadata with server-side caching, then add on-demand YouTube matching while retaining the responsive app shell and persistent player with a shared queue. Display catalog cover metadata with missing/broken-image fallbacks as requested; keep artwork media separate from JSON caching. Connect saving through the library phase. Defer iTunes previews, standalone artist/album browsing, user-facing alternate-source selection, subscriptions, recommendations, social features, and offline downloads until the core experience is dependable.

Search defaults to the top five iTunes songs in upstream order. The player shows a plain song title with iTunes artist and album, omitting explicitness, genre and release year. Search and queue cards display title, artist and album, with duration, genre, release date, explicitness, storefront and source/store links in an icon-triggered details popup. Source metadata stays separate for YouTube inspection; elapsed time, duration and seeking use the browser audio resource. Cover metadata is displayed in search, queue, and the desktop player; missing or failed covers use a music icon.
