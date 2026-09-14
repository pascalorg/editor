# Connect Pascal for a furniture-fit assessment

Source and public-documentation review date: 2026-09-10. Native task results are recorded separately with the evaluated source hash; source review alone does not prove every host or published runtime works.

## Local project

Use the local path when the project should remain on the machine:

```bash
npm install --global @pascal-app/cli
pascal editor --no-open
```

The npm package keeps the MCP service inside it and downloads the roughly 64 MB web editor runtime only when a command starts the editor, so `pascal mcp connect` needs no runtime download: an agent-only host can list, load, and save local scenes without one. Run `pascal editor` when a person needs the visual editor, and add `--runtime <archive>` when the host has no network access.

The Claude Code plugin supplies `pascal mcp connect` automatically. Keep `pascal` on the `PATH` used to launch Claude Code; the plugin does not install or start the Pascal editor. Claude Code 2.1.258 loads both the user-scoped `pascal` server created by `pascal mcp setup claude` and the plugin-provided server. Remove the manual entry with `claude mcp remove --scope user pascal` before reloading or restarting Claude Code. Use `/mcp` to remove or disable other manual Pascal connections. Leaving both connections active violates the one-active-agent-client-per-local-service requirement. If the intended project is hosted, disable the plugin-provided local server in `/mcp` before configuring the hosted connection below.

Claude Code users who installed the skill without the plugin can run `pascal mcp setup claude`. Codex users can run `pascal mcp setup codex`. Run only the setup command for the active host. Local use needs no hosted account and does not upload projects automatically. If the connected MCP schema lacks `check_collisions.candidate`, report the narrower supported result rather than implying the candidate was tested.

For OpenClaw, register and probe the same local connector:

```bash
openclaw mcp add pascal \
  --command pascal \
  --arg mcp \
  --arg connect
openclaw mcp doctor pascal --probe
```

Use only one active agent client with each local CLI service. The standalone HTTP service shares active scene state across clients; do not run concurrent agents against that process. Separate processes need separate local data stores for independent work. The hosted endpoint below uses a different session-isolated bridge.

## Existing hosted project

Cursor users follow the browser sign-in instructions below. For other clients, create an API key in Pascal Settings (`https://editor.pascal.app/settings`) for the same user or organization that owns the target project. Set `PASCAL_API_KEY` to that key without printing it. If you assign it in a shell command, avoid or remove that command from shell history. The hosted Streamable HTTP endpoint is:

```text
https://editor.pascal.app/api/mcp
```

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

The guard exits before changing Claude Code configuration when the variable is unset or empty. Claude Code expands the variable during registration and stores the static Authorization header, including the key, in its private user configuration. The connection is then available in all Claude Code projects for that user. Keep the configuration private; use `--scope local` instead when the connection should remain local to the current project. Never paste the key into a project file, report, prompt, screenshot, or URL.

OpenClaw:

```bash
: "${PASCAL_API_KEY:?Set PASCAL_API_KEY to a key from Pascal Settings}" && \
openclaw mcp add pascal \
  --url https://editor.pascal.app/api/mcp \
  --transport streamable-http \
  --header "Authorization=Bearer $PASCAL_API_KEY"
openclaw mcp doctor pascal --probe
```

The current OpenClaw static-header path stores the expanded key in its private MCP configuration and may warn about the literal credential during `doctor`. Do not commit or share that configuration. Remove the server with `openclaw mcp unset pascal` and rotate the Pascal key if the configuration is exposed. Installing this skill does not authorize a save, placement, account, upload, publication, or paid operation.

Cursor:

The Cursor marketplace installs this repository's `skills/` directory. Its `.cursor-plugin/plugin.json` explicitly selects the Cursor MCP configuration, so the Claude-only `${user_config.pascal_api_key}` header is never used by Cursor. The local server runs `npx --yes --package=@pascal-app/cli@1.0.0 pascal mcp connect`; Node.js 22.13 or newer and npm must be available to Cursor. No global `pascal` installation or web-editor runtime is required. The first connection downloads the pinned CLI from npm, and later connections reuse npm's cache. This starts only the local MCP service and keeps existing local project storage. If Cursor reports `spawn npx ENOENT`, install Node.js/npm and fully restart Cursor so it picks up the executable path. For an older installed bundle that still runs `pascal`, update the plugin; `npm install --global @pascal-app/cli@1.0.0` followed by **Customize → MCPs → pascal → Reload** repairs that legacy local command.

The hosted `pascal-hosted` server uses browser sign-in. In **Customize → MCPs**, choose **Authenticate** (or **Connect**) beside `pascal-hosted`. Pascal opens in your browser: sign in or create an account with Google or email, choose the intended workspace, review access, then return to Cursor. No API key or plugin variable is required. Let the user approve the account and workspace shown in consent. Ordinary access covers reading and editing projects; it does not authorize publishing, credit spending, external AI processing, community posting, or account management. Disconnect at `https://editor.pascal.app/settings/connected-apps`.

For local-only work, use `pascal` and leave `pascal-hosted` disconnected. Local project storage stays on this machine. If browser sign-in is unavailable, verify that the installed plugin and hosted service support this flow; do not create another account or fall back to a different workspace implicitly.

For Cursor without the plugin, add this to `.cursor/mcp.json` and start authentication in Cursor:

```json
{
  "mcpServers": {
    "pascal-hosted": {
      "type": "http",
      "url": "https://editor.pascal.app/api/mcp",
      "auth": {
        "CLIENT_ID": "pascal-cursor",
        "scopes": [
          "openid",
          "profile",
          "offline_access",
          "scene:read",
          "scene:write"
        ]
      }
    }
  }
}
```

Existing manually configured API-key connections remain supported. Do not combine an Authorization header with this OAuth configuration.

## Separate autonomous workspace

Only when the task explicitly authorizes creating separate private agent-owned work, register through `POST https://editor.pascal.app/api/auth/agent/register` with `name` and optional `purpose` and `agentClient`. Capture the returned key without printing it and store it securely.

Self-registration does not create an email or browser login. The project belongs to a separate agent account and will not automatically appear in the user's existing Pascal workspace. For an existing user's room, use their browser-approved Cursor connection or Settings-created key instead.

Current hosted instructions: `https://editor.pascal.app/docs/developers/mcp`.
