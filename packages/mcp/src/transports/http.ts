import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_RATE_LIMIT_PER_MINUTE = 120
const WINDOW_MS = 60_000
const ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS'
const ALLOWED_HEADERS =
  'authorization, content-type, mcp-session-id, mcp-protocol-version, x-pascal-mcp-token'

export type HttpTransportHandle = {
  /** Host interface the server is listening on. */
  host: string
  /** Port the server is actually listening on (useful when caller passed 0). */
  port: number
  /** Gracefully close the HTTP server and the MCP transport. */
  close(): Promise<void>
}

export type HttpTransportOptions = {
  /**
   * Network interface to bind. Defaults to loopback. Binding to a non-loopback
   * interface requires an auth token.
   */
  host?: string
  /** Bearer token for HTTP MCP calls. Defaults to PASCAL_MCP_HTTP_TOKEN. */
  authToken?: string
  /** Exact CORS origins allowed to call this transport. Loopback origins are allowed. */
  allowedOrigins?: string[]
  /** Per-client request cap per minute. Set <= 0 to disable. */
  rateLimitPerMinute?: number
}

/**
 * Attach an `McpServer` to a Streamable HTTP transport bound to a local port.
 *
 * Uses the SDK's Node-flavored `StreamableHTTPServerTransport`, which accepts
 * `IncomingMessage`/`ServerResponse` directly via `handleRequest(req, res)`.
 * A new session ID is generated per connection (stateful mode).
 *
 * Listens on `127.0.0.1:<port>` (pass `0` for an ephemeral port in tests). The
 * returned handle exposes the actual bound port and a `close()` that stops
 * the underlying Node HTTP server. To bind a public interface, pass `host` and
 * configure an auth token.
 */
export async function connectHttp(
  server: McpServer,
  port: number,
  options: HttpTransportOptions = {},
): Promise<HttpTransportHandle> {
  const host = options.host ?? DEFAULT_HOST
  const authToken = options.authToken ?? process.env.PASCAL_MCP_HTTP_TOKEN
  if (!isLoopbackHost(host) && !authToken) {
    throw new Error(
      'HTTP transport on a non-loopback host requires PASCAL_MCP_HTTP_TOKEN or authToken',
    )
  }
  const guard = createHttpGuard({
    authToken,
    allowedOrigins: options.allowedOrigins ?? envAllowedOrigins(),
    rateLimitPerMinute: options.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
  })

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await server.connect(transport)

  const httpServer = createServer((req, res) => {
    if (!guard(req, res)) return
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
    httpServer.listen(port, host)
  })

  const address = httpServer.address()
  const boundPort = typeof address === 'object' && address !== null ? address.port : port

  return {
    host,
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

function createHttpGuard(options: {
  authToken?: string
  allowedOrigins: string[]
  rateLimitPerMinute: number
}): (req: IncomingMessage, res: ServerResponse) => boolean {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  const allowedOrigins = new Set(
    options.allowedOrigins
      .map(normalizeOrigin)
      .filter((origin): origin is string => origin !== null),
  )

  return (req, res) => {
    const origin = req.headers.origin
    if (origin && !isOriginAllowed(origin, req.headers.host, allowedOrigins)) {
      sendJson(res, 403, { error: 'origin_not_allowed' })
      return false
    }

    applyCors(req, res, allowedOrigins)

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return false
    }

    const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '/'
    if (pathname !== '/mcp') {
      sendJson(res, 404, { error: 'not_found' })
      return false
    }

    if (options.authToken) {
      const supplied = bearerToken(req) ?? headerValue(req.headers['x-pascal-mcp-token'])
      if (!supplied || !safeEqual(supplied, options.authToken)) {
        sendJson(res, 401, { error: 'unauthorized' })
        return false
      }
    }

    if (options.rateLimitPerMinute > 0) {
      const now = Date.now()
      const key = req.socket.remoteAddress ?? 'unknown'
      const bucket = buckets.get(key)
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
      } else {
        bucket.count++
        if (bucket.count > options.rateLimitPerMinute) {
          res.setHeader('Retry-After', Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)))
          sendJson(res, 429, { error: 'rate_limited' })
          return false
        }
      }
    }

    return true
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: Set<string>): void {
  const origin = req.headers.origin
  if (origin && isOriginAllowed(origin, req.headers.host, allowedOrigins)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS)
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

function isOriginAllowed(
  origin: string,
  requestHost: string | undefined,
  allowedOrigins: Set<string>,
): boolean {
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  const parsed = new URL(normalized)
  if (isLoopbackHost(parsed.hostname)) return true
  if (requestHost && normalized === normalizeOrigin(`http://${requestHost}`)) return true
  if (requestHost && normalized === normalizeOrigin(`https://${requestHost}`)) return true
  return allowedOrigins.has(normalized)
}

function bearerToken(req: IncomingMessage): string | null {
  const header = headerValue(req.headers.authorization)
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (!res.hasHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
  }
  res.writeHead(status).end(JSON.stringify(payload))
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

function envAllowedOrigins(): string[] {
  return (process.env.PASCAL_MCP_HTTP_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin)
    return `${url.protocol}//${url.host}`.toLowerCase()
  } catch {
    return null
  }
}

function isLoopbackHost(host: string): boolean {
  const h = stripPort(host).toLowerCase()
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1'
}

function stripPort(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? host : host.slice(1, end)
  }
  return host.split(':')[0] ?? host
}
