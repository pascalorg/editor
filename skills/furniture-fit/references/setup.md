# Connect Pascal for a furniture-fit assessment

Source and public-documentation review date: 2026-09-08. Native task results are recorded separately with the evaluated source hash; source review alone does not prove every host or published runtime works.

## Local project

Use the local path when the project should remain on the machine:

```bash
npm install --global @pascal-app/cli@beta
pascal editor --no-open
pascal mcp setup claude
pascal mcp setup codex
```

Run the setup command for the active host. The MCP command installed in host configuration is `pascal mcp connect`. Local use needs no hosted account and does not upload projects automatically.

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
