# Music stream

The first Search version follows `PLAN.md`: submit a song, artist, or album at
`/search`, preview the first YouTube result, and play it or add it to the shared
queue. Playback continues between Home and Search. Queue data stays in memory;
likes, playlists, and persistence belong to the library phase.

Open Queue from the bottom player to see the current track and upcoming tracks.
Play a queued selection, use the arrow buttons to reorder upcoming tracks,
remove an upcoming track, or clear upcoming tracks while keeping current
playback. All controls work with a keyboard; Escape closes the queue and
returns focus to its button.
Selecting a queued track replaces current playback and keeps the other upcoming
tracks in order; the previous current track remains in playback history.

## Run locally

Use Node.js 22.6+ and pnpm. Install `yt-dlp` separately on the server and ensure
it is on PATH, or copy `.env.example` to `.env.local` and set `YT_DLP_PATH` to
its executable path. No YouTube API key is required. The server needs outbound
access to YouTube and Google video hosts; deployment needs a Node runtime that
can launch subprocesses and proxy audio responses.

```sh
pnpm install
pnpm dev
```

Search runs on submission only. Server processes have a 30-second timeout,
a 2 MiB output limit, and a limit of four concurrent subprocesses per worker.
Audio responses forward byte ranges for seeking and cancel upstream requests
when the listener disconnects. YouTube availability and supported audio formats
can vary by upload and browser.

## Checks

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
`TEST_CDP`. It checks a live YouTube search, actual playback and seeking,
keyboard range controls, navigation persistence, mobile overflow, stale
responses, and empty/error states. It needs network access and does not run
as part of the unit tests.

For queue interactions without YouTube access, run
`node tests/browser-queue-check.mjs` with the same server and Chromium setup.
It stubs search and audio to check queue selection (including duplicate video
IDs), removal, reordering, clearing, navigation persistence, keyboard actions,
focus handling, and layouts at 320, 375, 768, and 1280 pixels. This check does
not validate real audio playback or seeking.
