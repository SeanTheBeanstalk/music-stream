# Music Streaming Web App Plan

## Current Foundation

The repository has a Next.js/TypeScript foundation, Tailwind styling, responsive Home and Search screens, a shared audio player and queue, and YouTube search, metadata, and audio streaming routes backed by `yt-dlp`. Library features and persistent storage are still planned.

## Feature Checklist

Checked items are implemented in the current working tree. They do not imply that live playback, browser compatibility, or deployment has been fully validated.

### App Foundation and Navigation

- [x] Next.js App Router with TypeScript, Tailwind styling, theme provider, and reusable UI primitives.
- [x] Home landing page with a link to music search.
- [x] Search page built from separate input, result, and track-action components.
- [x] Responsive app shell with a desktop sidebar, mobile navigation, and active-page indicators.
- [x] Bottom player with independently scrolling page content.
- [x] Accessibility support through a skip link, labeled controls, keyboard focus styles, and live search/player status announcements.

### YouTube Search and Metadata

- [x] Submit a song, artist, or album query with Enter or the Search button; no search subprocess on each keystroke.
- [x] `/api/search?q=...` resolves the first YouTube result through `yt-dlp` without downloading audio.
- [x] Trim and validate queries, rejecting empty, oversized, and control-character input.
- [x] Normalize tracks with a validated video ID, canonical watch URL, title, artwork, and optional uploader and duration.
- [x] Preview the selected upload with artwork, metadata, and a link to YouTube before playing.
- [x] Play and Add to queue actions with queue confirmation feedback.
- [x] Initial, loading, no-result, success, and recoverable search-error states.
- [x] Cancel superseded searches and requests on unmount; prevent stale results from replacing the latest search.
- [x] `/api/metadata/{videoId}` retrieves normalized metadata for a validated video ID.

### Planned Artist and Source Verification

- [ ] Inspect available video descriptions and metadata for artist names, record labels, distributor credits, and copyright notices (©/℗).
- [ ] Compare uploader channel IDs against a trusted mapping of confirmed artist and label channels; do not trust channel names alone.
- [ ] Combine available evidence into source-confidence labels: Confirmed source, Likely official, or Unverified, with a brief explanation of the matching signals.
- [ ] Treat description text, copyright symbols, and music credits as supporting evidence rather than proof of an official upload or original recording; leave missing or inconclusive metadata Unverified.
- [ ] Add meaningful tests for trusted channel matches, copied or misleading credits, missing metadata, and conflicting artist information.

### Shared Playback and Queue

- [x] One audio element and playback provider mounted in the root layout to preserve playback across Home/Search navigation.
- [x] Playback and queue state separated from search UI and track normalization.
- [x] Play/pause, previous/next, volume, elapsed time, and duration controls.
- [x] Seek control enabled when the browser reports a seekable resource and finite duration.
- [x] In-memory queue retaining selected video IDs and metadata without repeating text searches.
- [x] Queue additions preserve the active track and upcoming order; the first track stays in Up next until Play makes it current.
- [x] Playing a selection inserts it after the current track and preserves upcoming tracks; replaying the same video is supported.
- [x] Advance to the next queued track when playback ends; respect queue boundaries without wrapping.
- [x] Empty-player, empty-queue, end-of-queue, upcoming-track, and queued-count displays.
- [x] Buffering and playback-failure messages with manual retry or skip controls.

### Streaming and Server Safeguards

- [x] `/api/stream/{videoId}` resolves and proxies audio, preferring M4A with fallback formats.
- [x] Forward valid byte-range requests and upstream range/content headers to support seeking.
- [x] Validate video IDs before subprocess calls and restrict resolved audio URLs to HTTPS Google video hosts.
- [x] Shared server-side `yt-dlp` runner using separate arguments and no shell execution.
- [x] Subprocess limits: 30-second timeout, 2 MiB combined output, and four concurrent processes per worker.
- [x] Kill subprocesses on cancellation and release timers, listeners, and concurrency slots on completion.
- [x] Upstream audio requests use cancellation signals and a 120-second timeout.
- [x] Return structured errors for invalid input, unavailable services/tracks, busy workers, and timeouts.
- [x] Optional `YT_DLP_PATH` configuration documented without secrets in `.env.example`.

### Tests and Setup Documentation

- [x] Unit tests for track normalization and canonical identity, queue order, replay, and queue boundaries.
- [x] Unit tests for subprocess cancellation, missing executables, concurrency, output limits, failures, and timeouts.
- [x] Browser smoke-test script covering live search/playback, seeking, keyboard controls, navigation persistence, mobile overflow, stale results, and empty/error states.
- [x] Browser regression script for touch and keyboard search submission and player visibility at multiple viewport sizes.
- [x] README setup instructions for Node.js, pnpm, `yt-dlp`, environment configuration, checks, and manual/browser validation.

### Remaining Roadmap and Verification

- [ ] Visible, interactive queue panel showing the current track and upcoming tracks in playback order.
- [ ] Queue controls to play a queued track, remove tracks, reorder upcoming tracks, and clear upcoming tracks without interrupting current playback.
- [ ] Responsive, keyboard-accessible queue UI with an empty state and meaningful tests for queue interactions.
- [ ] Library screen, liked songs, personal playlists, and playlist operations with meaningful tests.
- [ ] Persistent library storage, accounts, and cross-device access.
- [ ] Listening history, recently played tracks, and featured playlists on Home.
- [ ] Artist and album records when reliable metadata is available.
- [ ] Verify seeking and duration against the actual audio source across supported browsers.
- [ ] Validate desktop/mobile playback under slow connections, failed requests, and listener disconnects.
- [ ] Complete the search-to-play-to-save browser journey once saving is implemented.
- [ ] Confirm deployment requirements and select hosting that supports subprocesses and audio proxying.

The five phases below remain the implementation roadmap. Test scripts listed above exist; this documentation update does not record a new test run.

Build the app in five phases, with a working **search → play → save** experience as the first milestone.

## 1. Use YouTube for the First Version

The agreed starting point is a search bar that resolves a text query to YouTube’s first search result, using the existing `yt-dlp` integration for metadata and audio streaming.

Resolve a query to a video ID and construct its canonical watch URL as `https://www.youtube.com/watch?v={videoId}`. Keep YouTube access in server-only modules, separate from UI and playback state.

The current routes launch `yt-dlp` and remain a prototype until playback reliability and deployment requirements are verified. Changing the music source requires agreement before implementation.

## 2. Build the First Usable Version

Start with three screens:

- **Home:** featured playlists and recently played tracks as library data becomes available.
- **Search:** submit a song, artist, or album query and show the first YouTube result as a playable track.
- **Library:** liked songs and personal playlists.

Use a persistent player across navigation, with play/pause, previous/next, seeking, volume, and a queue. Adapt the existing `MusicPlayer` component.

### Search Implementation

1. Build separate search input, result, and track-action components using existing UI primitives. Submit on Enter or the Search button; do not launch a subprocess on every keystroke.
2. Add `/api/search?q=...`. Trim the query, reject empty or oversized input, and run `yt-dlp` with `ytsearch1:{query}` to resolve one result without downloading audio. Pass arguments separately to `spawn`; never construct a shell command from the query.
3. Return a normalized track with its video ID, canonical YouTube URL, title, artwork, and available uploader and duration metadata. Do not assume the uploader is the artist or that album metadata is available.
4. Show the selected title and artwork with Play and Add to queue actions. Connect Like and Add to playlist when library operations are implemented. The first result may be a cover, live version, or unrelated upload, so users should see the selection before playing it.
5. Send `/api/stream/{videoId}` to one shared player mounted in the app layout. Extract shared playback and queue state from the current player so search actions can control it without remounting the audio element.
6. Handle initial, loading, no-result, and error states. Cancel superseded requests and prevent stale responses from replacing the latest result. Searching or navigating must not interrupt the current track.
7. Enforce subprocess timeouts, output and concurrency limits, and cleanup on cancellation. Validate resolved video IDs before passing them to the metadata or streaming routes.

Defer alternate search results and result-selection controls until the first-result flow works reliably.

For the interface, use a desktop sidebar, mobile navigation, album artwork, and a bottom player.

**Completion check:** a user can find a track, play it, navigate elsewhere without interrupting playback, and queue another song.

## 3. Add Catalog and Library Data

Define these core records:

- `Track`, `Artist`, and `Album`
- `Playlist` and ordered playlist tracks
- User likes and listening history

Use resolved YouTube tracks for the initial search flow. Store the video ID and metadata snapshot when queuing, liking, or saving a track; do not repeat the text search to identify a saved track. Refresh metadata or resolve playback from that stored ID as needed. Any sample catalog used for UI development must stay separate from the production integration.

Add persistent storage and accounts once the playback flow works. Keep playback state separate from catalog and library data. Artist and album records can be populated when reliable metadata is available; they are not prerequisites for first-result search.

**Completion check:** playlists and likes survive a reload; signed-in users retain them across devices.

## 4. Make Playback Reliable

Validate the audio source early:

- Verify seeking and duration reporting.
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

Cover query validation, first-result normalization, no results, subprocess failures and timeouts, cancellation, and stale-response handling. Verify that saved tracks retain the selected video ID and that searches leave existing playback intact.

Choose hosting after confirming the audio delivery requirements.

## First Implementation Scope

Build the responsive app shell, a search bar that selects YouTube’s first result, and persistent playback with a shared queue. Connect saving through the library phase. Defer alternate search results, subscriptions, recommendations, social features, and offline downloads until that core experience is dependable.
