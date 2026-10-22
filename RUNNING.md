# Running the app

Run these commands from the project folder in PowerShell:

```powershell
cd path\to\music-stream
```

## Each time you start development

Make sure your PostgreSQL server is running and `.env.local` is configured as
described below. A hosted PostgreSQL database only needs to be reachable.

In the first terminal, start the website:

```powershell
pnpm dev
```

Open the address printed in the terminal, usually <http://localhost:3000>.

In a second terminal, open the same project folder and start the audio cache worker:

```powershell
cd path\to\music-stream
pnpm cache:worker
```

Keep both terminals open. Press `Ctrl+C` in each terminal to stop its process.
If a cache worker is already running in the background, you can keep using it.

When you play an uncached track, the website streams it from YouTube and records
a download job in PostgreSQL. The worker downloads and verifies the audio,
uploads it to private R2 storage, and marks its database record ready. Later plays
use the stored audio. Adding a song to the queue alone does not download it.

If the worker is stopped, new jobs wait in PostgreSQL until it starts again;
ordinary source playback can still work.

## Isolated production playback checks

To test a new production build alongside the existing server without replacing
its `.next` output, use a separate output directory and port. In PowerShell:

```powershell
$env:NEXT_DIST_DIR = 'build/port3002'
pnpm build
$env:AUDIO_CACHE_ENABLED = 'false'
$env:R2_PLAYBACK_ENABLED = 'false'
pnpm start --port 3002 --hostname 127.0.0.1
```

Open <http://127.0.0.1:3002>. Both build and start must use the same
`NEXT_DIST_DIR`. These cache switches affect only this process and force live
YouTube streaming without enqueueing cache fills. Database configuration is
still shared with `.env.local`. Use a separate terminal for the regular server.

For the live audio regression check, launch a dedicated headless Edge with a
blank tab and remote debugging, then run in another terminal:

```powershell
$env:TEST_ORIGIN = 'http://127.0.0.1:3002'
$env:TEST_CDP = 'http://127.0.0.1:9226'
node tests/browser-youtube-availability-check.mjs
```

This checks real ranged audio responses, browser playback, duration, and forward
and backward seeking for the Taylor Swift and keshi recordings. It requires
live provider access and does not test the app's queue controls or R2 cache.

## First-time setup

### 1. Install the required tools

- Node.js 22.17.1 or newer within the Node.js 22 release line, and pnpm.
- yt-dlp for YouTube playback and cache downloads.
- ffprobe, included with FFmpeg, for the cache worker's audio verification.
- PostgreSQL 14 or newer, locally or hosted. Install the `psql` client if you
  want to apply the database scripts from a terminal.
- A private Cloudflare R2 bucket and bucket-scoped object credentials.

Install the project's dependencies:

```powershell
pnpm install --frozen-lockfile
```

### 2. Configure the environment

Create `.env.local` only if it does not already exist:

```powershell
if (-not (Test-Path .env.local)) {
    Copy-Item .env.example .env.local
}
```

Edit `.env.local` and fill in the following values. Replace the placeholders;
keep existing working credentials if the file is already configured.

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/music_stream"

R2_ACCOUNT_ID=YOUR_ACCOUNT_ID
R2_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
R2_BUCKET_NAME=YOUR_PRIVATE_BUCKET_NAME

AUDIO_CACHE_ENABLED=true
AUDIO_CACHE_MAX_BYTES=8000000000
AUDIO_CACHE_MAX_FILE_BYTES=128000000
AUDIO_CACHE_RETENTION_DAYS=30
AUDIO_CACHE_WORKER_CONCURRENCY=1

ITUNES_COUNTRY=US
ITUNES_WORKER_COUNT=1
```

If yt-dlp or ffprobe is not on PATH, also set its executable path. For example:

```dotenv
YT_DLP_PATH="C:/Tools/yt-dlp.exe"
FFPROBE_PATH="C:/Tools/ffmpeg/bin/ffprobe.exe"
```

Use your actual installed paths. Keep `.env.local` private; it is ignored by Git.
`AUDIO_CACHE_ENABLED=true` enables both cache fills and playback from R2.
`R2_PLAYBACK_ENABLED=true` is only needed if you want R2 reads while automatic
fills are disabled. Public bucket access and `R2_PUBLIC_URL` are unnecessary.

Restart both the website and worker after changing environment variables.

### 3. Set up the database once

For a new local database, with PostgreSQL running and `psql` on PATH:

```powershell
psql -X -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -f database/create-database.sql
```

This creates `music_stream` and applies migrations 0001 through 0004. Match
`DATABASE_URL` to your database credentials. Skip this command if the database
already exists.

For an empty database you created through a hosting provider, apply all four scripts
in order using its SQL editor, or use `psql` with your host and database:

```powershell
psql -X -h YOUR_HOST -U YOUR_USER -d YOUR_DATABASE -v ON_ERROR_STOP=1 -f database/migrations/0001_initial_schema.sql
psql -X -h YOUR_HOST -U YOUR_USER -d YOUR_DATABASE -v ON_ERROR_STOP=1 -f database/migrations/0002_cache_objects.sql
psql -X -h YOUR_HOST -U YOUR_USER -d YOUR_DATABASE -v ON_ERROR_STOP=1 -f database/migrations/0003_library_accounts.sql
psql -X -h YOUR_HOST -U YOUR_USER -d YOUR_DATABASE -v ON_ERROR_STOP=1 -f database/migrations/0004_playlist_metadata.sql
```

For an existing installation, apply only the missing migrations in numeric
order. These scripts run once; do not rerun
them on every startup. See [database setup](database/README.md) for details.

Then start the website and worker using the two terminals above.

## Run a production build locally

Build the website, then start it:

```powershell
pnpm build
pnpm start
```

Keep `pnpm cache:worker` running in a separate terminal. For deployment, configure
the website and worker as separate supervised processes with the same database,
R2 credentials, and cache settings. The worker host also needs yt-dlp and ffprobe.

## Check the setup

Run the development checks when changing application code:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Database integration tests require a separate migrated `TEST_DATABASE_URL`;
they skip when it is unset. Do not point tests at the application database.

To check worker configuration with one pass:

```powershell
pnpm cache:worker --once
```

This can process a queued job and then exit; it does not keep the worker running.
During normal use, a completed upload prints `Audio cache job completed.` in the
worker terminal.

If playback works but uploads do not, check that `AUDIO_CACHE_ENABLED=true`, all
four migrations are applied, and the worker is running. If the worker reports a missing
tool, correct `YT_DLP_PATH` or `FFPROBE_PATH`. If it reports database or storage
failures, check connectivity and the corresponding credentials in `.env.local`.

For existing installations, apply `database/migrations/0004_playlist_metadata.sql` after 0003 for persistent playlist descriptions and covers. Schedule `pnpm covers:cleanup` regularly; see `database/README.md` for upload limits and cleanup behavior.
