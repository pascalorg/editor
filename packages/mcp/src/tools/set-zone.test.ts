import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type AnyNodeId, WallNode, type ZoneNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerSetZone } from './set-zone'

describe('set_zone', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSetZone(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('creates a zone on a level', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'set_zone',
      arguments: {
        levelId: level.id,
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        label: 'Kitchen',
        properties: { primary: true },
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.zoneId).toMatch(/^zone_/)
    const zone = bridge.getNode(parsed.zoneId)
    expect((zone as { name: string }).name).toBe('Kitchen')
  })

  // Run 6: walls drawn first make "Room N"; naming that space must name it, not stack a twin.
  test('over the room walls already enclose, names that room instead of adding a zone', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const square: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    for (const [i, start] of square.entries())
      bridge.createNode(
        WallNode.parse({ start, end: square[(i + 1) % 4]!, height: 2.5 }),
        level.id as AnyNodeId,
      )
    const zonesOnLevel = () =>
      Object.values(bridge.getNodes()).filter(
        (n): n is ZoneNode => n.type === 'zone' && n.parentId === level.id,
      )
    const [walled] = zonesOnLevel()
    expect(walled?.name).toMatch(/^Room \d+$/)

    const result = await client.callTool({
      name: 'set_zone',
      arguments: {
        levelId: level.id,
        polygon: [...square].reverse(),
        label: 'Kitchen',
        properties: { primary: true },
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.zoneId).toBe(walled!.id)
    expect(zonesOnLevel()).toHaveLength(1)
    expect(bridge.getNode(walled!.id)).toMatchObject({
      name: 'Kitchen',
      metadata: { primary: true },
    })
  })

  test('rejects polygon with <3 vertices', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'set_zone',
      arguments: {
        levelId: level.id,
        polygon: [
          [0, 0],
          [1, 1],
        ],
        label: 'X',
      },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects unknown level id', async () => {
    const result = await client.callTool({
      name: 'set_zone',
      arguments: {
        levelId: 'level_nope',
        polygon: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        label: 'X',
      },
    })
    expect(result.isError).toBe(true)
  })
})
