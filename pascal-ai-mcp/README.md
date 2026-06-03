# Pascal AI MCP Client

Standalone chat bridge for calling Pascal MCP tools from OpenRouter.

This directory does not change `packages/mcp` or the Pascal MCP server configuration. It runs as a separate process:

```text
chat UI / curl
  -> pascal-ai-mcp /chat
    -> OpenAI-compatible /v1/chat/completions
    -> Pascal MCP client
    -> existing Pascal MCP server tools
```

## Setup

```bash
cd pascal-ai-mcp
bun install
cp .env.example .env
```

Fill `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in `.env`.

The model endpoint defaults to:

```text
https://openrouter.ai/api/v1/chat/completions
```

Requests include OpenRouter app attribution headers:

```text
HTTP-Referer: OPENROUTER_HTTP_REFERER
X-OpenRouter-Title: OPENROUTER_APP_TITLE
```

The bridge also sends `session_id` to OpenRouter using your `/chat` `sessionId`. That is for OpenRouter routing/observability; the actual chat history is still stored locally in `.data/sessions.json`.

## Run with an existing Pascal MCP HTTP server

Terminal 1, from the repo root:

```bash
bun packages/mcp/src/bin/pascal-mcp.ts --http --port 3917
```

Terminal 2:

```bash
cd pascal-ai-mcp
bun run start
```

Send a chat request:

```bash
curl -X POST http://127.0.0.1:8788/chat \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"demo\",\"message\":\"创建一个 8 米乘 6 米的两居室平面布局，并保存场景\"}"
```

## Run by spawning Pascal MCP over stdio

Set this in `.env`:

```bash
PASCAL_MCP_MODE=stdio
PASCAL_MCP_COMMAND=bun
PASCAL_MCP_ARGS=../packages/mcp/src/bin/pascal-mcp.ts --stdio
```

Then:

```bash
bun run start
```

## Endpoints

- `GET /health` checks bridge status.
- `GET /tools` lists tools exposed by the Pascal MCP server.
- `POST /chat` sends a user message and lets the model call MCP tools.
- `GET /sessions/:id` returns stored messages for a chat session.
- `DELETE /sessions/:id` clears one chat session.

`POST /chat` body:

```json
{
  "sessionId": "demo",
  "message": "创建一个简单的一室一厅",
  "system": "Optional extra system instruction"
}
```

The model API is stateless, so this bridge stores messages per `sessionId` in `.data/sessions.json` by default and resends the conversation on every model call.
