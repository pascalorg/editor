# Pascal MCP — Supabase Migrations

Numbered SQL files in `migrations/` set up (and later evolve) the Pascal
Supabase schema. Each file is idempotent where possible (`create ... if not
exists`, `create or replace function`) and should be applied in order.

Currently shipped:

| File                  | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `0001_scenes.sql`     | Creates `projects`, `scenes`, `scene_revisions` + RLS.  |

## Prerequisites

- A Supabase project (`Settings → Project Settings → API` gives you the URL
  and keys).
- The `service_role` key, stored as `SUPABASE_SERVICE_ROLE_KEY` on any
  process that runs `SupabaseSceneStore` (the MCP server, the Next.js API
  route). **Never expose this key to a browser.**

## Option 1 — Apply via Supabase CLI (recommended)

```sh
# One-time: link this repo to your Supabase project
supabase login
supabase link --project-ref <your-project-ref>

# Each migration — run once, in order
supabase db execute --file packages/mcp/sql/migrations/0001_scenes.sql
```

For a brand-new project you can also drop the files into
`supabase/migrations/` and use `supabase db push`, but the
`db execute --file` form works for any existing project without adopting the
CLI's migration tracking.

## Option 2 — Apply via the Supabase Dashboard

1. Open your project at <https://supabase.com/dashboard>.
2. `SQL Editor → New query`.
3. Paste the contents of `packages/mcp/sql/migrations/0001_scenes.sql`.
4. `Run`. You should see `Success. No rows returned.`

Re-running the file is safe; every statement is guarded with
`if not exists` / `create or replace`.

## Verifying the install

In the dashboard SQL editor:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('projects', 'scenes', 'scene_revisions')
order by table_name;
```

All three should be present. Check `Database → Policies` to confirm RLS is
enabled with the `scenes_owner_all`, `scenes_public_read`,
`revisions_owner_read`, and `projects_owner_all` policies.

## Environment variables consumed by the MCP server

| Variable                     | Required | Notes                                      |
| ---------------------------- | -------- | ------------------------------------------ |
| `SUPABASE_URL`               | yes      | `https://<ref>.supabase.co`                 |
| `SUPABASE_SERVICE_ROLE_KEY`  | yes      | Server-side only. Never log this value.     |

When both are set, `createSceneStore()` picks the Supabase backend; otherwise
it falls back to the filesystem store.
