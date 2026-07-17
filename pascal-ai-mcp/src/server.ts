import type { Server } from 'bun'
import { PascalAiAgent } from './agent'
import { loadConfig } from './config'
import { isValidImageDataUrl, readJsonBody } from './http-guards'
import { PascalMcpClient } from './mcp'

const config = loadConfig()
const mcp = new PascalMcpClient(config)
await mcp.connect()

const agent = new PascalAiAgent(config, mcp)

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: config.maxRequestBodyBytes,
  async fetch(request, bunServer: Server<undefined>): Promise<Response> {
    try {
      return await handle(request, bunServer)
    } catch (error) {
      // Without this, an uncaught error (e.g. a bad sceneId, a hung MCP
      // call) falls through to Bun's default error response, which has no
      // CORS headers — the browser reports a opaque "network error" instead
      // of the real failure, which is very hard to debug from the client.
      console.error('Unhandled error in pascal-ai-mcp request:', error)
      return json({ error: 'internal_error', message: errorMessage(error) }, 500)
    }
  },
})

async function handle(request: Request, bunServer: Server<undefined>): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    })
  }

  // Liveness only. Provider/model/mcpMode details are deliberately not
  // exposed here: the endpoint is unauthenticated (ARCHITECTURE_TASKS.md
  // T0.3); the startup log carries the config summary instead. A proper
  // internal readiness endpoint lands with T2.5.
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true })
  }

  if (request.method === 'GET' && url.pathname === '/tools') {
    return json({ tools: await mcp.listOpenAiTools() })
  }

  if (request.method === 'POST' && url.pathname === '/chat') {
    // A full generation can legitimately run for minutes (room-by-room
    // structure phase, wall dedup, openings, furnishing, then verification
    // with up to a few repair rounds — each its own tool-calling loop), and
    // we only write the HTTP response once at the very end. Bun's HTTP
    // server defaults to a 10s idle timeout and silently drops the
    // connection if nothing is read/written on it in that window, so a slow
    // /chat call gets its socket killed long before we're done — the
    // request keeps running server-side and the scene still gets created,
    // but the client sees an empty/truncated response. Disable the timeout
    // for this endpoint specifically (0 = no timeout); the fast endpoints
    // above keep the default.
    bunServer.timeout(request, 0)
    const read = await readJsonBody(request, config.maxRequestBodyBytes)
    if (!read.ok) return json({ error: read.error, maxBytes: config.maxRequestBodyBytes }, read.status)
    const body = read.body as {
      sessionId?: string
      message?: string
      imageDataUrl?: string
      sceneId?: string
      action?: 'confirm' | 'cancel'
    }

    if (!body.sessionId || (!body.message && !body.imageDataUrl && !body.action)) {
      return json({ error: 'sessionId and message, imageDataUrl, or action are required' }, 400)
    }

    if (body.imageDataUrl && !isValidImageDataUrl(body.imageDataUrl)) {
      return json({ error: 'invalid_image', message: 'imageDataUrl must be a base64 data URL of type image/png or image/jpeg' }, 400)
    }

    const result = await agent.chat({
      sessionId: body.sessionId,
      ...(body.message ? { message: body.message } : {}),
      ...(body.imageDataUrl ? { imageDataUrl: body.imageDataUrl } : {}),
      ...(body.sceneId ? { sceneId: body.sceneId } : {}),
      ...(body.action ? { action: body.action } : {}),
    })
    return json(result)
  }

  const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/)
  if (sessionMatch && request.method === 'GET') {
    return json({ session: agent.getSession(decodeURIComponent(sessionMatch[1] ?? '')) ?? null })
  }

  if (sessionMatch && request.method === 'DELETE') {
    const deleted = agent.deleteSession(decodeURIComponent(sessionMatch[1] ?? ''))
    return json({ deleted })
  }

  return json({ error: 'not_found' }, 404)
}

console.log(`pascal-ai-mcp listening on http://${server.hostname}:${server.port}`)
console.log(
  `config: provider=${config.aiProvider} model=${config.aiModel} mcpMode=${config.mcpMode} configured=${Boolean(config.aiApiKey)} maxBodyMB=${Math.round(config.maxRequestBodyBytes / 1024 / 1024)}`,
)

// Graceful shutdown (ARCHITECTURE_TASKS.md T0.4): stop accepting new
// requests, drain queued session writes within the configured budget, then
// close MCP. A flush failure or timeout exits non-zero so supervisors don't
// mistake dropped state for a clean stop. SIGKILL obviously bypasses all of
// this — only the cooperative path is covered.
let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    // Second signal: the operator wants out now.
    console.error(`received ${signal} during shutdown, exiting immediately`)
    process.exit(1)
  }
  shuttingDown = true
  console.log(`received ${signal}, shutting down`)
  let exitCode = 0
  // server.stop() resolves once in-flight requests finish — exiting before
  // that would drop the session writes those requests are about to make. A
  // multi-minute /chat can exceed the drain budget; that path exits non-zero
  // because its state genuinely was not persisted.
  try {
    await withTimeout(server.stop(), config.shutdownDrainTimeoutMs, 'in-flight requests')
  } catch (error) {
    console.error('shutdown: gave up waiting for in-flight requests:', errorMessage(error))
    server.stop(true)
    exitCode = 1
  }
  try {
    await withTimeout(agent.flushSessions(), config.shutdownDrainTimeoutMs, 'session flush')
  } catch (error) {
    console.error('shutdown: failed to persist session store:', errorMessage(error))
    exitCode = 1
  }
  try {
    await mcp.close()
  } catch (error) {
    console.error('shutdown: failed to close MCP client:', errorMessage(error))
  }
  process.exit(exitCode)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
      headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  })
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
