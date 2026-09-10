# Connect Pascal for a furniture-fit assessment

Source and public-documentation review date: 2026-09-10. Native task results are recorded separately with the evaluated source hash; source review alone does not prove every host or published runtime works.

## Local project

Use the local path when the project should remain on the machine:

### Verified GitHub preview

The npm `beta` tag currently resolves to `@pascal-app/cli@1.0.0-beta.1`, an older runtime that may not expose `check_collisions.candidate` or the hosted agent claim/status commands. For the candidate and hosted-agent paths verified with this skill, install the GitHub prerelease built from public commit `5dabbc3b56109c9f79dc8a378443a4c520d9ee0a`:

```bash
PASCAL_PREVIEW_VERSION='1.0.0-beta.2.status.0'
PASCAL_PREVIEW_PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/pascal-preview"
PASCAL_PREVIEW_DOWNLOAD="$(mktemp -d)"
cd "$PASCAL_PREVIEW_DOWNLOAD"

curl --fail --location --remote-name \
  "https://github.com/pascalorg/editor/releases/download/cli-v1.0.0-beta.2-status.0/pascal-app-cli-${PASCAL_PREVIEW_VERSION}.tgz"
curl --fail --location --remote-name \
  "https://github.com/pascalorg/editor/releases/download/cli-v1.0.0-beta.2-status.0/SHA256SUMS.txt"

# macOS
shasum -a 256 -c SHA256SUMS.txt
# Linux: use `sha256sum -c SHA256SUMS.txt` instead.

npm install --global --prefix "$PASCAL_PREVIEW_PREFIX" --ignore-scripts \
  "./pascal-app-cli-${PASCAL_PREVIEW_VERSION}.tgz"
export PATH="$PASCAL_PREVIEW_PREFIX/bin:$PATH"
pascal --version
```

Before activating the preview, save or otherwise persist every project with active work, then disconnect all editor and agent clients from this local service. `pascal update` may stop and restart the managed editor and MCP processes. Keeping the same `PASCAL_HOME` preserves persisted project data in that directory, but it does not preserve unsaved or unbound in-memory changes, undo history, or active client sessions.

```bash
pascal update --version "$PASCAL_PREVIEW_VERSION"
pascal editor --no-open
```

The expected archive SHA-256 is `15628baeeb174fb7786a1643db08f0554bf6d18afaaa3979f01922c5cd40019a`. The same-version `update` command installs and activates this CLI's bundled runtime, restarting an older running service when necessary. `pascal editor` alone reuses any healthy service, including an older one, so run `pascal update` when activating the preview. Keep the preview prefix on the agent host's `PATH` so its configured `pascal mcp connect` command resolves. The preview includes `pascal agent claim` for a prefilled 15-minute accountability handoff and `pascal agent status --json` for bounded credential and claim-state verification. This preview is not published on npm.

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

Create an API key in Pascal Settings (`https://editor.pascal.app/settings`) for the same user or organization that owns the target project. Set `PASCAL_API_KEY` to that key without printing it. If you assign it in a shell command, avoid or remove that command from shell history. The hosted Streamable HTTP endpoint is:

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

Cursor, in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pascal": {
      "url": "https://editor.pascal.app/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:PASCAL_API_KEY}"
      }
    }
  }
}
```

Cursor resolves `${env:PASCAL_API_KEY}` from the environment it starts in, so the file holds no key and `PASCAL_API_KEY` must be exported where Cursor is launched. Interpolation syntax varies between clients; confirm that the chosen host supports this form before relying on it.

## Separate autonomous workspace

Only when the task explicitly authorizes creating separate private agent-owned work, register through `POST https://editor.pascal.app/api/auth/agent/register` with `name` and optional `purpose` and `agentClient`. Capture the returned key without printing it and store it securely.

Self-registration does not create an email or browser login. The project belongs to a separate agent account and will not automatically appear in the user's existing Pascal workspace. For an existing user's room, use their Settings-created key instead.

Current hosted instructions: `https://editor.pascal.app/docs/developers/mcp`.
