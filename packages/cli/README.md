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

The first run walks through local storage, the one-time web runtime download, automatic
editor and MCP port selection, process startup, and both health checks with live terminal
feedback. It then opens `http://pascal.localhost:<port>`. Your projects are stored
separately from the runtime, so updating the CLI does not replace your work.

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
- Network access the first time you start the editor, or a local copy of the web runtime
  archive (see [The web editor runtime](#the-web-editor-runtime)); `pascal mcp connect`
  needs neither

The initial supported release is macOS. A clean claim-command installation also passed in
a Linux arm64 container. This is not an x86_64 or Windows result.

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

## The web editor runtime

The npm package carries the CLI and the MCP service only: about 1.7 MiB compressed and
8.5 MiB installed. The web editor itself—the Next.js server, its static assets, and the
bundled item and plugin libraries—is published as one archive per CLI version.
With Bath Space, Landscape, Pool, Streetscape and WebXR included, the current archive
is about 126 MiB compressed, down from 184 MiB. Bath Space catalog thumbnails fit
within 512 × 512 pixels; all catalog entries, offline models and material textures
remain included. The runtime is downloaded once per version, outside the npm package.

`stage-runtime` reports the compressed size and the static-media breakdown. The packed
runtime smoke check enforces a 140 MiB release ceiling and verifies every bundled
WebP image and GLB model through the installed editor's HTTP server. A package revision
update should include this size report so media growth is visible in review.

Every command that starts the editor (`editor`, `start`, `open`, `resume`, `projects`,
`project open`, `update`) resolves that runtime in this order:
1. `PASCAL_BUNDLED_RUNTIME_DIR`, an already-extracted runtime directory.
2. `--runtime <directory-or-archive>`, which every one of those commands accepts.
3. The runtime already installed in `~/.pascal/runtime/<version>` for this CLI version.
4. The release asset recorded in the package, streamed into `~/.pascal/tmp` with download
   progress in the terminal.

Each CLI version pins its own runtime version, so upgrading the CLI switches the editor to
the matching runtime the next time it starts. If the editor is already running on an older
runtime, `pascal editor` says so; `pascal restart` (or `pascal update`) makes the switch.
`pascal doctor` reports the installed and the pinned runtime version when they differ.

A downloaded archive is checked against the SHA-256 digest published inside the npm
package before anything is extracted. On a mismatch the CLI deletes the temporary file and
installs nothing, so a corrupted or substituted archive never becomes your runtime.
Concurrent first runs share one download through the runtime install lock.

An offline or air-gapped machine can take the archive from the release page:

```bash
# On a connected machine
curl --fail --location --remote-name \
  "https://github.com/pascalorg/editor/releases/download/@pascal-app/cli@<version>/pascal-web-runtime-<version>.tar.gz"

# On the target machine
pascal editor --runtime ./pascal-web-runtime-<version>.tar.gz
```

An archive passed with `--runtime` is digest-verified exactly like a download. A directory
is installed as it is, which is the escape hatch for a runtime you built yourself from this
repository.

`HTTPS_PROXY` (or `ALL_PROXY`), including a proxy that requires basic authentication, and
`NO_PROXY` are honoured; only `https://` URLs are accepted. When a download fails, the CLI
prints the archive URL, the expected digest, and the `--runtime` command to run after
copying the file across.

Agent tools need none of this. `pascal mcp connect` starts the MCP service that ships in
the npm package, so an agent can read and write local projects on a machine that has never
downloaded the web runtime.

## Commands

| Command                                                  | Purpose                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pascal editor [--runtime <path>]`                       | Install the web runtime if needed, ensure the editor is running, and open it.                   |
| `pascal start [--runtime <path>]`                        | Ensure the editor is running without opening a browser.                                         |
| `pascal stop [--force]`                                  | Stop the managed editor and MCP processes; `--force` is a guarded recovery path.                |
| `pascal restart`                                         | Restart the editor and MCP service with their current configuration.                            |
| `pascal status [--json]`                                 | Show editor and MCP health, version, PIDs, ports, URL, and runtime metadata.                    |
| `pascal open [project]`                                  | Start Pascal if needed, then open the editor or a project by ID, ID prefix, or unique name.     |
| `pascal resume [project]`                                | Open the latest project, or a selected project.                                                 |
| `pascal projects [--json]`                               | List local projects.                                                                            |
| `pascal logs [--follow]`                                 | Read or follow the managed editor log.                                                          |
| `pascal update [--version <version>] [--runtime <path>]` | Health-check and activate the runtime this CLI publishes, or an npm-published target.           |
| `pascal doctor [--json]`                                 | Diagnose Node.js, storage, runtime, process, and plugin state.                                  |
| `pascal info [--json]`                                   | Print platform, paths, runtime, and plugin context.                                             |
| `pascal project list [--json]`                           | Explicit form of `pascal projects`.                                                             |
| `pascal project open <id-or-name>`                       | Explicit form of `pascal open <project>`.                                                       |
| `pascal agent claim [--no-open] [--json]`                | Link an autonomous hosted agent to the person accountable for it.                               |
| `pascal agent status [--json]`                           | Verify the hosted agent credential and inspect its claim and organization scope.                |
| `pascal architect run "<brief>"`                         | Start a hosted architect run from a brief and stream its output.                                |
| `pascal architect status <id> [--json]`                  | Show a hosted architect run's status and output.                                                |
| `pascal architect cancel <id> [--json]`                  | Cancel a queued or running hosted architect run.                                                |
| `pascal mcp connect`                                     | Stable local connector for MCP clients; starts the bundled MCP service without the web runtime. |
| `pascal mcp status [--json]`                             | Show managed MCP health.                                                                        |
| `pascal mcp config [--json]`                             | Print generic MCP client configuration.                                                         |
| `pascal mcp setup <codex\|claude>`                       | Configure an installed client without overwriting existing entries.                             |
| `pascal plugin list [--json]`                            | Inspect the reserved managed-plugin lock.                                                       |

When you do not install globally, prefix commands with a runner—for example,
`npx @pascal-app/cli doctor`.

## Local data and security

Pascal binds the editor and MCP service only to `127.0.0.1` and uses the reserved
`.localhost` hostname. MCP requires a random token stored in Pascal's private runtime
directory; client configuration never contains that token.

```text
~/.pascal/
  runtime/<version>/           installed web editor runtimes
  data/pascal.db               projects and scenes
  logs/editor.log              detached editor and MCP output
  run/editor.json              managed editor process identity
  run/mcp.json                 managed MCP service identity
  run/mcp-token                private local MCP token
  tmp/                         runtime downloads in progress
  plugins/                     reserved verified-plugin storage
  pascal.plugins.lock          reserved managed-plugin lock
```

Runtime installation, project data, process state, and logs have separate lifecycles.
The CLI does not include a command that deletes project data. Updates retain the
previous runtime for rollback, and `pascal doctor` warns when more than three versions
have accumulated.

## Local AI agents

The MCP service ships in the npm package. It starts automatically with `pascal editor`, and
`pascal mcp connect` starts it on its own—no web runtime download, no editor process. Add
the stable connector to your client once:

```bash
pascal mcp setup codex
pascal mcp setup claude
```

Or use `pascal mcp config` for JSON-based clients. Ask the agent to read
`pascal://agent-guide`, list or load a scene, edit it, and return the `editorUrl`. Those
`editorUrl` values point at the local editor; run `pascal editor` to open one, which is
also when the web runtime is downloaded.

## Hosted autonomous agents

An autonomous agent registered with hosted Pascal receives its own API key and identity. The
agent can create a short-lived claim code so the person working with it can establish the
accountability link:

```bash
PASCAL_API_KEY='sk_live_...' pascal agent claim
PASCAL_API_KEY='sk_live_...' pascal agent status
```

The CLI sends that key once to Pascal's claim endpoint, does not store or print it, and opens
the claim page. Use `--no-open` on a headless host. `--json` returns structured output without
opening a browser. A new claim request supersedes the agent's previous code; each code expires
after 15 minutes.

`pascal agent status` confirms that the credential remains active and reports the agent ID,
autonomous or delegated mode, claim state, and whether the key is scoped to an organization.
It does not expose the accountable person's identity or inspect local editor projects.

Claiming lifts claim-gated capabilities for the autonomous agent. It does not transfer project
ownership, grant the agent access to the person's private projects, or grant the person access
to the agent's private projects. The local editor and its projects remain local unless a
separate hosted project action explicitly moves data.

## Hosted architect runs

The `pascal architect` commands ship in the next `@pascal-app/cli` release after 1.0.5;
1.0.5 and earlier do not include them.

You hand Pascal's hosted architect a brief, and it designs the building on Pascal while you
watch, detach, or come back later. You need an agent API key in `PASCAL_API_KEY`, the same
key `pascal agent status` checks. The CLI sends it to Pascal and never stores or prints it.

Start a run and stream its output:

```bash
PASCAL_API_KEY='sk_live_...' pascal architect run "A two-storey, three-bedroom house with an open-plan kitchen"
```

The design text streams to stdout and progress lines go to stderr, so you can pipe or
redirect the output. The run executes in the background on Pascal: when you press Ctrl+C you
detach, and the run keeps going. The CLI prints the run ID when it starts.

| Flag                              | Effect                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `--effort low\|medium\|high\|pro` | Use the `architect-<effort>` model. Without it, the run uses `architect`.           |
| `--project <id>`                  | Run in a hosted Pascal project; sent as `metadata.project_id`.                      |
| `--max-credits <n>`               | Cap the credits this run may spend; sent as `metadata.pascal_max_credits`.          |
| `--detach`                        | Queue the run, print its ID, and return without streaming.                          |
| `--json`                          | Print the run as JSON; waits for the run to finish unless you also pass `--detach`. |

Check on a run, including one you detached from:

```bash
PASCAL_API_KEY='sk_live_...' pascal architect status resp_abc123
```

You get the status (`queued`, `in progress`, `completed`, `failed`, `cancelled`, or
`incomplete`), the model, project, credit cap, and the output so far. `--json` returns the
same fields as a stable object with `schemaVersion: 1`.

Stop a run you no longer need:

```bash
PASCAL_API_KEY='sk_live_...' pascal architect cancel resp_abc123
```

When something goes wrong, the CLI tells you whether retrying can help. Exit code `75` means
Pascal is temporarily unable to take the request: `architect_executor_unavailable` (no
architect executor is free, so no run started), `architect_rate_limited`, or
`architect_unavailable`. Retry the same command later. `architect_unauthorized` and
`architect_forbidden` mean the key is invalid, revoked, or not allowed to use the architect;
check it with `pascal agent status`. `architect run` exits `1` when the run ends in any state
other than `completed`, `2` on invalid usage, and `130` when you detach with Ctrl+C. With
`--json`, errors go to stderr as `{ "error": "<code>", "message": "...", "details": { ... } }`.

The commands are a thin client over Pascal's OpenAI-compatible Responses API at
`https://editor.pascal.app/api/v1/responses`, using background mode.

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
