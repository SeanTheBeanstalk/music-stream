# Music Streaming Web App Plan

## Current Foundation

The repository has a Next.js/TypeScript foundation, Tailwind styling, a reusable audio player, and experimental YouTube metadata/streaming routes. The homepage is still a starter screen.

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
