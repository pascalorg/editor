import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode, ZoneNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerMeasure } from './measure'

describe('measure', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerMeasure(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('computes distance between two wall midpoints', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const a = WallNode.parse({ start: [0, 0], end: [2, 0] })
    const b = WallNode.parse({ start: [10, 0], end: [12, 0] })
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)

    const result = await client.callTool({
      name: 'measure',
      arguments: { fromId: a.id, toId: b.id },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    // Midpoint a = (1,0,0); midpoint b = (11,0,0) — distance 10.
    expect(parsed.distanceMeters).toBeCloseTo(10, 5)
    expect(parsed.units).toBe('meters')
  })

  test('computes zone area via shoelace for self-measurement', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    // 4x4 square centred at origin — area 16.
    const zone = ZoneNode.parse({
      name: 'Kitchen',
      polygon: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
    })
    bridge.createNode(zone, level.id)

    const result = await client.callTool({
      name: 'measure',
      arguments: { fromId: zone.id, toId: zone.id },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.distanceMeters).toBe(0)
    expect(parsed.areaSqMeters).toBeCloseTo(16, 5)
  })

  test('errors on unknown id', async () => {
    const result = await client.callTool({
      name: 'measure',
      arguments: { fromId: 'wall_nope', toId: 'wall_nope2' },
    })
    expect(result.isError).toBe(true)
  })
})
