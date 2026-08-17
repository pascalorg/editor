# `@pascal-app/db`

Postgres data layer (Drizzle ORM). Private workspace package — never published.

Server-safe by rule: no React, no Three.js, no `next/*`, no `'use client'`. It
runs in API routes, Server Components, the migration step and the MCP process,
so a client import here lands in all four. `tests/server-safe.test.ts` enforces
this.

## Local development

```sh
docker compose up -d postgres        # host port 5433
cd packages/db && bun run db:migrate
```

Port 5433 rather than 5432 on purpose: a system Postgres usually holds 5432,
and connecting to the wrong server fails as "password authentication failed",
which points at credentials instead of at the host.

## Scripts

| Script | What it does |
|---|---|
| `bun run db:generate` | Diffs the schema and writes a new SQL file into `migrations/` |
| `bun run db:migrate` | Applies pending migrations. **A deploy step, not app boot** |
| `bun run db:studio` | Drizzle Studio against `POSTGRES_URL` |

Migrations are committed, so the SQL that runs in production is the SQL that
was reviewed. Never apply them on app start: N replicas booting together all
race to migrate, and the loser either crashes or serves traffic against a
half-migrated schema.

## Schema

| Area | Tables |
|---|---|
| Identity (better-auth) | `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications` |
| Tenancy | `projects`, `project_members` |
| Scenes | `scenes` (metadata + `head_version`), `scene_versions` (graph body) |
| Change feed | `scene_events`, `agent_requests` |
| Access | `api_tokens`, `share_links` |

Field names track `sqlite-scene-store.ts` (`version`, `size_bytes`,
`node_count`, `graph_hash`) so one `SceneStore` contract covers both backends
while the migration runs. Two deliberate departures, both explained in
`src/schema/scenes.ts`: the graph body lives in `scene_versions` rather than on
the metadata row every listing reads, and `graph_hash` is stored rather than
recomputed on read — `jsonb` normalises key order, so a hash computed after a
round trip would not match the one the client saw.

## Connection pooling

`replicas × poolSize` has to stay under Postgres' `max_connections`. Production
puts PgBouncer in front in transaction pooling mode, which is why the client
sets `prepare: false` — a transaction pooler hands each statement a different
backend, so a prepared statement from an earlier one is not there.

`POSTGRES_POOL_SIZE` sets the per-replica pool (default 10).
