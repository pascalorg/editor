import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerDeleteNode } from './delete-node'

describe('delete_node', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerDeleteNode(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('deletes a leaf node', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [2, 0] })
    bridge.createNode(wall, level.id)

    const result = await client.callTool({
      name: 'delete_node',
      arguments: { id: wall.id },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.deletedIds).toContain(wall.id)
    expect(bridge.getNode(wall.id)).toBeNull()
  })

  test('refuses to delete a node with children without cascade', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const result = await client.callTool({
      name: 'delete_node',
      arguments: { id: building.id },
    })
    expect(result.isError).toBe(true)
  })

  test('cascades when cascade=true', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const result = await client.callTool({
      name: 'delete_node',
      arguments: { id: building.id, cascade: true },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.deletedIds.length).toBeGreaterThanOrEqual(1)
    expect(bridge.getNode(building.id)).toBeNull()
  })

  test('errors on unknown id', async () => {
    const result = await client.callTool({
      name: 'delete_node',
      arguments: { id: 'wall_nope' },
    })
    expect(result.isError).toBe(true)
  })
})
