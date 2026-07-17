# Pascal Editor — Local Setup

## Runtime topology

The current local application has three runtime layers:

| Layer | Default URL | Purpose |
|---|---|---|
| Pascal editor | `http://localhost:3002` | Next.js editor, scene APIs, and SSE |
| Pascal AI service | `http://localhost:8788` | AI chat API; starts Pascal MCP as a stdio child automatically |
| Reverse proxy | `http://localhost:8000` | Browser-facing home page and proxy to the editor |

Open **http://localhost:8000** for normal use. `pascal-reverse-front` is static content served by the reverse proxy and does not need a fourth process. The IFC converter on port 3003 is an optional standalone tool and is not part of this three-layer startup.

## Prerequisites

- [Bun](https://bun.sh/) 1.3+
- [.NET SDK](https://dotnet.microsoft.com/download) 10+

Node.js alone is not a complete replacement for Bun in this repository: the AI service and its MCP child use Bun runtime APIs.

Verify both commands before the first startup:

```bash
bun --version
dotnet --version
```

On macOS, if the runtimes are installed under the user home directory but the commands are not found, add them to the shell path (for example in `~/.zshrc`):

```bash
export PATH="$HOME/.bun/bin:$HOME/.dotnet:$PATH"
```

Do not use a temporary `npx bun` download for daily startup. It adds cold-start latency, and the AI service's MCP child expects `bun` to remain available on `PATH`.

## First-time setup

Run these once from the repository root:

```bash
bun install
dotnet restore pascal-reverse-proxy/pascal-reverse-proxy.csproj
```

Copy environment settings only when local overrides are needed:

```bash
cp .env.example .env
```

The editor and proxy can start without an AI key. The AI health endpoint then reports `configured: false`, and chat requests remain unavailable until a provider is configured. See [`pascal-ai-mcp/README.md`](./pascal-ai-mcp/README.md) for provider variables.

## Daily fast startup

Use three terminals. This avoids starting the optional IFC app and every package watcher on each run.

### Terminal 1 — editor

From the repository root:

```bash
bun run dev --filter=editor
```

This uses Turbo's cached dependency builds and starts the editor on port 3002.

### Terminal 2 — AI service and MCP child

```bash
cd pascal-ai-mcp
bun run dev
```

The AI service starts on port 8788 and launches Pascal MCP over stdio. Do not start a separate MCP process for the default configuration.

### Terminal 3 — reverse proxy and home page

From the repository root:

```bash
dotnet run --project pascal-reverse-proxy --no-restore
```

The reverse proxy starts on port 8000 and serves `pascal-reverse-front` itself.

### Verify all three layers

```bash
curl -I http://127.0.0.1:3002/
curl http://127.0.0.1:8788/health
curl http://127.0.0.1:8000/proxy/health
```

Expected results: editor HTTP 200, AI `"ok": true`, and proxy `"status": "ok"`.

## Faster warm-start options

Use these only when the stated code has not changed:

- Editor-only UI work, with no changes under `packages/`:

  ```bash
  cd apps/editor
  bun run dev
  ```

- Proxy unchanged since its last successful build:

  ```bash
  dotnet run --project pascal-reverse-proxy --no-build
  ```

The normal `--no-restore` proxy command is safer after source changes because it still performs an incremental build.

## When to use full monorepo development

Use the root command when actively editing shared packages or the optional IFC converter:

```bash
bun dev
```

This starts all workspace `dev` tasks, including package watchers, the editor, the IFC converter, and the AI service. It is intentionally slower and still does **not** start the .NET reverse proxy. Start the proxy separately if the browser-facing entry point is needed.

Do not run the daily three-terminal commands and `bun dev` together; they compete for ports 3002 and 8788.

## Common startup problems

### Port already in use

```bash
lsof -nP -iTCP:3002 -iTCP:8788 -iTCP:8000 -sTCP:LISTEN
```

Stop the old terminal process with `Ctrl+C` before starting another copy. An `EADDRINUSE` error means another process already owns that port.

### AI starts but chat fails

Check:

```bash
curl http://127.0.0.1:8788/health
```

- `configured: false` means the model provider variables are missing.
- If the AI log does not contain `[pascal-mcp] stdio server running`, check that Bun is installed and available on `PATH`.

### Proxy starts but the editor is unavailable

The proxy targets `http://127.0.0.1:3002/`. Start the editor first and verify port 3002 directly.

## Main commands

| Command | Description |
|---|---|
| `bun run dev --filter=editor` | Fast editor startup with cached dependency builds |
| `cd pascal-ai-mcp && bun run dev` | Start AI plus its MCP stdio child |
| `dotnet run --project pascal-reverse-proxy --no-restore` | Start the browser-facing proxy |
| `bun dev` | Start every workspace development task; slower |
| `bun build` | Build all workspace packages |
| `bun check` | Run Biome checks |
| `bun check-types` | Run TypeScript checks |

## Repository structure

```text
├── apps/
│   ├── editor/                 # Next.js editor, port 3002
│   └── ifc-converter/          # Optional standalone app, port 3003
├── packages/                   # Shared core/viewer/editor/nodes/MCP packages
├── pascal-ai-mcp/              # AI HTTP service; starts MCP child, port 8788
├── pascal-reverse-front/       # Static home page served by the proxy
└── pascal-reverse-proxy/       # .NET/YARP browser entry, port 8000
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution guidelines.
