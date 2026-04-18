# R5 — Backend / Supabase

## TL;DR
**Infrastructure declared, ZERO backend code.** `env.mjs` lists Supabase + Postgres + BetterAuth + Resend secrets as REQUIRED, the privacy policy claims scene data is stored in Supabase, `turbo.json` invalidates cache on those secrets — but the repo contains **no Supabase client, no schema, no migrations, no scene CRUD API**.

## Evidence

### Declared infra
- `apps/editor/env.mjs:18–19` — `POSTGRES_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, `.min(1)`)
- `env.mjs:12–14` — `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_*`
- `env.mjs:27–31` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `turbo.json:9–20` — same vars listed as build-cache keys
- `apps/editor/app/privacy/page.tsx:95–97` — "Your data is stored using Supabase (PostgreSQL database)"
- `.gitignore:22–24` — references `supabase/.branches/`, `supabase/.temp/` dirs (not present)

### What's absent
- Zero `createClient(` / `import.*supabase` matches across `apps/editor/**` and `packages/**`
- Zero `.sql` schema files
- Zero `drizzle/` / `prisma/` / `migrations/` directories
- Zero server actions (`'use server'` grep returns nothing)
- Zero API routes other than `/api/health` (returns `{ status: 'ok' }`)

## API surface today
| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/health` | GET | Liveness | none |

## Required to enable MCP → cloud scene
1. Provision a Supabase project (or alternative Postgres).
2. Schema: `projects`, `scenes` (id, project_id, name, data jsonb, version, thumbnail_url, created_at, updated_at, owner_id), `scene_versions` (for history).
3. Supabase client singletons:
   - `apps/editor/lib/supabase-browser.ts` (uses `ANON_KEY`)
   - `apps/editor/lib/supabase-server.ts` (uses `SERVICE_ROLE_KEY` in server components / API routes)
4. Auth via BetterAuth + Google OAuth (env is there, unused).
5. API routes: `POST/GET/PUT/DELETE /api/projects/[id]/scenes/[sceneId]`.
6. RLS policies: scene rows readable only by owner + collaborators.
7. `SceneBridge` in MCP gets optional `persistenceAdapter: SupabaseAdapter` — replaces the in-memory store with a writeback to Supabase.

## Verdict
Groundwork is in place (env vars, privacy policy, turbo cache keys) but **every line of actual backend code is missing**. This is a greenfield opportunity: the team clearly planned for Supabase but hasn't implemented it yet.
