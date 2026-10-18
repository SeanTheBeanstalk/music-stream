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
likes, playlists, and persistence belong to the library phase.

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
`TEST_CDP`. It checks a live iTunes search and YouTube resolution, actual playback and seeking,
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

Catalog unit tests cover normalization, cover URL validation and preview exclusion, storefronts, cache bounds, coalescing, cancellation, throttling, failures, matching variants and queue identity. Live audio matching and seeking still require network/browser validation.

Run `node tests/browser-catalog-check.mjs` with the same Edge setup for deterministic catalog submission, storefront selection, resolution retry, stale-response cancellation, empty/throttled states and queue preservation checks. These browser checks stub external services; they do not validate live YouTube matching or audio.

Search defaults to the top five iTunes songs in upstream order. The player shows a plain song title with iTunes artist, album and explicitness, omitting genre and release year. Search and queue cards display title, artist and album, with duration, genre, release date, explicitness, storefront and source/store links in an icon-triggered details popup. Source metadata stays separate for YouTube inspection; elapsed time, duration and seeking use the browser audio resource. Cover metadata is displayed in search, queue, and the desktop player; missing or failed covers use a music icon.
