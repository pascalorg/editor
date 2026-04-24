import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

export type HttpTransportHandle = {
  /** Port the server is actually listening on (useful when caller passed 0). */
  port: number
  /** Gracefully close the HTTP server and the MCP transport. */
  close(): Promise<void>
}

/**
 * Attach an `McpServer` to a Streamable HTTP transport bound to a local port.
 *
 * Uses the SDK's Node-flavored `StreamableHTTPServerTransport`, which accepts
 * `IncomingMessage`/`ServerResponse` directly via `handleRequest(req, res)`.
 * A new session ID is generated per connection (stateful mode).
 *
 * Listens on `0.0.0.0:<port>` (pass `0` for an ephemeral port in tests). The
 * returned handle exposes the actual bound port and a `close()` that stops
 * the underlying Node HTTP server.
 */
export async function connectHttp(server: McpServer, port: number): Promise<HttpTransportHandle> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await server.connect(transport)

  const httpServer = createServer((req, res) => {
    transport.handleRequest(req, res).catch((err) => {
      // Log to stderr; never touch stdout (stdio transport uses it).
      console.error('[pascal-mcp] http transport error', err)
      if (!res.writableEnded) {
        try {
          res.writeHead(500).end()
        } catch {
          // Response may already be partially sent; nothing more we can do.
        }
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      httpServer.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      httpServer.off('error', onError)
      resolve()
    }
    httpServer.once('error', onError)
    httpServer.once('listening', onListening)
    httpServer.listen(port)
  })

  const address = httpServer.address()
  const boundPort = typeof address === 'object' && address !== null ? address.port : port

  return {
    port: boundPort,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      await transport.close()
    },
  }
}
