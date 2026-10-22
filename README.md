# Music Stream

A music streaming web app with catalog search, a persistent audio player, queues,
and account-based libraries. Search uses the iTunes catalog for metadata and
matches selected songs to YouTube audio through a server-side `yt-dlp` integration.
PostgreSQL and private Cloudflare R2 storage add saved libraries and optional
audio caching.

> **Vibecoded with OpenAI Codex.** This project was built through AI-assisted,
> prompt-driven development to explore and test Codex's capabilities: building
> interfaces, implementing backend integrations, debugging, and iterating on an
> application. It is an experimental project, not a production readiness claim.

## Features

- Search songs by title, artist, or album across supported iTunes storefronts.
- Play audio with seeking, volume, next/previous, and repeat controls.
- Keep playback running while navigating between Home, Search, and Library.
- Add, reorder, remove, and repeat tracks in a shared queue.
- Create an account to save liked songs and ordered playlists in PostgreSQL.
- Add playlist descriptions and custom covers using private R2 storage.
- Optionally cache verified audio through a separate worker, with bounded storage
  and fallback to the live source.
- Responsive layouts, keyboard controls, and light/dark themes.

## Stack

Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, shadcn/ui,
PostgreSQL, Cloudflare R2 (S3 API), and `yt-dlp`. The cache worker also uses
`ffprobe` from FFmpeg.

## Run locally

Install Node.js 22.17.1 or newer within the Node.js 22 release line, pnpm, and
`yt-dlp`. Make `yt-dlp` available on PATH, or set `YT_DLP_PATH` in `.env.local`.
The Node requirement covers the TypeScript and environment-file flags used by
the project's scripts.

```sh
pnpm install --frozen-lockfile
```

Copy [`.env.example`](.env.example) to `.env.local` if that file does not already
exist. Keep the default cache switches disabled for basic search and playback;
no database, R2 credentials, or YouTube API key is needed for that mode.

```sh
pnpm dev
```

Open the address printed by Next.js. The app needs outbound access to iTunes,
YouTube, and the upstream media hosts. Builds also download Google Fonts.

For accounts and playlists, configure `DATABASE_URL` and apply migrations
**0001 through 0004 in order**. For custom covers, also configure the R2 variables.
For audio caching, install `ffprobe`, configure PostgreSQL and R2, enable
`AUDIO_CACHE_ENABLED`, and run `pnpm cache:worker` in a second terminal.
See [running the app](RUNNING.md) and [database setup](database/README.md).

## Development checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Database tests require an isolated, migrated `TEST_DATABASE_URL`; they skip when
it is unset. Browser checks use headless Microsoft Edge and run separately.
See [technical documentation](TECHNICAL.md#checks) for integration checks and
their prerequisites.

## Project layout

| Path | Purpose |
| --- | --- |
| `app/` | Pages, shared layout, and server API routes |
| `components/` | Search, library, playback, and shared UI components |
| `lib/music/` | Catalog, matching, queue, and playback logic |
| `lib/server/` | Providers, database, accounts, storage, and cache services |
| `database/` | Versioned SQL migrations and database checks |
| `scripts/` | Audio worker, R2 utilities, and cover cleanup |
| `tests/` | Unit, database, browser, and live integration checks |

## Project status and limits

This is a personal experiment in developing an app with Codex. AI-generated code
can contain mistakes; review it before adapting it for a public deployment.
Provider availability, source matching, and browser audio support can vary.
The playback queue resets on reload; saved libraries require PostgreSQL.
Accounts currently have no password recovery or email verification.

The app requires a Node.js host that can launch subprocesses and proxy audio;
it cannot run as a static export. Enable audio storage and re-serving only for
content you are authorized to store and serve, and review provider terms before
deployment. This repository does not include music files or provider credentials.

## Documentation

- [Technical implementation and operations](TECHNICAL.md)
- [Local setup and running instructions](RUNNING.md)
- [Database setup and migrations](database/README.md)
- [Implementation roadmap](PLAN.md)
- [R2 integration guide](cloudflare_r2_integration_guide.md)
- [GitHub readiness review](GITHUB_READINESS.md)

No license has been selected for this repository yet.
