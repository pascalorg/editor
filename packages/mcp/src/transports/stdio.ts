import type { McpServer } from '@modelcontextprotocol/server'
import {
  type ServeStdioOptions,
  type StdioServerHandle,
  serveStdio,
} from '@modelcontextprotocol/server/stdio'

/**
 * Serve Pascal over stdio from a server factory.
 *
 * The SDK negotiates the protocol era per connection: a client that opens with
 * the 2025 `initialize` handshake and one that opens with the 2026-07-28
 * `server/discover` probe are both served. A server handed to
 * `StdioServerTransport` directly would answer only the first. The factory can
 * be called twice on one connection (a discarded probe instance, then the
 * instance that serves it), so it must build a fresh, unconnected server each
 * time.
 *
 * The connection owns stdin/stdout for JSON-RPC messaging. Callers must send
 * any operator logging to stderr (not stdout) to avoid corrupting the protocol
 * stream. The process stays alive while stdin is open; the connection tears
 * itself down when stdin reaches end-of-file.
 */
export function connectStdio(
  createServer: () => McpServer,
  options: Pick<ServeStdioOptions, 'transport' | 'onerror'> = {},
): StdioServerHandle {
  return serveStdio(createServer, {
    onerror: (error) => console.error('[pascal-mcp] stdio transport error', error),
    ...options,
  })
}
