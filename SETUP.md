# Pascal Editor — Setup

## Prerequisites

- [Bun](https://bun.sh/) 1.3+ and Node.js 22.18+

## Quick Start

```bash
bun install
bun dev
```

The editor will be running at **http://localhost:3002**.

Environment is included as a pinned GitHub dependency, like the other bundled
plugins. Open **+ → Plugins → Environment** to manage its installation for the
current project, then open **Environment** in the sidebar. No separate plugin
checkout, local tarball, or synchronization script is needed.

## Environment Variables (optional)

Copy `.env.example` to `.env` if you need:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Dev server port (default: 3002) |
| `PASCAL_PUBLIC_URL` | No | The address people use to reach the editor. Read per request; set it when Pascal is hosted outside localhost (Mint sign-in and agent links use it). |
| `PASCAL_ADMIN_PASSWORD` | On a network host | The one password that unlocks a self-hosted editor. See "Self-hosting". |
| `PASCAL_AUTH` | No | `proxy` lets a reverse proxy that already authenticates every request replace the password. |
| `PASCAL_SCENE_API_TOKEN` | No | Bearer token for agents and scripts calling `/api/scenes`. |
| `PASCAL_DATA_DIR` | No | Directory holding `pascal.db` and artifacts (default: `~/.pascal/data`). |

Local development and the official hosted editor work without any environment variables.

## Self-hosting

The editor ships as one container, `ghcr.io/pascalorg/pascal-editor`, tagged with
the same version as the `@pascal-app/*` packages (`latest` follows stable releases,
`beta` the prereleases). It holds the same portable runtime the CLI installs.

```bash
PASCAL_ADMIN_PASSWORD=change-me PASCAL_PUBLIC_URL=https://pascal.example.com docker compose up -d
```

The editor is then at your public URL. Saved scenes live in the `pascal-data` volume
(`/data` in the container), so they survive `docker compose down` and image updates.
`docker compose build` rebuilds the image from your checkout instead of pulling it.

How it is protected, by `apps/editor/lib/self-host-auth.ts`:

- **One workspace behind one password.** `PASCAL_ADMIN_PASSWORD` gates every page and API
  behind `/login`. There is one account; everyone who signs in shares the scenes. Sessions
  are signed with a digest of the password, so changing it signs everyone out.
- **Agents use a bearer.** Set `PASCAL_SCENE_API_TOKEN` and send it as
  `Authorization: Bearer …` to `/api/scenes` and `/api/artifacts`; the settings page shows the
  endpoint under "Connect an agent".
- **Fail closed.** A host that is not loopback with no password set serves a setup page
  listing the variables and nothing else. `PASCAL_AUTH=proxy` opts out when a reverse proxy
  (basic auth, SSO) already authenticates every request.
- **Loopback stays open.** `bun dev`, the CLI's managed editor and `docker run` reached at
  `localhost` need no password. Opening a dev server to another device on your LAN counts
  as a network host: set `PASCAL_ADMIN_PASSWORD` in `.env.local` for that.

Nothing is fixed at build time: `PASCAL_PUBLIC_URL` and the port are read when a request
comes in, so one image serves any domain. `/api/health` answers without a session.

**Public embeds.** Nothing is public by default. The **Share** button in the editor's navbar
has a "Public link" switch: turning it on makes the project viewable, read-only, at
`/embed/<id>`, which needs no password and can be put in an `<iframe>` (the panel gives
the snippet). The page looks like the editor's Preview mode; `/embed/<id>?ui=0` (the
panel's "Hide controls" switch) shows only the 3D view, without the header, the toolbar
or the 3D/2D switcher. Turning the link off makes that URL a 404 again. Besides the embed page itself,
`/api/scenes/<id>/public` is the only unauthenticated read of scene data, and it answers
only for shared projects; the files a shared scene references are served to it as well.

## CLI-managed editor

Node.js 22.13 or newer can install a persistent local runtime, start it in the
background, and open it in the browser without a repository checkout:

```bash
npx @pascal-app/cli editor
```

The command starts the editor and its authenticated local MCP service together, downloading
the web editor runtime for that CLI version on the first run and verifying it against a
digest published in the npm package. Configure an agent to launch `pascal mcp connect`; for
example, run `pascal mcp setup codex`. That connector needs neither the editor process nor
the runtime download, and `--runtime <directory-or-archive>` covers an offline host.

Use `npx @pascal-app/cli doctor` to check the runtime, storage, editor, and MCP state. Saved
scenes live in `~/.pascal/data/pascal.db` independently from installed runtime versions.
The CLI retains old runtime versions for rollback and warns after more than three have
accumulated. It also replaces a damaged copy of the installed runtime on the next start;
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
