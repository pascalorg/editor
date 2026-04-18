import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerGetNode } from './get-node'

describe('get_node', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerGetNode(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('returns node by id', async () => {
    const rootId = bridge.getRootNodeIds()[0]!
    const result = await client.callTool({
      name: 'get_node',
      arguments: { id: rootId },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.node.id).toBe(rootId)
  })

  test('errors on unknown id', async () => {
    const result = await client.callTool({
      name: 'get_node',
      arguments: { id: 'wall_doesnotexist' },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects missing id argument', async () => {
    const result = await client.callTool({
      name: 'get_node',
      arguments: {},
    })
    expect(result.isError).toBe(true)
  })
})
