# Pascal CLI

Run the open-source [Pascal 3D building editor](https://editor.pascal.app) locally
from your terminal—without cloning or building the Pascal repository.

[![npm version](https://img.shields.io/npm/v/@pascal-app/cli?label=npm)](https://www.npmjs.com/package/@pascal-app/cli)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![Pascal documentation](https://img.shields.io/badge/docs-editor.pascal.app-111111)](https://editor.pascal.app/docs/developers/local-editor)

```bash
npx @pascal-app/cli editor
```

On an interactive first run through `npx`, Pascal installs the same CLI version globally
after the editor becomes healthy. The shorter `pascal` command is therefore available
for `status`, `logs`, `stop`, and future sessions without another setup step. If the
global installation is unavailable because of local npm permissions, the editor remains
running and the CLI shows the equivalent `npx` commands plus the manual install command.

The first run walks through local storage, runtime installation, automatic editor and
MCP port selection, process startup, and both health checks with live terminal feedback.
It then opens `http://pascal.localhost:<port>`. Your projects are stored separately from
the runtime, so updating the CLI does not replace your work.

## Why use the CLI?

- Run a complete local Pascal editor with one command.
- Keep projects on your machine in a local SQLite database.
- Start and stop the editor independently from your terminal session.
- Inspect health, logs, versions, storage, and project state from scripts or agents.
- Connect Codex, Claude Code, Cursor, or another MCP client to the same local projects.
- Update through a health-checked activation that rolls back if the new runtime fails.

## Requirements

- Node.js 22.13 or newer
- npm, including when the CLI itself is launched with pnpm or Bun
- A browser, unless you pass `--no-open`

The initial supported release is macOS. The GitHub preview below also passed an
installed managed-service smoke in a Linux arm64 container. This is not an x86_64 or
Windows result.

## Candidate-enabled CLI preview

The npm `beta` tag currently resolves to `@pascal-app/cli@1.0.0-beta.1`, which predates the read-only furniture candidate input in this repository. To use that capability before the next npm release, install the verified GitHub prerelease built from commit `aa653f2f523f81f361ac20cb42b745faf7e46844`:

```bash
PASCAL_PREVIEW_VERSION='1.0.0-beta.1.agent-skills.0'
PASCAL_PREVIEW_PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/pascal-preview"
PASCAL_PREVIEW_DOWNLOAD="$(mktemp -d)"
cd "$PASCAL_PREVIEW_DOWNLOAD"

curl --fail --location --remote-name \
  "https://github.com/pascalorg/editor/releases/download/cli-v1.0.0-beta.1-agent-skills.0/pascal-app-cli-${PASCAL_PREVIEW_VERSION}.tgz"
curl --fail --location --remote-name \
  "https://github.com/pascalorg/editor/releases/download/cli-v1.0.0-beta.1-agent-skills.0/SHA256SUMS.txt"

# macOS
shasum -a 256 -c SHA256SUMS.txt
# Linux: use `sha256sum -c SHA256SUMS.txt` instead.

npm install --global --prefix "$PASCAL_PREVIEW_PREFIX" --ignore-scripts \
  "./pascal-app-cli-${PASCAL_PREVIEW_VERSION}.tgz"
export PATH="$PASCAL_PREVIEW_PREFIX/bin:$PATH"
pascal --version
pascal update --version "$PASCAL_PREVIEW_VERSION"
pascal editor --no-open
```

The expected archive SHA-256 is `814ffa8c6f6a5fced73bf909c616d9a78feff18fd61fd0b4b7d65e74fad5a33d`. The same-version `update` command installs and activates this CLI's bundled runtime, restarting an older running service when necessary. Keep an existing `PASCAL_HOME` unchanged so stored projects remain in the same data directory; `pascal editor` alone reuses any healthy service, including an older one. Keep the preview prefix on the agent host's `PATH` before running `pascal mcp setup claude`, `pascal mcp setup codex`, or configuring `pascal mcp connect` manually. This GitHub prerelease is not an npm version.

Use one active agent client per local CLI service. The standalone local HTTP runtime shares active scene state between clients; use separate `PASCAL_HOME` directories and service processes when independent concurrent work is required.

## Install and run

Use your preferred package runner:

```bash
# npm
npx @pascal-app/cli editor

# pnpm
pnpm dlx @pascal-app/cli editor

# Bun
bunx @pascal-app/cli editor
```

To install the `pascal` command before starting the editor:

```bash
npm install --global @pascal-app/cli
pascal editor
```

After the interactive `npx` first run or a global installation, `pascal status`,
`pascal logs --follow`, and the other commands work directly in the current terminal
and future sessions.

Use `--no-open` on a headless machine. Use `--foreground` when a process supervisor
should own the editor or when you want logs attached to the current terminal.
Pascal asks the operating system for an available loopback port by default, so it does
not compete with other local development servers. Pass `--port <n>` to request a
specific port; if it is occupied, Pascal reports that and safely selects another one.

```bash
npx @pascal-app/cli editor --no-open
npx @pascal-app/cli editor --foreground --no-open
```

## Commands

| Command | Purpose |
| --- | --- |
| `pascal editor` | Install if needed, ensure the editor is running, and open it. |
| `pascal start` | Ensure the editor is running without opening a browser. |
| `pascal stop [--force]` | Stop the managed editor and MCP processes; `--force` is a guarded recovery path. |
| `pascal restart` | Restart the editor and MCP service with their current configuration. |
| `pascal status [--json]` | Show editor and MCP health, version, PIDs, ports, URL, and runtime metadata. |
| `pascal open [project]` | Start Pascal if needed, then open the editor or a project by ID, ID prefix, or unique name. |
| `pascal resume [project]` | Open the latest project, or a selected project. |
| `pascal projects [--json]` | List local projects. |
| `pascal logs [--follow]` | Read or follow the managed editor log. |
| `pascal update [--version <version>]` | Health-check and activate the current CLI's bundled runtime or an npm-published target. |
| `pascal doctor [--json]` | Diagnose Node.js, storage, runtime, process, and plugin state. |
| `pascal info [--json]` | Print platform, paths, runtime, and plugin context. |
| `pascal project list [--json]` | Explicit form of `pascal projects`. |
| `pascal project open <id-or-name>` | Explicit form of `pascal open <project>`. |
| `pascal mcp connect` | Stable local connector for MCP clients; discovers the dynamic managed service. |
| `pascal mcp status [--json]` | Show managed MCP health. |
| `pascal mcp config [--json]` | Print generic MCP client configuration. |
| `pascal mcp setup <codex\|claude>` | Configure an installed client without overwriting existing entries. |
| `pascal plugin list [--json]` | Inspect the reserved managed-plugin lock. |

When you do not install globally, prefix commands with a runner—for example,
`npx @pascal-app/cli doctor`.

## Local data and security

Pascal binds the editor and MCP service only to `127.0.0.1` and uses the reserved
`.localhost` hostname. MCP requires a random token stored in Pascal's private runtime
directory; client configuration never contains that token.

```text
~/.pascal/
  runtime/<version>/           installed editor runtimes
  data/pascal.db               projects and scenes
  logs/editor.log              detached editor output
  run/editor.json              managed editor and MCP process identity
  run/mcp-token                private local MCP token
  plugins/                     reserved verified-plugin storage
  pascal.plugins.lock          reserved managed-plugin lock
```

Runtime installation, project data, process state, and logs have separate lifecycles.
The CLI does not include a command that deletes project data. Updates retain the
previous runtime for rollback, and `pascal doctor` warns when more than three versions
have accumulated.

## Local AI agents

The MCP server starts automatically with `pascal editor`. Add the stable connector to
your client once:

```bash
pascal mcp setup codex
pascal mcp setup claude
```

Or use `pascal mcp config` for JSON-based clients. The connector also starts Pascal
when an agent connects while it is stopped. Ask the agent to read
`pascal://agent-guide`, list or load a scene, edit it, and return the `editorUrl`.

## Plugins

The current CLI manages the local editor runtime; it does not yet download plugin code
from GitHub or npm. Follow the [plugin authoring guide](https://editor.pascal.app/docs/developers/plugins)
and the standalone [Nature plugin](https://github.com/pascalorg/plugin-trees) when
building an extension today.

Pascal also exposes a hosted Model Context Protocol endpoint for projects in a Pascal
account. See [Connect an AI agent](https://editor.pascal.app/docs/developers/mcp) for
the local and hosted workflows and the standalone `@pascal-app/mcp` package.

## Documentation and support

- [Complete CLI guide](https://editor.pascal.app/docs/developers/local-editor)
- [Plugin authoring guide](https://editor.pascal.app/docs/developers/plugins)
- [MCP and AI-agent guide](https://editor.pascal.app/docs/developers/mcp)
- [Open-source repository](https://github.com/pascalorg/editor)
- [Issues and feature requests](https://github.com/pascalorg/editor/issues)
- [Discord community](https://discord.gg/XRKsDcpqgS)

## License

MIT
