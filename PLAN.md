# Music Streaming Web App Plan

## Current Foundation

The repository has a Next.js/TypeScript foundation, Tailwind styling, responsive Home and Search screens, a shared audio player with an interactive queue panel, and YouTube search, metadata, and audio streaming routes backed by `yt-dlp`. The next search revision will use the Spotify Web API for catalog metadata and use that metadata to select a matching YouTube video for playback. Spotify integration, library features, and persistent storage are still planned.

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
- [x] Current `/api/search?q=...` resolves the first YouTube result through `yt-dlp` without downloading audio; replace this selection strategy with the planned Spotify-guided matching below.
- [x] Trim and validate queries, rejecting empty, oversized, and control-character input.
- [x] Normalize tracks with a validated video ID, canonical watch URL, title, artwork, and optional uploader and duration.
- [x] Preview the selected upload with artwork, metadata, and a link to YouTube before playing.
- [x] Play and Add to queue actions with queue confirmation feedback.
- [x] Initial, loading, no-result, success, and recoverable search-error states.
- [x] Cancel superseded searches and requests on unmount; prevent stale results from replacing the latest search.
- [x] Current `/api/metadata/{videoId}` retrieves normalized YouTube metadata for a validated video ID; retain it for playback-source inspection, with Spotify supplying catalog metadata after migration.

### Planned Spotify Metadata and YouTube Matching

- [ ] Search the Spotify Web API from a server-only module and resolve the submitted song, artist, or album query to a track before searching YouTube.
- [ ] Use Spotify track IDs, title, artists, album, artwork, duration, Spotify URL, and ISRC when available as catalog metadata. Keep missing fields optional and include a link back to the Spotify track with its metadata/artwork.
- [ ] Configure server-only `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`, document placeholder names in `.env.example`, and obtain/reuse access tokens through the Client Credentials flow. Never expose credentials or tokens to the browser.
- [ ] Construct the YouTube query from the resolved Spotify title, artist names, and relevant version qualifiers, rather than forwarding only the original user query.
- [ ] Retrieve a bounded set of YouTube candidates (initially five) and rank them by title/artist agreement, version agreement, and duration proximity to the Spotify track; use verified artist/label channel evidence as an additional signal.
- [ ] Penalize covers, live performances, remixes, karaoke, sped-up/slowed edits, and unrelated uploads unless the selected Spotify track explicitly identifies that version. Do not discard version qualifiers during normalization.
- [ ] Select the highest-confidence candidate rather than the first YouTube result. Define and test a minimum match threshold; return a clear no-reliable-match state when candidates are weak or ambiguous.
- [ ] Return Spotify catalog metadata alongside a separate YouTube playback-source record containing video ID, URL, upload title, uploader/channel evidence, actual video duration, and match confidence/reasons.
- [ ] Keep Spotify catalog duration separate from actual audio duration; use the browser's audio duration and seekable ranges for playback controls.
- [ ] Handle missing credentials, token expiry, Spotify rate limits (`Retry-After`), unavailable catalog tracks, no Spotify results, and no reliable YouTube match. Keep retries bounded and cancel superseded Spotify and YouTube requests.
- [ ] Add meaningful tests for Spotify response normalization, token handling, rate limits, candidate ranking, version/duration mismatches, ambiguous matches, cancellation, and preserving playback during search.

### Planned Artist and Source Verification

- [ ] Inspect available video descriptions and metadata for artist names, record labels, distributor credits, and copyright notices (©/℗).
- [ ] Compare candidate video evidence with the resolved Spotify title, artists, version, and duration; a catalog match alone does not confirm that an uploader is official.
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
- [x] Browser smoke-test script covering live search/playback, seeking, keyboard controls, navigation persistence, mobile overflow, stale results, and empty/error states.
- [x] Browser queue regression script with stubbed search/audio covering selection, removal, reordering, clearing, navigation persistence, keyboard controls, focus handling, and layouts at 320, 375, 768, and 1280 pixels.
- [x] README setup instructions for Node.js, pnpm, `yt-dlp`, environment configuration, checks, and manual/browser validation.

### Remaining Roadmap and Verification

- [ ] Library screen, liked songs, personal playlists, and playlist operations with meaningful tests.
- [ ] Persistent library storage, accounts, and cross-device access.
- [ ] Listening history, recently played tracks, and featured playlists on Home.
- [ ] Artist and album records populated from Spotify catalog metadata, with separate YouTube playback-source mappings.
- [ ] Verify seeking and duration against the actual audio source across supported browsers.
- [ ] Validate desktop/mobile playback under slow connections, failed requests, and listener disconnects.
- [ ] Complete the search-to-play-to-save browser journey once saving is implemented.
- [ ] Confirm deployment requirements and select hosting that supports subprocesses and audio proxying.

The five phases below remain the implementation roadmap. Test scripts listed above exist; this documentation update does not record a new test run.

Build the app in five phases, with a working **search → play → save** experience as the first milestone.

## 1. Use Spotify Metadata to Match YouTube Playback

The target search flow resolves the user's query through the Spotify Web API, then uses the selected track's title, artists, version, and duration to find and rank matching YouTube videos. Spotify supplies catalog metadata; the existing `yt-dlp` integration continues to resolve YouTube candidates and audio streams.

Keep Spotify catalog identity separate from YouTube playback identity. Resolve the best matching video ID and construct its canonical watch URL as `https://www.youtube.com/watch?v={videoId}`. Keep both integrations in server-only modules, separate from UI and playback state. Reference the official [Spotify track schema](https://developer.spotify.com/documentation/web-api/reference/get-track) for available metadata fields.

The current routes still use YouTube's first result and remain a prototype until the planned matching flow, playback reliability, and deployment requirements are verified. This roadmap changes the metadata provider to Spotify while retaining YouTube as the playback source.

## 2. Build the First Usable Version

Start with three screens:

- **Home:** featured playlists and recently played tracks as library data becomes available.
- **Search:** submit a song, artist, or album query, resolve Spotify catalog metadata, and preview the best matching YouTube upload as a playable track.
- **Library:** liked songs and personal playlists.

Use a persistent player across navigation, with play/pause, previous/next, seeking, volume, and a queue. Adapt the existing `MusicPlayer` component.

### Search Implementation

1. Build separate search input, result, and track-action components using existing UI primitives. Submit on Enter or the Search button; do not launch a subprocess on every keystroke.
2. Update `/api/search?q=...`. Trim the query, reject empty, oversized, or control-character input, and resolve a Spotify track through a server-only client. Rank catalog matches against the requested title, artist, album, and version; report ambiguity rather than choosing an unrelated track. Normalize the selected Spotify metadata before resolving playback.
3. Build a YouTube query from Spotify title, artists, and version qualifiers. Run `yt-dlp` with `ytsearch5:{metadataQuery}` without downloading audio and rank the candidates by title/artist similarity, version agreement, duration proximity, and available trusted channel evidence. Pass arguments separately to `spawn`; never construct a shell command from user input or external metadata. Reject candidates below a tested confidence threshold.
4. Return Spotify catalog metadata and a separate selected YouTube source record. Preview the Spotify title, artists, album, and artwork with a Spotify link, plus the upload title, YouTube link, and match explanation. Provide Play and Add to queue actions only when a reliable playback match exists. Connect Like and Add to playlist when library operations are implemented.
5. Send `/api/stream/{videoId}` to one shared player mounted in the app layout. Extract shared playback and queue state from the current player so search actions can control it without remounting the audio element.
6. Handle initial, loading, no-Spotify-result, no-reliable-video-match, and error states, including Spotify authentication and rate-limit failures. Cancel superseded requests across both integrations and prevent stale responses from replacing the latest result. Searching or navigating must not interrupt the current track.
7. Enforce subprocess timeouts, output and concurrency limits, and cleanup on cancellation. Validate resolved video IDs before passing them to the metadata or streaming routes.

Evaluate multiple YouTube candidates internally from the start. Defer user-facing alternate-result selection controls until automatic matching works reliably.

For the interface, use a desktop sidebar, mobile navigation, album artwork, and a bottom player.

**Completion check:** a user can find a track, play it, navigate elsewhere without interrupting playback, and queue another song.

## 3. Add Catalog and Library Data

Define these core records:

- `Track`, `Artist`, and `Album`
- `Playlist` and ordered playlist tracks
- User likes and listening history

Use Spotify track identity and catalog metadata, with a separate mapping to the selected YouTube playback source. Store the Spotify track ID, metadata snapshot, selected video ID, and match evidence when queuing, liking, or saving a track; do not repeat the text search to identify a saved track. Refresh catalog metadata by Spotify ID and resolve playback from the stored video ID as needed. If a video becomes unavailable, rematch using the saved Spotify identity and metadata. Any sample catalog used for UI development must stay separate from the production integration.

Add persistent storage and accounts once the playback flow works. Keep playback state separate from catalog and library data. Populate artist and album records from Spotify IDs and metadata as library features are implemented.

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

Cover query validation, Spotify normalization and authentication, rate limits, no catalog results, candidate ranking, wrong versions, duration differences, weak/ambiguous matches, subprocess failures and timeouts, cancellation, and stale-response handling. Verify that saved tracks retain both Spotify identity and the selected video ID, and that searches leave existing playback intact. Use Edge for browser tests.

Choose hosting after confirming the audio delivery requirements.

## First Implementation Scope

Retain the responsive app shell and persistent playback with a shared queue. Replace first-result YouTube search with Spotify catalog lookup followed by metadata-guided YouTube candidate ranking. Connect saving through the library phase. Defer user-facing alternate-result selection, subscriptions, recommendations, social features, and offline downloads until that core experience is dependable.
