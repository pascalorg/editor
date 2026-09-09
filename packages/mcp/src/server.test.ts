import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SceneBridge } from './bridge/scene-bridge'
import { createPascalMcpServer } from './server'

describe('Pascal MCP tool execution', () => {
  test('runs registered tools through the configured executor', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const events: string[] = []
    const server = createPascalMcpServer({
      bridge,
      executeTool: async ({ name, execute }) => {
        events.push(`before:${name}`)
        const result = await execute()
        events.push(`after:${name}`)
        return result
      },
    })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'tool-executor-test', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      const result = await client.callTool({ name: 'get_scene', arguments: {} })
      expect(result.isError).toBeFalsy()
      expect(events).toEqual(['before:get_scene', 'after:get_scene'])
    } finally {
      await client.close()
      await server.close()
    }
  })
})
