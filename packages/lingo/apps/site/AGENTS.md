<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# lingo site agent guide

Use Bun for this app. The dev server defaults to port `3000` and Next
auto-increments to the next free port when it's busy — read the actual port
from the dev output ("Local: http://localhost:XXXX") instead of assuming.

## Runtime Commands

- `bun dev` — start Next dev with `NEXT_DIST_DIR=.next-dev` (port 3000, or the
  next free port — Next prints which).
- `bun kill` — stop the listener on port 3000; pass the port if the server
  auto-incremented (`bun kill 3001`).
- `bun clean` — delete `.next`, `.next-dev`, and `.next-build`.
- `bun restart` — run `bun kill`, `bun clean`, then `bun dev`.
- `bun run typecheck` — run TypeScript through `tsgo` from `@typescript/native-preview`.
- `bun run build` — run `tsgo` typecheck, then the production Next build. Use `bun run`; plain `bun build` is Bun's bundler.
- `bun run start` — serve the production build (port 3000 by default).

If CSS is missing, stale, or inconsistent with the source, run `bun restart`
from `apps/site/` before changing layout code. Dev output lives in `.next-dev`
so it does not clobber `.next` production build output.

This app is a bun workspace member: the root `bun install` covers
it. It consumes `@pascal-app/lingo` as a live workspace link — after library
changes, `bun run build` in `packages/lingo` is enough (`bun run site:sync`
from the root also refreshes served data files like llms.txt). `bun dev` from
the repo root runs the library watcher and this dev server together.
