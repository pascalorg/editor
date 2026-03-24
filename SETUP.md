# Pascal Editor - Setup Guide

> [!WARNING]
> Repository Drift Notice (2026-03-25)
>
> This document currently describes a Supabase and database setup that does not
> exist in the current `main` checkout.
>
> Verified facts in the current clone:
> - `packages/auth` is not present
> - `packages/db` is not present
> - `supabase/` is not present
> - root scripts such as `bun db:start` and `bun db:reset` are not present
>
> Practical impact:
> - the local editor UI can still run
> - Okiyuka JSON -> Pascal SceneGraph PoC can still run
> - the full local Supabase workflow below is stale for the current checkout
>
> For the current Okiyuka integration workflow, see:
> `C:\Okiyuka_V1.0\docs\pascal_editor_local_setup.md`

This guide describes the current local setup for the checkout that exists today.

## Current Checkout

Verified workspace structure:

```text
.
├── apps/
│   └── editor/               # Next.js shell app
├── packages/
│   ├── core/                 # Scene schemas, store, systems
│   ├── editor/               # Reusable editor package
│   ├── ui/                   # Shared UI primitives
│   └── viewer/               # Viewer package
└── turbo.json
```

Not present in the current checkout:

- `packages/auth`
- `packages/db`
- `supabase/`
- root scripts such as `bun db:start` and `bun db:reset`

## What Works Today

- local editor UI development
- local scene import/export using JSON scene graphs
- Okiyuka -> Pascal Editor proof-of-concept via JSON conversion

## What Does Not Work From This Checkout Alone

- full local Supabase stack
- local database migrations described by older docs
- auth/db package development described by older docs

## Prerequisites

- Node.js 18+ or Bun 1.3+
- Bun available on PATH

Optional:

- Docker Desktop, but only if a future checkout restores the missing Supabase files

## Local UI Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Create `apps/editor/.env.local`

The current app still validates these environment variables at startup:

```bash
POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
BETTER_AUTH_SECRET=replace_with_local_secret
BETTER_AUTH_URL=http://localhost:3002
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
```

These values are currently enough for local UI work even though the matching local Supabase project files are not present in this checkout.

### 3. Start The Development Server

```bash
bun dev
```

Current behaviour in this workspace:

- app URL: `http://127.0.0.1:3002`
- dev server is bound to localhost only

## Local Scene Import

Pascal Editor already accepts a local scene JSON with this shape:

```json
{
  "nodes": {},
  "rootNodeIds": []
}
```

Existing UI path:

1. Open Pascal Editor
2. Open `Settings`
3. Click `Load Build`
4. Select a Pascal scene JSON file

## Okiyuka Integration PoC

Use the converter in the Okiyuka repository:

```powershell
Set-Location -LiteralPath C:\Okiyuka_V1.0
c:/Okiyuka_V1.0/.venv/Scripts/python.exe tools/okiyuka_to_pascal_scene.py \
  --input artifacts/okiyuka_layout.json \
  --output artifacts/pascal_scene.json
```

Then load the converted file through Pascal Editor `Settings -> Load Build`.

Detailed workflow:

- [Okiyuka_V1.0/docs/pascal_editor_local_setup.md](../../Okiyuka_V1.0/docs/pascal_editor_local_setup.md)

## Why The Older Supabase Steps Are Stale

Historical setup steps in earlier revisions referenced:

- `packages/auth`
- `packages/db`
- `supabase/config.toml`
- `supabase/migrations/`

Those files and directories were removed from the current `main` history, so the old `bun db:start` and migration flow cannot be followed from this checkout alone.

## Troubleshooting

### Missing environment variables

The app validates environment values in `apps/editor/env.mjs`. If the editor fails on startup, verify that `apps/editor/.env.local` exists and contains the required keys.

### Bun is installed but not found

Restart the shell after installing Bun so the new PATH entry is picked up.

### Editor opens but external access is blocked

This workspace intentionally runs the editor on `127.0.0.1` only.

## Historical Note

If you need the older Supabase/auth/db workflow, use an earlier revision that still contains those directories, or restore them from history before following any database setup instructions.
