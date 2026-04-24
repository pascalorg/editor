import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerPlaceItem } from './place-item'

describe('place_item', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerPlaceItem(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('places an item on a wall and derives wallT', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [10, 0] })
    bridge.createNode(wall, level.id)

    const result = await client.callTool({
      name: 'place_item',
      arguments: {
        catalogItemId: 'chair:basic',
        targetNodeId: wall.id,
        position: [5, 0, 0],
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.itemId).toMatch(/^item_/)
    expect(parsed.status).toBe('catalog_unavailable')
    const item = bridge.getNode(parsed.itemId)
    expect(item).not.toBeNull()
    // Midpoint of a [0..10] wall at x=5 → wallT = 0.5.
    expect((item as { wallT?: number }).wallT).toBeCloseTo(0.5, 3)
  })

  test('rejects placement on a level', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'place_item',
      arguments: {
        catalogItemId: 'foo',
        targetNodeId: level.id,
        position: [0, 0, 0],
      },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects unknown target', async () => {
    const result = await client.callTool({
      name: 'place_item',
      arguments: {
        catalogItemId: 'foo',
        targetNodeId: 'wall_nope',
        position: [0, 0, 0],
      },
    })
    expect(result.isError).toBe(true)
  })
})
