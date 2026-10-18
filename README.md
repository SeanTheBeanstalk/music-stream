# Music stream

The first Search version follows `PLAN.md`: submit a song, artist, or album at
`/search`, preview the first YouTube result, and play it or add it to the shared
queue. Playback continues between Home and Search. Queue data stays in memory;
likes, playlists, and persistence belong to the library phase.

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

Streaming selects `bestaudio` using yt-dlp's quality ranking rather than
preferring M4A over other formats. The selected audio is proxied unchanged,
without transcoding or resampling. Codec and bitrate depend on the formats
YouTube makes available for each upload; this does not add lossless quality or
restore detail missing from the source. The browser must support the selected
format.

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
focus handling, repeat modes and track endings, and layouts at 320, 375, 768,
and 1280 pixels. Use headless Microsoft Edge for browser checks. This check does
not validate real audio playback or seeking.
