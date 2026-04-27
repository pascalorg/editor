import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { connectHttp, type HttpTransportHandle } from './http'

let bridge: SceneBridge
let server: McpServer
let handle: HttpTransportHandle | null = null

beforeEach(() => {
  bridge = new SceneBridge()
  bridge.loadDefault()
  server = createPascalMcpServer({ bridge })
})

afterEach(async () => {
  if (handle) {
    await handle.close()
    handle = null
  }
})

test('connectHttp listens on the given port and accepts MCP traffic', async () => {
  // Port 0 → OS assigns an ephemeral port.
  handle = await connectHttp(server, 0)
  expect(handle.port).toBeGreaterThan(0)

  const url = new URL(`http://127.0.0.1:${handle.port}/mcp`)
  const clientTransport = new StreamableHTTPClientTransport(url)
  const client = new Client({ name: 'http-test-client', version: '0.0.0' })

  try {
    await client.connect(clientTransport)
    const tools = await client.listTools()
    expect(Array.isArray(tools.tools)).toBe(true)
  } finally {
    await client.close()
  }
})

test('connectHttp close() stops the server', async () => {
  handle = await connectHttp(server, 0)
  const port = handle.port
  await handle.close()
  handle = null

  // A fresh fetch to the old port should fail (connection refused).
  let didConnect = false
  try {
    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(500),
    })
    didConnect = true
  } catch {
    didConnect = false
  }
  expect(didConnect).toBe(false)
})

test('connectHttp requires auth when binding a non-loopback host', async () => {
  await expect(connectHttp(server, 0, { host: '0.0.0.0' })).rejects.toThrow(
    /requires PASCAL_MCP_HTTP_TOKEN/,
  )
})

test('connectHttp rejects unauthenticated requests when a token is configured', async () => {
  handle = await connectHttp(server, 0, { authToken: 'secret' })

  const response = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })

  expect(response.status).toBe(401)
})

test('connectHttp handles allowed CORS preflight', async () => {
  handle = await connectHttp(server, 0, {
    authToken: 'secret',
    allowedOrigins: ['https://app.example'],
  })

  const response = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://app.example',
      'access-control-request-method': 'POST',
    },
  })

  expect(response.status).toBe(204)
  expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example')
})
