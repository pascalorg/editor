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
  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      })
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, mcpMode: config.mcpMode, model: config.aiModel })
    }

    if (request.method === 'GET' && url.pathname === '/tools') {
      return json({ tools: await mcp.listOpenAiTools() })
    }

    if (request.method === 'POST' && url.pathname === '/chat') {
      const body = (await request.json()) as {
        sessionId?: string
        message?: string
        system?: string
      }

      if (!body.sessionId || !body.message) {
        return json({ error: 'sessionId and message are required' }, 400)
      }

      const result = await agent.chat({
        sessionId: body.sessionId,
        message: body.message,
        system: body.system,
      })
      return json(result)
    }

    const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/)
    if (sessionMatch && request.method === 'GET') {
      return json({ messages: agent.getSession(decodeURIComponent(sessionMatch[1] ?? '')) })
    }

    if (sessionMatch && request.method === 'DELETE') {
      const deleted = agent.deleteSession(decodeURIComponent(sessionMatch[1] ?? ''))
      return json({ deleted })
    }

    return json({ error: 'not_found' }, 404)
  },
})

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
