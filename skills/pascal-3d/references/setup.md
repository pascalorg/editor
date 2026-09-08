# Pascal connection and credential setup

Source and public-documentation review date: 2026-09-08. Native task results are recorded separately with the evaluated source hash; source review alone does not prove every host or published runtime works.

Choose one path. Do not switch storage boundaries without the user's instruction.

## Local Pascal CLI

Use local mode when the project should remain on the current machine. It requires Node.js 22.13 or newer and does not require a Pascal account or API key.

```bash
npm install --global @pascal-app/cli@beta
pascal editor --no-open
pascal mcp setup claude
pascal mcp setup codex
```

Run only the setup command for the active host. For a JSON-based MCP client, use:

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

The user creates an API key in Pascal Settings and chooses the intended personal or organization workspace. Keep the key in an environment variable or the client's credential store.

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

The single quotes preserve the environment reference in `.mcp.json`; the variable must be available when Claude starts. For JSON-based clients, prefer their environment-variable or secret interpolation rather than a literal key:

```json
{
  "mcpServers": {
    "pascal": {
      "type": "http",
      "url": "https://editor.pascal.app/api/mcp",
      "headers": {
        "Authorization": "Bearer ${PASCAL_API_KEY}"
      }
    }
  }
}
```

Client interpolation syntax varies. Confirm that the chosen host supports this form before relying on it.

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
