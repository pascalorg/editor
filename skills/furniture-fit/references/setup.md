# Connect Pascal for a furniture-fit assessment

Source and public-documentation review date: 2026-09-08. Native task results are recorded separately with the evaluated source hash; source review alone does not prove every host or published runtime works.

## Local project

Use the local path when the project should remain on the machine:

### Candidate-enabled GitHub preview

The npm `beta` tag currently resolves to `@pascal-app/cli@1.0.0-beta.1`, an older runtime that may not expose `check_collisions.candidate`. For the candidate-enabled path verified with this skill, install the GitHub prerelease built from public commit `aa653f2f523f81f361ac20cb42b745faf7e46844`:

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
```

Before activating the preview, save or otherwise persist every project with active work, then disconnect all editor and agent clients from this local service. `pascal update` may stop and restart the managed editor and MCP processes. Keeping the same `PASCAL_HOME` preserves persisted project data in that directory, but it does not preserve unsaved or unbound in-memory changes, undo history, or active client sessions.

```bash
pascal update --version "$PASCAL_PREVIEW_VERSION"
pascal editor --no-open
pascal mcp setup claude # or: pascal mcp setup codex
```

The expected archive SHA-256 is `814ffa8c6f6a5fced73bf909c616d9a78feff18fd61fd0b4b7d65e74fad5a33d`. The same-version `update` command installs and activates this CLI's bundled runtime, restarting an older running service when necessary. `pascal editor` alone reuses any healthy service, including an older one, so run `pascal update` when activating the preview. Keep the preview prefix on the agent host's `PATH` so its configured `pascal mcp connect` command resolves. This preview is not published on npm.

Run the setup command for the active host. The MCP command installed in host configuration is `pascal mcp connect`. Local use needs no hosted account and does not upload projects automatically. If the connected MCP schema lacks `check_collisions.candidate`, report the narrower supported result rather than implying the candidate was tested.

Use only one active agent client with each local CLI service. The standalone HTTP service shares active scene state across clients; do not run concurrent agents against that process. Separate processes need separate local data stores for independent work. The hosted endpoint below uses a different session-isolated bridge.

## Existing hosted project

Create an API key in Pascal Settings for the same user or organization that owns the target project. Store it in the host's credential facility or an environment variable. The hosted Streamable HTTP endpoint is:

```text
https://editor.pascal.app/api/mcp
```

Codex CLI:

```bash
export PASCAL_API_KEY="paste_key_here"
codex mcp add pascal \
  --url https://editor.pascal.app/api/mcp \
  --bearer-token-env-var PASCAL_API_KEY
```

Claude Code:

```bash
export PASCAL_API_KEY="paste_key_here"
claude mcp add --scope project --transport http pascal https://editor.pascal.app/api/mcp \
  --header 'Authorization: Bearer ${PASCAL_API_KEY}'
```

The single quotes preserve the environment reference in `.mcp.json`; the variable must be available when Claude starts. Never paste the key into a project file, report, prompt, screenshot, or URL.

## Separate autonomous workspace

Only when the task explicitly authorizes creating separate private agent-owned work, register through `POST https://editor.pascal.app/api/auth/agent/register` with `name` and optional `purpose` and `agentClient`. Capture the returned key without printing it and store it securely.

Self-registration does not create an email or browser login. The project belongs to a separate agent account and will not automatically appear in the user's existing Pascal workspace. For an existing user's room, use their Settings-created key instead.

Current hosted instructions: `https://editor.pascal.app/docs/developers/mcp`.
