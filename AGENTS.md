<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

Reference the PLAN.md file when creating the app

## Rules

Do not make the application in a single file, try to break it down into components

## Scope and Planning

- Use PLAN.md as the implementation roadmap.
- Keep changes focused on the requested task.
- Ask before adding major features or changing the music source.

## Package Management

- Use pnpm and preserve pnpm-lock.yaml.
- Prefer existing components and dependencies before adding packages.
- Explain why a new dependency is necessary.

## Architecture

- Keep server-only code out of client components.
- Use client components for playback controls and browser APIs.
- Keep one shared audio player mounted across navigation.
- Separate playback state from catalog and user library data.
- Reuse components/ui primitives and existing theme styles.

## Playback and Streaming

- Preserve playback when navigating between pages.
- Handle buffering, playback failures, unavailable tracks, and empty queues.
- Verify seeking and duration reporting with the actual audio source.
- Validate route inputs before passing them to external processes.
- Give subprocesses timeouts and clean them up on cancellation.
- Never construct shell commands from user input.

## Configuration and Data

- Keep secrets in environment variables; never expose them through
  NEXT_PUBLIC_ variables or commit them.
- Document required variable names in .env.example without real values.
- Avoid hardcoded localhost URLs in application code.
- Keep sample catalog data separate from production integrations.

## Validation

- Run pnpm lint, pnpm typecheck, and pnpm build after code changes.
- Report checks that fail or could not run.
- Add meaningful tests for queue behavior and playlist operations.
- Check responsive layouts and keyboard access for UI changes.
