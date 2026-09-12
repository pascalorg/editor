# Pascal connection and credential setup

Source and public-documentation review date: 2026-09-10. Native task results are recorded separately with the evaluated source hash; source review alone does not prove every host or published runtime works.

Choose one path. Do not switch storage boundaries without the user's instruction.

## Local Pascal CLI

Use local mode when the project should remain on the current machine. It requires Node.js 22.13 or newer and does not require a Pascal account or API key.

Install the published CLI:

```bash
npm install --global @pascal-app/cli
pascal editor --no-open
```

The npm package keeps the MCP service inside it and downloads the roughly 64 MB web editor runtime only when a command starts the editor, so `pascal mcp connect` needs no runtime download: an agent-only host can list, load, and save local scenes without one. Run `pascal editor` when a person needs the visual editor, and add `--runtime <archive>` when the host has no network access.

The Claude Code plugin supplies this local connector automatically. Keep `pascal` on the `PATH` used to launch Claude Code; the plugin does not install or start the Pascal editor. Claude Code 2.1.258 loads both the user-scoped `pascal` server created by `pascal mcp setup claude` and the plugin-provided server. Remove the manual entry with `claude mcp remove --scope user pascal` before reloading or restarting Claude Code. Use `/mcp` to remove or disable other manual Pascal connections. Leaving both connections active violates the one-active-agent-client-per-local-service requirement. If the intended project is hosted, disable the plugin-provided local server in `/mcp` before configuring the hosted connection below.

Claude Code users who installed the skill without the plugin can run `pascal mcp setup claude`. Codex users can run `pascal mcp setup codex`. Run only the setup command for the active host. For another JSON-based MCP client, use:

```json
{
  "mcpServers": {
    "pascal": {
      "command": "pascal",
      "args": ["mcp", "connect"]
    }
  }
}
```

OpenClaw:

```bash
openclaw mcp add pascal \
  --command pascal \
  --arg mcp \
  --arg connect
openclaw mcp doctor pascal --probe
```

The stable connector discovers the managed loopback service and its private local token. Diagnose without exposing secrets:

```bash
pascal mcp status --json
pascal doctor --json
```

Local project data is stored under `~/.pascal/data/pascal.db` by default. Do not upload or synchronize it implicitly.

Use only one active agent client with each local CLI service. The standalone HTTP service shares active scene state across clients; do not run concurrent agents against that process. Separate processes need separate local data stores for independent work. The hosted endpoint below uses a different session-isolated bridge.

## Hosted Pascal for an existing user or organization

Use the hosted endpoint when the user wants the agent to work in a Pascal account or organization:

```text
https://editor.pascal.app/api/mcp
```

The user creates an API key in Pascal Settings (`https://editor.pascal.app/settings`) and chooses the intended personal or organization workspace. Set `PASCAL_API_KEY` to that key without printing it. If you assign it in a shell command, avoid or remove that command from shell history.

Codex CLI:

Replace `paste_key_here` with the API key before running this example.

```bash
export PASCAL_API_KEY="paste_key_here"
codex mcp add pascal \
  --url https://editor.pascal.app/api/mcp \
  --bearer-token-env-var PASCAL_API_KEY
```

Codex stores the environment-variable name, not its value. Set `PASCAL_API_KEY` again in each new terminal before starting Codex, or supply it through the user's existing shell or secret-manager configuration.

Run this command even when the Codex plugin is installed. The plugin's portable `mcp.json` follows Agent Plugins 1.0.0, which forbids credentials and placeholder expansion in `headers` and reserves `Authorization` for the client, so a plugin cannot carry a hosted key. The plugin therefore supplies only the local `pascal` server, and `codex mcp add` owns the hosted connection.

Claude Code:

Plugin users set the key once in the configuration prompt shown when `pascal-agent-skills@pascal` is enabled. To add or change it later, reinstall with `claude plugin install pascal-agent-skills@pascal --config pascal_api_key=<key>`, or open `/plugin` in a session and use its configure flow; there is no `claude plugin config` command. The hosted tools then load under the plugin's `pascal-hosted` server beside the local `pascal` server, and Claude Code keeps the key in the OS keychain, falling back to `~/.claude/.credentials.json`, rather than writing it into `settings.json` or any project file.

Without the plugin, register the hosted endpoint manually:

```bash
: "${PASCAL_API_KEY:?Set PASCAL_API_KEY to the apiKey returned by Pascal}" && \
claude mcp add --scope user --transport http pascal https://editor.pascal.app/api/mcp \
  --header "Authorization: Bearer $PASCAL_API_KEY"
```

The guard exits before changing Claude Code configuration when the variable is unset or empty. Claude Code expands the variable during registration and stores the static Authorization header, including the key, in its private user configuration. The connection is then available in all Claude Code projects for that user. Keep the configuration private; use `--scope local` instead when the connection should remain local to the current project.

OpenClaw:

```bash
: "${PASCAL_API_KEY:?Set PASCAL_API_KEY to a key from Pascal Settings}" && \
openclaw mcp add pascal \
  --url https://editor.pascal.app/api/mcp \
  --transport streamable-http \
  --header "Authorization=Bearer $PASCAL_API_KEY"
openclaw mcp doctor pascal --probe
```

The current OpenClaw static-header path stores the expanded key in its private MCP configuration and may warn about the literal credential during `doctor`. Do not commit or share that configuration. Remove the server with `openclaw mcp unset pascal` and rotate the Pascal key if the configuration is exposed. Skill installation alone does not configure this connection or authorize an account, upload, save, publication, or paid operation.

Cursor:

Installing this repository as a Cursor plugin declares an optional `PASCAL_API_KEY` variable. A team admin sets its value in the Cursor dashboard under **Plugins** → **Configure**, at install time or later; the repository holds only the `${PASCAL_API_KEY}` placeholder. With a value set, the plugin's `pascal-hosted` server reaches the hosted endpoint alongside the local `pascal` server. Leaving it unset keeps the install local-only: the local server still works and `pascal-hosted` fails with `401 Unauthorized` because the placeholder resolves to nothing. Disable `pascal-hosted` in Cursor's MCP settings to remove that failing entry.

For Cursor without the plugin, and for other JSON-based clients, prefer their supported environment-variable or secret interpolation rather than a literal key. In `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pascal": {
      "type": "http",
      "url": "https://editor.pascal.app/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:PASCAL_API_KEY}"
      }
    }
  }
}
```

Cursor resolves `${env:PASCAL_API_KEY}` from the environment it starts in, so the file holds no key and `PASCAL_API_KEY` must be exported where Cursor is launched. The two Cursor syntaxes are not interchangeable: `${env:NAME}` reads the environment in a user or project `.cursor/mcp.json`, while a plugin's `mcp.json` uses the bare `${NAME}` plugin-variable form resolved from the dashboard. Client interpolation syntax varies. Confirm that the chosen host supports this form before relying on it.

## Autonomous private work

Pascal exposes `POST https://editor.pascal.app/api/auth/agent/register` with:

```json
{
  "name": "required display name",
  "purpose": "optional task purpose",
  "agentClient": "claude-code"
}
```

Use it only after the current task authorizes creating a separate private agent-owned account. Capture the returned API key without printing it, store it with user-only permissions or in the host's secret store, and discard any temporary response containing the key. Never repeat the key in the final answer.

The response includes `userId`, `apiKey`, `starterProjectId`, `mcpEndpoint`, and `sceneApiUrl`. Preserve the canonical `agentId` when returned. It does not provide an agent email or browser session. The resulting projects belong to the separate agent account and will not appear in another user's workspace unless a later, explicit collaboration or handoff flow grants access.

## Connection recovery

- `401 Unauthorized`: verify the endpoint, the `Bearer` prefix, and whether the client sent the environment-backed secret. Rotate or revoke exposed keys.
- Project missing in the browser: verify that the credential belongs to the same user or organization that is opening the URL.
- Expired MCP session: reconnect, then call `get_project_status` with the project ID to bind the new session.
- Empty or stale browser: load the intended scene, inspect its state, call `get_project_status`, and use the returned URL. Save a draft only when the user authorized the underlying edit; a read-only assessment needs no save.
- Missing sampling support: image-to-scene tools cannot use host vision. Use semantic construction from user-supplied measurements or report the missing capability.

Current hosted instructions: `https://editor.pascal.app/docs/developers/mcp`.
