# Pascal CLI

Run the open-source [Pascal 3D building editor](https://editor.pascal.app) locally
from your terminal—without cloning or building the Pascal repository.

[![npm version](https://img.shields.io/npm/v/@pascal-app/cli?label=npm)](https://www.npmjs.com/package/@pascal-app/cli)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![Pascal documentation](https://img.shields.io/badge/docs-editor.pascal.app-111111)](https://editor.pascal.app/docs/developers/local-editor)

```bash
npx @pascal-app/cli editor
```

The first run walks through local storage, runtime installation, automatic port
selection, process startup, and a health check with live terminal feedback. It then
opens `http://pascal.localhost:<port>`. Your projects are stored separately from the
runtime, so updating the CLI does not replace your work.

## Why use the CLI?

- Run a complete local Pascal editor with one command.
- Keep projects on your machine in a local SQLite database.
- Start and stop the editor independently from your terminal session.
- Inspect health, logs, versions, storage, and project state from scripts or agents.
- Update through a health-checked activation that rolls back if the new runtime fails.

## Requirements

- Node.js 22.13 or newer
- npm, including when the CLI itself is launched with pnpm or Bun
- A browser, unless you pass `--no-open`

The initial supported release is macOS. The packed runtime also passes automated
release smoke tests on Ubuntu; broader Linux and Windows support is still being
verified.

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

Or install the `pascal` command globally:

```bash
npm install --global @pascal-app/cli
pascal editor
```

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
| `pascal stop [--force]` | Stop the managed process; `--force` is a guarded recovery path. |
| `pascal restart` | Restart the editor with its current configuration. |
| `pascal status [--json]` | Show health, version, PID, URL, and runtime metadata. |
| `pascal open` | Open the running editor in your default browser. |
| `pascal logs [--follow]` | Read or follow the managed editor log. |
| `pascal update [--version <version>]` | Health-check and activate a published runtime. |
| `pascal doctor [--json]` | Diagnose Node.js, storage, runtime, process, and plugin state. |
| `pascal info [--json]` | Print platform, paths, runtime, and plugin context. |
| `pascal project list [--json]` | List projects in the running local editor. |
| `pascal project open <id>` | Open a local project in your browser. |
| `pascal plugin list [--json]` | Inspect the reserved managed-plugin lock. |

When you do not install globally, prefix commands with a runner—for example,
`npx @pascal-app/cli doctor`.

## Local data and security

Pascal binds only to `127.0.0.1` and uses the reserved `.localhost` hostname. The
initial CLI does not expose an unauthenticated editor to your network.

```text
~/.pascal/
  runtime/<version>/           installed editor runtimes
  data/pascal.db               projects and scenes
  logs/editor.log              detached editor output
  run/editor.json              managed process identity
  plugins/                     reserved verified-plugin storage
  pascal.plugins.lock          reserved managed-plugin lock
```

Runtime installation, project data, process state, and logs have separate lifecycles.
The CLI does not include a command that deletes project data. Updates retain the
previous runtime for rollback, and `pascal doctor` warns when more than three versions
have accumulated.

## Plugins and AI agents

The current CLI manages the local editor runtime; it does not yet download plugin code
from GitHub or npm. Follow the [plugin authoring guide](https://editor.pascal.app/docs/developers/plugins)
and the standalone [Nature plugin](https://github.com/pascalorg/plugin-trees) when
building an extension today.

Pascal also exposes a hosted Model Context Protocol endpoint for Claude Code, Codex,
Cursor, OpenClaw, and other MCP clients. See [Connect an AI agent](https://editor.pascal.app/docs/developers/mcp)
for the hosted setup and the relationship between hosted projects, the local editor,
and `@pascal-app/mcp`.

## Documentation and support

- [Complete CLI guide](https://editor.pascal.app/docs/developers/local-editor)
- [Plugin authoring guide](https://editor.pascal.app/docs/developers/plugins)
- [MCP and AI-agent guide](https://editor.pascal.app/docs/developers/mcp)
- [Open-source repository](https://github.com/pascalorg/editor)
- [Issues and feature requests](https://github.com/pascalorg/editor/issues)
- [Discord community](https://discord.gg/XRKsDcpqgS)

## License

MIT
