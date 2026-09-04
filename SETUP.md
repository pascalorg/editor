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
| `MINT_PASCAL_HOST_ORIGIN` | No | Public editor origin used by Mint sign-in and request checks. Set it for self-hosted deployments. |

Local development and the official hosted editor work without any environment variables.

## Docker — removed in this fork

Upstream ships a `Dockerfile` and `docker-compose.yml`. **They are deleted
here, on purpose.**

They declared a `/data` volume and stated that saved scenes live in SQLite
inside it, with no MySQL variable anywhere in either file. This fork runs on
MySQL and treats "scenes live in the database" as a hard requirement, so those
files described a second, contradictory way to install the product — one that
would have stored a customer's warehouses in a container volume, silently, and
looked entirely normal while doing it. Nobody deploys this fork with them
(production is Hostinger, built by `deploy-bundle`), so they were pure
opportunity for a future mistake.

If Docker is ever wanted here, it comes back carrying the MySQL configuration
and without the volume — not by restoring upstream's copy.

Deployment for this fork: `YAYINLAMA.md`.

## CLI-managed editor

Node.js 22.13 or newer can install a persistent local runtime, start it in the
background, and open it in the browser without a repository checkout:

```bash
npx @pascal-app/cli editor
```

The command starts the editor and its authenticated local MCP service together. Configure
an agent to launch `pascal mcp connect`; for example, run `pascal mcp setup codex`.

Use `npx @pascal-app/cli doctor` to check the runtime, storage, editor, and MCP state. Saved
scenes live in `~/.pascal/data/pascal.db` independently from installed runtime versions.
The CLI retains old runtime versions for rollback and warns after more than three have
accumulated. It also replaces a damaged copy of its bundled runtime on the next start;
neither operation modifies the data directory.
The complete command and storage reference is in [Run Pascal
locally](https://editor.pascal.app/docs/developers/local-editor).

## Monorepo Structure

```
├── apps/
│   └── editor/          # Next.js editor application
├── packages/
│   ├── core/            # @pascal-app/core — Scene schema, state, systems
│   ├── viewer/          # @pascal-app/viewer — 3D rendering
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
