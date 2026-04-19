import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ItemNode, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerCheckCollisions } from './check-collisions'

function makeItem(position: [number, number, number], dims: [number, number, number] = [1, 1, 1]) {
  return ItemNode.parse({
    position,
    asset: {
      id: 'x',
      name: 'x',
      category: 'x',
      thumbnail: '',
      src: 'asset://x',
      dimensions: dims,
    },
  })
}

describe('check_collisions', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCheckCollisions(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('detects overlapping item AABBs', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [10, 0] })
    bridge.createNode(wall, level.id)
    const a = makeItem([0, 0, 0])
    const b = makeItem([0.5, 0, 0.5])
    ;(a as { wallId?: string }).wallId = wall.id
    ;(b as { wallId?: string }).wallId = wall.id
    bridge.createNode(a, wall.id)
    bridge.createNode(b, wall.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.collisions.length).toBeGreaterThanOrEqual(1)
    const ids = parsed.collisions.flatMap((c: { aId: string; bId: string }) => [c.aId, c.bId])
    expect(ids).toContain(a.id)
    expect(ids).toContain(b.id)
  })

  test('returns empty array when items do not overlap', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [10, 0] })
    bridge.createNode(wall, level.id)
    const a = makeItem([-10, 0, -10])
    const b = makeItem([10, 0, 10])
    ;(a as { wallId?: string }).wallId = wall.id
    ;(b as { wallId?: string }).wallId = wall.id
    bridge.createNode(a, wall.id)
    bridge.createNode(b, wall.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.collisions.length).toBe(0)
  })

  test('scopes to levelId', async () => {
    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { levelId: 'level_missing' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(Array.isArray(parsed.collisions)).toBe(true)
  })
})
