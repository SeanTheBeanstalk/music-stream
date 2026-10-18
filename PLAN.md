# Music Streaming Web App Plan

## Current Foundation

The repository has a Next.js/TypeScript foundation, Tailwind styling, responsive Home and Search screens, a shared audio player with an interactive queue panel, and YouTube search, metadata, and audio streaming routes backed by `yt-dlp`. Search now uses the iTunes Search API for structured catalog metadata and resolves selected tracks to title-and-artist YouTube matches on demand, retaining YouTube for playback. Planned work also includes library features and persistent storage.

## Feature Checklist

Checked items are implemented in the current working tree. They do not imply that live playback, browser compatibility, or deployment has been fully validated.

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
- [x] Player displays the catalog song title, artist, and album separately from YouTube upload metadata; playback timing uses the browser audio resource.
- [x] Seek control enabled when the browser reports a seekable resource and finite duration.
- [x] In-memory queue retaining selected video IDs and metadata without repeating text searches.
- [x] Queue additions preserve the active track and upcoming order; the first track stays in Up next until Play makes it current.
- [x] Playing a selection inserts it after the current track and preserves upcoming tracks; replaying the same video is supported.
- [x] Advance to the next queued track when playback ends; stop at the queue boundary when repeat is Off.
- [x] Empty-player, empty-queue, end-of-queue, upcoming-track, and queued-count displays.
- [x] Buffering and playback-failure messages with manual retry or skip controls.
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
- [x] Unit tests for catalog normalization and provenance, separate catalog/video identities, title-and-artist matching, cache coalescing and cancellation, storefront isolation, request budgets, upstream errors, the five-result limit, and player metadata.
- [x] Browser smoke-test script covering live search/playback, seeking, keyboard controls, navigation persistence, mobile overflow, stale results, and empty/error states.
- [x] Browser queue regression script with stubbed search/audio covering selection, removal, reordering, clearing, navigation persistence, keyboard controls, focus handling, and layouts at 320, 375, 768, and 1280 pixels.
- [x] Browser catalog regression script with stubbed catalog/resolution/audio covering submit-only search, storefront selection, details popups, keyboard access, failed-match safety and retry, stale searches/actions, empty/throttled states, playback preservation, and responsive layouts.
- [x] README setup instructions for Node.js, pnpm, `yt-dlp`, environment configuration, checks, and manual/browser validation.

### Remaining Roadmap and Verification

- [x] iTunes catalog search through a validated, cached server route, with storefront selection and rate-limit handling.
- [x] Structured iTunes track metadata in search results, with separate catalog and playback identities.
- [x] Resolve selected catalog tracks on Play or Add to queue using core-title/artist evidence, compatible recording descriptors, ranked candidates, and one bounded fallback query.
- [x] Display validated iTunes cover metadata in search, queue, and player with missing/broken-image fallbacks, as requested. Audio previews remain disabled.
- [ ] Library screen, liked songs, personal playlists, and playlist operations with meaningful tests.
- [ ] Persistent library storage, accounts, and cross-device access.
- [ ] Listening history, recently played tracks, and featured playlists on Home.
- [x] Artist and album records populated from structured iTunes metadata, leaving missing fields unknown and retaining source provenance and storefront.
- [ ] Verify seeking and duration against the actual audio source across supported browsers.
- [ ] Validate desktop/mobile playback under slow connections, failed requests, and listener disconnects.
- [ ] Complete the search-to-play-to-save browser journey once saving is implemented.
- [ ] Confirm deployment requirements and select hosting that supports subprocesses and audio proxying.

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

Add persistent storage and accounts once the playback flow works. Keep playback state separate from catalog and library data. Populate artist and album records from structured iTunes metadata, leave missing fields unknown, and retain provider IDs, storefront, and provenance. Keep YouTube upload metadata separate from catalog fields.

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

## First Implementation Scope

Implement iTunes song search and frontend metadata with server-side caching, then add on-demand YouTube matching while retaining the responsive app shell and persistent player with a shared queue. Display catalog cover metadata with missing/broken-image fallbacks as requested; keep artwork media separate from JSON caching. Connect saving through the library phase. Defer iTunes previews, standalone artist/album browsing, user-facing alternate-source selection, subscriptions, recommendations, social features, and offline downloads until the core experience is dependable.

Search defaults to the top five iTunes songs in upstream order. The player shows a plain song title with iTunes artist and album, omitting explicitness, genre and release year. Search and queue cards display title, artist and album, with duration, genre, release date, explicitness, storefront and source/store links in an icon-triggered details popup. Source metadata stays separate for YouTube inspection; elapsed time, duration and seeking use the browser audio resource. Cover metadata is displayed in search, queue, and the desktop player; missing or failed covers use a music icon.
