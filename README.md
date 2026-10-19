# Music stream

Search follows `PLAN.md`: submit a song, artist, or album at `/search`, choose
an iTunes storefront, and browse the top five structured song results. Play or Add
to queue resolves a trusted catalog lookup against up to five YouTube candidates
per query. The resolver separates the core title from recording descriptors,
featured-artist labels and upload presentation labels. It normalizes accents,
apostrophes, punctuation and case, and requires the artist plus the complete core
title (a phrase, or all title words for titles of three or more words).
Candidates must have compatible recording labels such as sped up, slowed, live,
acoustic, radio edit or remix; named remixers remain required. Remaster labels
are optional. Equivalent descriptor wording is accepted, while unknown subtitles
remain part of the title. Title phrase evidence ranks above reordered words;
matching version labels and similar duration provide supporting scores. Missing
duration is allowed. Equal scores preserve YouTube order. Catalog explicitness
alone does not verify whether an upload is clean or explicit.
If no candidate qualifies, one simplified artist/core-title query is tried with
the same version requirements. Equivalent queries are deduplicated. There are at
most two searches, ten candidates total, and a shared 45-second timeout. Upstream
errors stop resolution rather than triggering fallback. No confident match
produces a recoverable error and leaves playback and the queue unchanged.
Catalog IDs and artist/album records remain separate from video IDs; repeated
queue selections and legacy YouTube-only entries remain supported. Inspect the
resolved upload's title, uploader and YouTube link in its result card.
Playback continues between Home and Search. Queue data stays in memory;
likes and playlists belong to the authenticated library phase. Optional Postgres
storage persists shared catalog metadata and selected YouTube mappings.

Catalog covers use validated iTunes artwork URLs, loaded directly by the browser.
Missing or failed images fall back to a music icon. Artwork media is not proxied
or persisted; audio previews remain disabled. Apple's [usage conditions](https://performance-partners.apple.com/search-api) still apply.

Open Queue from the bottom player to see the current track and upcoming tracks.
Adding the first track leaves it in Up next without loading audio. Press the
player's Play button to start the first upcoming track, or play any queued track
directly from the queue panel.
Play a queued selection, use the arrow buttons to reorder upcoming tracks,
remove an upcoming track, or clear upcoming tracks while keeping current
playback. All controls work with a keyboard; Escape closes the queue and
returns focus to its button.
Selecting a queued track replaces current playback and keeps the other upcoming
tracks in order; the previous current track remains in playback history.

The player's repeat button cycles through Off, Repeat track, and Repeat queue.
Repeat track restarts the current track when it ends. Repeat queue plays through
all retained tracks, including playback history, then returns to the first.
Next and Previous keep their normal queue boundaries in every mode. Changing
repeat mode leaves playback uninterrupted and keeps the mode across navigation;
reloading the app resets it to Off. Playback errors still require retry or skip.

## Run locally

Use Node.js 22.6+ and pnpm. Install `yt-dlp` separately on the server and ensure
it is on PATH, or copy `.env.example` to `.env.local` and set `YT_DLP_PATH` to
its executable path. No YouTube API key is required. The server needs outbound
access to itunes.apple.com, YouTube and Google video hosts; deployment needs a Node runtime that
can launch subprocesses and proxy audio responses.

```sh
pnpm install
pnpm dev
```

Search runs on submission only. No Apple token is required. `ITUNES_COUNTRY`
sets the default storefront (US by default; US, SG, GB, AU, CA, JP, DE, FR and IN
are supported). Search/lookup JSON is cached for five minutes (100 entries),
with shared concurrent requests and independent subscriber cancellation.
Resolution mappings are cached for 15 minutes (100 entries). Abandoned work is
cancelled when its last subscriber leaves; failed resolutions are retryable.
The iTunes timeout is 10 seconds. Throttled responses include Retry-After.

The server budgets 18 Apple calls/minute divided by `ITUNES_WORKER_COUNT`
(default 1). Set this to the maximum number of concurrent app workers across
all instances, including overlapping deployments. Caches and counters are
process-local; dynamic scaling or other clients sharing the upstream allowance
requires a shared gateway limiter before deployment. Configurations above 18
workers disable uncached requests rather than exceed this budget.

Server processes have a 30-second timeout,
a 2 MiB output limit, and a limit of four concurrent subprocesses per worker.
Audio responses forward byte ranges for seeking and cancel upstream requests
when the listener disconnects. YouTube availability and supported audio formats
can vary by upload and browser.

Streaming selects `bestaudio` using yt-dlp's quality ranking rather than
preferring M4A over other formats. The selected audio is proxied unchanged,
without transcoding or resampling. Codec and bitrate depend on the formats
YouTube makes available for each upload; this does not add lossless quality or
restore detail missing from the source. The browser must support the selected
format.

## Cloudflare R2 storage

The lean [R2 integration guide](cloudflare_r2_integration_guide.md) is implemented
in `lib/server/r2.ts` and `lib/server/storage.ts`. It uses one lazy S3 client and
one bucket, with upload, private signed playback/upload URLs, HEAD, ranged GET,
and delete helpers. Configuration is required only when a helper is called.
SDK requests have bounded retries/timeouts and accept caller cancellation.

Create a private Standard R2 bucket and bucket-scoped object credentials, then
set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
`R2_BUCKET_NAME` in `.env.local` (see `.env.example`). Restart after changing
credentials. Keep public access disabled. `R2_PUBLIC_URL` is documented for
compatibility with the guide but is unused by this private-storage integration.
Account endpoints, region `auto`, and signed URLs follow
[Cloudflare's SDK example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

Exercise the integration with a small audio file you are authorized to store:

```sh
pnpm r2 upload ./sample.mp3 dev/audio/sample.mp3 audio/mpeg
pnpm r2 head dev/audio/sample.mp3
pnpm r2 play-url dev/audio/sample.mp3
pnpm r2 upload-url dev/audio/direct.mp3 audio/mpeg
```

The CLI loads `.env`, then `.env.local`; existing process environment variables
take precedence. Playback URLs expire after one hour; upload URLs expire after
15 minutes. Treat printed URLs as temporary access credentials. Direct uploads
must send the signed Content-Type. Browser-to-R2 requests also need bucket CORS
for your application's origin and relevant methods/headers; server-side uploads
do not. HEAD confirms object size/type; URL signing alone does not check existence.

Server callers import helpers from `@/lib/server/storage`. `getAudio` returns the
SDK response including its streaming `Body`, content length/type/range, and ETag;
the caller must consume or destroy the body. Helpers propagate SDK errors so the
delivery layer can handle missing objects or unsatisfiable ranges. Generate keys
on the server and verify audio contents before upload; a MIME label is not media
validation. The CLI reads the supplied file into memory and is intended for small
manual uploads. No public upload or signing API is exposed.

Set `R2_PLAYBACK_ENABLED=true` with `DATABASE_URL` and the R2 credentials to serve
ready assets through `/api/stream/{videoId}`. The shared player already uses this
route, so search results and queued tracks automatically use stored audio when
available. The route reads `audio_assets` for profile `original-audio-v1`, state
`ready`, and an unexpired asset. It streams private R2 objects with byte ranges,
correct length/type and 206/416 responses; browser requests remain same-origin
and require no R2 CORS. Canceling delivery cancels the storage transfer.

On cache misses, database failures, or R2 failures before delivery begins, playback
uses the existing YouTube proxy. Missing objects are conditionally marked evicted;
transient failures do not evict them. Access timestamps are updated at most once
per five minutes per asset. Failures during an active transfer use the player's
existing retry behavior. Stored signed URLs are never required.

Automatic fills are available with `AUDIO_CACHE_ENABLED=true`; this also enables
R2 playback. `R2_PLAYBACK_ENABLED` remains a separate read-only switch. Manual CLI
uploads alone do not create ready database assets.

### Cache audio when a track plays

1. Apply `database/migrations/0002_cache_objects.sql` after migration 0001.
2. Set `AUDIO_CACHE_ENABLED=true` in `.env.local`, with `DATABASE_URL` and R2
   credentials. Restart the app after changing environment variables.
3. Install ffprobe (part of FFmpeg) and yt-dlp on the worker host. Set
   `FFPROBE_PATH` / `YT_DLP_PATH` if their executables are not on PATH.
4. Run `pnpm cache:worker` alongside the Next.js server. Deploy this as a
   continuously running process with automatic restart. `pnpm cache:worker --once`
   performs one pass per configured worker lane for diagnostics.

A successful uncached stream request creates one durable job per video/profile.
Adding a song to the queue does not download it. The first play uses the current
YouTube proxy; the worker makes a separate upstream transfer, so the initial fill
temporarily downloads audio twice. Only the short database enqueue runs in the
stream request. Cache failures preserve the existing stream. Later plays use the
private R2 object after successful publication.

The worker streams the original audio to a unique temporary file, verifies its
actual container, codec, and duration with ffprobe, uploads under a unique object
key, checks HEAD, and reads the object back to verify its complete SHA-256 hash.
It then atomically marks `audio_assets` ready and `cache_jobs` completed in
Postgres, storing the key, type, codec, container, size, duration, checksum, and
expiry. Signed media URLs are never stored. Unpublished objects are never served.

Jobs use renewable 60-second leases and token-protected publication, with up to
three attempts and backoff. Worker crashes requeue expired leases; exhausted jobs
can be retried by a later play after a one-hour cooldown. Downloads have a
ten-minute total deadline and a configurable 128 MB per-file limit. ffprobe has
a 30-second deadline. Local files are removed after work; abandoned local files
and unpublished objects become eligible for cleanup after 20 minutes, beyond the
job deadline. Uncertain database commits retain object records for reconciliation.

`AUDIO_CACHE_MAX_BYTES` defaults to 8 GB, `AUDIO_CACHE_RETENTION_DAYS` to 30, and
`AUDIO_CACHE_WORKER_CONCURRENCY` to one lane per worker process (maximum four).
Each claim reserves the configured `AUDIO_CACHE_MAX_FILE_BYTES` before download;
reservations, uploaded objects, and pending deletions count against the shared
budget. Full capacity triggers least-recently-used eviction with a ten-minute
access grace period. Capacity is released only after deletion succeeds. Object
deletion never removes catalog records, source mappings, or saved library data.
The budget covers tracked application objects; manual/untracked bucket objects
and provider billing need separate monitoring. Enable retention only for content
the deployment is authorized to store and serve.

To verify the worker against an isolated database with both migrations applied:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@HOST/ISOLATED_DATABASE'
pnpm test
node --conditions=react-server --experimental-strip-types --env-file-if-exists=.env.local tests/audio-cache-live-check.mjs
```

The explicit live check uses a generated three-second WAV, real ffprobe and R2,
and the isolated database. It verifies upload/publication, full and ranged reads,
duplicate plays, and fixture cleanup; it does not download third-party content.

## PostgreSQL integration

Apply the migration using [database setup](database/README.md), then set the
server-only `DATABASE_URL` and restart the app. No migration runs automatically.
The `pg` dependency provides a lazy shared pool (five connections per app process),
parameterized queries, and transactions following the
[driver documentation](https://node-postgres.com/features/transactions). Allow for
all app instances when setting database connection limits. Connections time out
after three seconds and statements after five seconds; use your provider's
verified TLS settings in the URL for hosted databases.

Search saves trusted catalog responses. Resolution reuses fresh metadata for
24 hours and preserves selected mappings across restarts and app instances;
concurrent selections lock the catalog row and keep the first selected source.
Expired catalog metadata refreshes through iTunes; a temporary catalog outage
can use saved metadata without extending its freshness. The metadata endpoint
also reuses source metadata for 24 hours. Metadata freshness, source availability,
and audio readiness are separate; metadata fetches do not assert playability.
With no database configured, or a failed read/write, provider search and playback
remain available. Database errors are logged without query values or credentials.
No authenticated likes or playlist writes are exposed by this integration.

## Checks

PostgreSQL creation scripts, the versioned schema migration from `PLAN.md`,
and database constraint checks are documented in [database/README.md](database/README.md).
Run the repository integration suite against an isolated migrated database by
setting `TEST_DATABASE_URL` before `pnpm test`. It skips by default and never uses
`DATABASE_URL`. The suite checks metadata upserts/storefront isolation, concurrent
mapping selection, freshness, ready/expired assets, throttled access timestamps,
and replacement-safe invalidation; it removes its own fixtures afterward.

`tests/browser-storage-integration-check.mjs` verifies the actual application
stream route with live R2 and an isolated migrated Postgres database. Start the
app with that database as `DATABASE_URL` and `R2_PLAYBACK_ENABLED=true`, launch
a dedicated headless Edge instance on CDP port 9224, and run:

```powershell
$env:TEST_DATABASE_URL = 'postgres://USER:PASSWORD@HOST:PORT/ISOLATED_TEST_DATABASE'
$env:TEST_ORIGIN = 'http://127.0.0.1:3001' # origin of the configured test app
node --conditions=react-server --experimental-strip-types --env-file-if-exists=.env.local tests/browser-storage-integration-check.mjs
```

The check uploads a generated 12-second WAV and publishes a temporary ready asset,
then verifies byte-identical full/range/suffix/open-range reads, 416 handling,
invalid route inputs, and Edge duration, forward/backward seeking, and playback.
Cleanup deletes the fixture's database rows and R2 object, and confirms HEAD 404.
It does not run automatically with `pnpm test`.

For a live R2 browser check, launch a dedicated headless Microsoft Edge instance
with a blank tab and remote debugging on port 9224, then run:

```sh
node --conditions=react-server --experimental-strip-types --env-file-if-exists=.env --env-file-if-exists=.env.local tests/browser-r2-check.mjs
```

Use `TEST_CDP` to select a different debugging endpoint. This check needs the
server-only R2 configuration above and live bucket access. It uploads a unique
12-second generated WAV, checks private signed-URL and adapter-backed local
proxy playback, duration, forward/backward seeking, full playback, byte ranges,
missing objects, and cancellation. It deletes the object in cleanup and confirms
HEAD returns 404; a failed cleanup needs investigation. It never prints signed
URLs or credentials. The harness binds to an ephemeral loopback port and closes
afterward. This does not exercise the app's stream route, other formats, long
tracks, or browser-to-R2 fetch CORS. It runs separately from the offline tests.

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

The build downloads the existing Google Fonts and needs network access.
For a manual check, search and play a track, queue a second, navigate to Home
and back, then test next/previous, volume, and seeking. Repeat at mobile width
and use Tab, Enter, and the range controls' arrow keys. Verify the error state
with an unavailable track and that a new search leaves playback intact.

An optional browser smoke test is available as `node tests/browser-check.mjs`.
It expects the app on `http://localhost:3000` and a Chromium browser with a blank
tab and remote debugging on port 9224. Override these through `TEST_ORIGIN` and
`TEST_CDP`. It checks a live iTunes search and YouTube resolution, actual playback and seeking,
keyboard range controls, navigation persistence, mobile overflow, stale
responses, and empty/error states. It needs network access and does not run
as part of the unit tests.

The live smoke test defaults to `rick astley never gonna give you up`; set
`TEST_QUERY` to exercise another catalog selection. Source matching may return
a recoverable no-match result for some selections.

After the live smoke test passes, run
`node tests/browser-live-playback-check.mjs` against the same Edge tab and
`TEST_ORIGIN`. Allow about four minutes and use a track longer than 140 seconds.
This checks sustained playback beyond 120 seconds, a seek with 32 KiB/s bandwidth
and 250 ms latency, recovery after an offline reload with position restoration,
the track's natural end, and client cancellation of a live stream request. It
restores network conditions and pauses playback on exit. This does not prove
cleanup of the server's upstream connection or that an individual proxy response
can transfer for longer than 120 seconds. Edge mobile viewport checks do not
replace testing on physical mobile devices or other browser engines.

For real Edge media recovery with deterministic HTTP 502/partial WAV responses,
run `node tests/browser-retry-check.mjs`. Set `TEST_ORIGIN` explicitly when using
a port other than that script's default of 3001.

For queue interactions without YouTube access, run
`node tests/browser-queue-check.mjs` with the same server and Chromium setup.
It stubs search and audio to check queue selection (including duplicate video
IDs), removal, reordering, clearing, navigation persistence, keyboard actions,
focus handling, repeat modes and track endings, and layouts at 320, 375, 768,
and 1280 pixels. Use headless Microsoft Edge for browser checks. This check does
not validate real audio playback or seeking.

Catalog unit tests cover normalization, cover URL validation and preview exclusion, storefronts, cache bounds, coalescing, cancellation, throttling, failures, matching variants and queue identity. Live audio matching and seeking still require network/browser validation.

Run `node tests/browser-catalog-check.mjs` with the same Edge setup for deterministic catalog submission, storefront selection, resolution retry, stale-response cancellation, empty/throttled states and queue preservation checks. These browser checks stub external services; they do not validate live YouTube matching or audio.

Search defaults to the top five iTunes songs in upstream order. The player shows a plain song title with iTunes artist, album and explicitness, omitting genre and release year. Search and queue cards display title, artist and album, with duration, genre, release date, explicitness, storefront and source/store links in an icon-triggered details popup. Source metadata stays separate for YouTube inspection; elapsed time, duration and seeking use the browser audio resource. Cover metadata is displayed in search, queue, and the desktop player; missing or failed covers use a music icon.
