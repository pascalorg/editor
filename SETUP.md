# Pascal Editor — Setup

## Prerequisites

- [Bun](https://bun.sh/) 1.3+ and Node.js 20.9+

## Quick Start

```bash
bun install
bun dev
```

The editor will be running at **http://localhost:3002**.

## Environment Variables (optional)

Copy `.env.example` to `.env` if you need:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Dev server port (default: 3002) |
| `PASCAL_SHARE_LINK_SECRET` | For sharing | Signs view-only share links (`/share/<token>`). Without it the **Share** button returns 503 and existing links stop verifying — everything else works. Changing it invalidates every link already handed out, which is also the only way to revoke one. |
| `POSTGRES_URL` | For the Postgres store | Connection string for `packages/db`. Unset, the editor keeps using the local SQLite store. |
| `POSTGRES_POOL_SIZE` | No | Per-replica connection pool size (default 10). `replicas × this` must stay under Postgres' `max_connections`. |
| `BETTER_AUTH_SECRET` | For auth | A random string used to sign session cookies. |
| `GOOGLE_CLIENT_ID` | For auth | Google OAuth Client ID. |
| `GOOGLE_CLIENT_SECRET` | For auth | Google OAuth Client Secret. |
| `RESEND_API_KEY` | For auth | API key for the transactional email Resend sends (magic link, email verification, password reset, welcome). Unset in dev, the messages are printed to the terminal instead — the magic link is clickable from there. Unset in production, the flows that need mail report a configuration error rather than claiming to have sent something. |
| `EMAIL_FROM` | For auth | RFC 5322 sender for that mail, e.g. `Menart 3D <hesap@menart3d.com>`. Defaults to Resend's shared `onboarding@resend.dev`, which only delivers to the account owner. |
| `NEXT_PUBLIC_APP_URL` | For auth | The base URL of the app (default: `http://localhost:3002`). |

Scene quotas are tiered (guest vs verified account) and env-configurable; each
of the six `PASCAL_QUOTA_{GUEST,FREE}_{MAX_SCENES,MAX_TOTAL_BYTES,MAX_SCENE_BYTES}`
variables overrides one default (`apps/editor/lib/scene-quota.ts` lists the
defaults — 2 scenes / 20 MB for guests, 25 scenes / 500 MB for verified users).

Local development and the official hosted editor work without any environment variables.

## Authentication (Google OAuth)

To enable Google sign-in locally, you must create an OAuth 2.0 Client ID in the Google Cloud Console and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Ensure the following **Authorized redirect URIs** are configured in your Google Cloud Console:
- Local: `http://localhost:3002/api/auth/callback/google`
- Production: `https://your-production-domain.com/api/auth/callback/google`

## Postgres (optional, for cloud work)

The default store is SQLite at `~/.pascal/data/pascal.db` — nothing to set up.
To work on the Postgres data layer (`packages/db`):

```bash
docker compose up -d postgres
cd packages/db && bun run db:migrate
```

That brings Postgres up on **port 5433** (5432 is usually taken by a system
install, and connecting to the wrong one fails as "password authentication
failed", which sends you looking at credentials instead of at the host) and
applies the committed migrations.

Migrations are a deploy step, never app boot: several replicas starting
together would all race to migrate.

To move scenes from an existing SQLite file into Postgres (the one-shot
migration tool, `packages/mcp/src/bin/pascal-migrate.ts`):

```bash
bunx pascal-migrate \
  --from ~/.pascal/data/pascal.db \
  --to "$POSTGRES_URL" \
  --owner <userId> \
  --dry-run          # print the plan first; drop this flag to actually write
```

`--owner` stamps an owner on scenes that have none (early dev data predates
accounts); scenes that already have an owner keep it. The run is idempotent —
scenes the target already has are skipped — so a half-finished run can be
restarted, and `--overwrite` re-saves them instead.

## Docker

```bash
docker compose up -d
```

The editor will be running at **http://localhost:3000**. Saved scenes live in
the `pascal-data` volume, so they survive `docker compose down`.

## Monorepo Structure

```
├── apps/
│   └── editor/          # Next.js editor application
├── packages/
│   ├── core/            # @pascal-app/core — Scene schema, state, systems
│   ├── viewer/          # @pascal-app/viewer — 3D rendering
│   ├── db/              # @pascal-app/db — Postgres data layer (Drizzle)
│   └── ui/              # Shared UI components
└── tooling/             # Build & release tooling
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun dev` | Start the development server |
| `bun build` | Build all packages |
| `bun check` | Lint and format check (Biome) |
| `bun check:fix` | Auto-fix lint and format issues |
| `bun check-types` | TypeScript type checking |
| `bun run test` | Run every package's test suite |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on submitting PRs and reporting issues.
