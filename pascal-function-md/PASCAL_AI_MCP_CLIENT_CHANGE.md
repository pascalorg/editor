# Pascal AI MCP Client Change

Date: 2026-06-02

## Summary

Added a standalone AI-to-MCP bridge under `pascal-ai-mcp`. It lets a chat UI or HTTP client send natural-language requests to an OpenRouter/OpenAI-compatible model, lets the model call Pascal MCP tools, and stores chat history by `sessionId`.

The bridge is separate from `packages/mcp`; it does not change the Pascal MCP server configuration.

## Files Added

- `pascal-ai-mcp/package.json`
  - Defines the standalone Bun/TypeScript client project.
  - Scripts: `start`, `dev`, `chat`, `check-types`.

- `pascal-ai-mcp/.env.example`
  - Documents OpenRouter settings, bridge HTTP settings, and Pascal MCP connection settings.
  - Uses environment variables such as `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `PASCAL_MCP_URL`, and `PASCAL_MCP_MODE`.

- `pascal-ai-mcp/.gitignore`
  - Excludes `.env`, `.data/`, and `node_modules/`.

- `pascal-ai-mcp/README.md`
  - Documents setup, HTTP mode, stdio mode, and API endpoints.

- `pascal-ai-mcp/tsconfig.json`
  - TypeScript configuration for the standalone client.

- `pascal-ai-mcp/bun.lock`
  - Lockfile for the standalone client dependencies.

- `pascal-ai-mcp/src/config.ts`
  - Loads `.env` and environment variables.
  - Supports OpenRouter-first configuration with `AI_*` fallback aliases.
  - Supports MCP HTTP and stdio modes.

- `pascal-ai-mcp/src/openai-compatible.ts`
  - Calls the OpenRouter/OpenAI-compatible chat completions endpoint.
  - Sends model, messages, tools, `tool_choice`, `parallel_tool_calls`, temperature, and `session_id`.
  - Adds OpenRouter app attribution headers: `HTTP-Referer` and `X-OpenRouter-Title`.

- `pascal-ai-mcp/src/mcp.ts`
  - Creates an MCP SDK client.
  - Connects to Pascal MCP over Streamable HTTP or stdio.
  - Converts Pascal MCP tools into OpenAI-compatible function tools.

- `pascal-ai-mcp/src/agent.ts`
  - Maintains the model/tool-call loop.
  - Adds a system prompt restricting the assistant to Pascal editor, architectural scene, floor-plan, and related design tasks.
  - Refuses unrelated chat through model instruction rather than local keyword filtering.

- `pascal-ai-mcp/src/session-store.ts`
  - Persists chat messages by `sessionId` in `.data/sessions.json` by default.

- `pascal-ai-mcp/src/server.ts`
  - Exposes HTTP endpoints:
    - `GET /health`
    - `GET /tools`
    - `POST /chat`
    - `GET /sessions/:id`
    - `DELETE /sessions/:id`

- `pascal-ai-mcp/src/cli.ts`
  - Simple terminal chat loop for local testing.

- `pascal-ai-mcp/src/types.ts`
  - Shared chat/tool type definitions.

## Runtime Behavior

Default HTTP topology:

```text
chat UI / curl
  -> pascal-ai-mcp /chat
    -> OpenRouter /api/v1/chat/completions
    -> Pascal MCP client
    -> existing Pascal MCP server at PASCAL_MCP_URL
```

Default Pascal MCP URL:

```text
http://127.0.0.1:3917/mcp
```

Default bridge URL:

```text
http://127.0.0.1:8788
```

## Verification

The standalone client was type-checked successfully:

```powershell
cd pascal-ai-mcp
bun run check-types
```

## Notes

- Do not commit `pascal-ai-mcp/.env`.
- Do not migrate `pascal-ai-mcp/node_modules/` or `.data/`.
- This bridge stores chat history locally unless `AI_MCP_SESSION_FILE` is changed.
- The model API is stateless; the bridge resends stored messages for each `sessionId`.
