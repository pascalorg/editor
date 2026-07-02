import type { Server } from 'bun'
import { PascalAiAgent } from './agent'
import { loadConfig } from './config'
import { PascalMcpClient } from './mcp'

const config = loadConfig()
const mcp = new PascalMcpClient(config)
await mcp.connect()

const agent = new PascalAiAgent(config, mcp)

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
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

  if (request.method === 'GET' && url.pathname === '/health') {
    return json({
      ok: true,
      configured: Boolean(config.aiApiKey),
      provider: config.aiProvider,
      mcpMode: config.mcpMode,
      model: config.aiModel,
    })
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
    const body = (await request.json()) as {
      sessionId?: string
      message?: string
      imageDataUrl?: string
      sceneId?: string
      action?: 'confirm' | 'cancel'
    }

    if (!body.sessionId || (!body.message && !body.imageDataUrl && !body.action)) {
      return json({ error: 'sessionId and message, imageDataUrl, or action are required' }, 400)
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

process.on('SIGINT', async () => {
  await mcp.close()
  process.exit(0)
})

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
