import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode, ZoneNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerFindNodes } from './find-nodes'

describe('find_nodes', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerFindNodes(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('filters by type', async () => {
    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'level' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.nodes.length).toBeGreaterThan(0)
    for (const n of parsed.nodes) {
      expect(n.type).toBe('level')
    }
  })

  test('returns empty list for unused type', async () => {
    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'roof' },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(Array.isArray(parsed.nodes)).toBe(true)
    expect(parsed.nodes.length).toBe(0)
  })

  test('zoneId filters walls whose midpoint falls in the zone polygon', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const zone = ZoneNode.parse({
      name: 'Kitchen',
      polygon: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
    })
    bridge.createNode(zone, level.id)
    const inWall = WallNode.parse({ start: [-2, -2], end: [2, 2] })
    bridge.createNode(inWall, level.id)
    const outWall = WallNode.parse({ start: [50, 50], end: [60, 60] })
    bridge.createNode(outWall, level.id)

    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'wall', zoneId: zone.id },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    const ids: string[] = parsed.nodes.map((n: { id: string }) => n.id)
    expect(ids).toContain(inWall.id)
    expect(ids).not.toContain(outWall.id)
  })

  test('invalid type is rejected', async () => {
    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'not-a-type' },
    })
    expect(result.isError).toBe(true)
  })
})
