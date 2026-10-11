import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerSharedTools } from './shared-tools'

// Live over the MCP (2026-10-05): a write tool answered achieved: unchanged right after creating its
// nodes. achieved says what the scene holds after the call, so it must agree with what the call
// created.

async function call(name: string, args: Record<string, unknown>) {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = new McpServer({ name: 'achieved', version: '1' })
  registerSharedTools(server, bridge)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'achieved', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
  try {
    const result = await client.callTool({ name, arguments: args })
    return JSON.parse((result.content as { text: string }[])[0]!.text) as Record<string, unknown>
  } finally {
    await client.close()
    await server.close()
  }
}

describe('what a write tool achieved, over the MCP', () => {
  test('a wall the call built is counted as created', async () => {
    const result = await call('add_wall', { start: [0, 0], end: [5, 0] })
    expect(result.achieved).toMatchObject({ created: { wall: 1 } })
    expect(result.achieved).not.toHaveProperty('unchanged')
  })
})
