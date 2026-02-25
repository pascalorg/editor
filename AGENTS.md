# Pascal Editor

A 3D building editor monorepo (Turborepo + Bun) with a Next.js 16 app, shared `@pascal-app/core` and `@pascal-app/viewer` packages, and a Supabase-backed database layer.

## Cursor Cloud specific instructions

### Services overview

| Service | Port | Purpose |
|---------|------|---------|
| Next.js dev server | 3000 | Main editor app (`bun dev` from root) |
| Supabase local stack | 55321-55328 | PostgreSQL, Auth, Storage, Studio, Mailpit |

### Starting the dev environment

1. **Docker must be running** before Supabase can start. In this cloud environment, start it with `sudo dockerd &>/tmp/dockerd.log &` then `sudo chmod 666 /var/run/docker.sock`.
2. **Start Supabase**: `bun db:start` — pulls containers on first run, applies all SQL migrations automatically, and outputs connection keys.
3. **Create `.env`** at repo root (not `apps/editor/.env.local` — the editor forbids that). Required vars:
   - `POSTGRES_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from `bunx supabase status -o env`
   - `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`
   - `BETTER_AUTH_URL` — set to the local dev server origin (e.g. port 3000)
4. **Start dev**: `bun dev` — builds `core` and `viewer` packages first (via Turbo `^build` dependency), then starts Next.js with file watchers for all packages.

### Key caveats

- The root `bun dev` script sources `.env` from root via `set -a && . ./.env`. Environment variables are **not** read from `apps/editor/.env.local`.
- `@pascal-app/core` and `@pascal-app/viewer` must be built before type-checking the editor. `bun dev` handles this automatically, but standalone `bun run check-types` requires a prior `bun run build` or the `dist/` outputs won't exist.
- Supabase containers can take 1-2 minutes to start on first run (image pulls). Subsequent starts are fast.
- The editor creates Supabase Storage buckets (`avatars`, `project-thumbnails`) automatically on startup.
- Projects can be created locally without authentication — useful for quick testing.

### Lint / Format / Type-check

See root `package.json` scripts. Key commands:
- `bun lint` — Biome lint
- `bun format:check` / `bun format` — Biome format
- `bun check` / `bun check:fix` — Biome check (lint + format)
- `bun run check-types` — TypeScript type checking (requires built packages)
- `bun run build` — Full production build
