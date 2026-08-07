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

## Docker

```bash
docker compose up -d
```

The editor will be running at **http://localhost:3000**. Saved scenes live in
the `pascal-data` volume, so they survive `docker compose down`.

Docker defaults `MINT_PASCAL_HOST_ORIGIN` to `http://localhost:3000`. Override
it when hosting Pascal at another origin:

```bash
MINT_PASCAL_HOST_ORIGIN=https://pascal.example.com docker compose up -d
```

Keep the container port at 3000: the `/scenes` page fetches its own API through
a base URL that only `NEXT_PUBLIC_APP_URL` can override, and Next inlines that
value at build time, so remapping the port to something else makes the page
return 500.

## CLI-managed editor

Node.js 22.13 or newer can install a persistent local runtime, start it in the
background, and open it in the browser without a repository checkout:

```bash
npx @pascal-app/cli editor
```

Use `npx @pascal-app/cli doctor` to check the runtime, storage, and process state. Saved
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
