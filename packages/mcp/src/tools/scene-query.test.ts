import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  DoorNode,
  LevelNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerSceneQueryTools } from './scene-query'

describe('scene query tools', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSceneQueryTools(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('list_levels returns level ids', async () => {
    const result = await client.callTool({ name: 'list_levels', arguments: {} })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.levels).toHaveLength(1)
    expect(parsed.levels[0].id).toMatch(/^level_/)
  })

  test('get_level_summary includes walls, zones, and openings', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0] })
    bridge.createNode(wall, level.id)
    const door = DoorNode.parse({ wallId: wall.id, position: [2, 1.05, 0] })
    bridge.createNode(door, wall.id)
    const zone = ZoneNode.parse({
      name: 'Room',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    bridge.createNode(zone, level.id)

    const result = await client.callTool({
      name: 'get_level_summary',
      arguments: { levelId: level.id },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.counts.walls).toBe(1)
    expect(parsed.counts.zones).toBe(1)
    expect(parsed.counts.doors).toBe(1)
    expect(parsed.walls[0].openings[0].id).toBe(door.id)
    expect(parsed.zones[0].areaSqMeters).toBe(12)
  })

  test('verify_scene reports practical issues without replacing validate_scene', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    bridge.createNode(WallNode.parse({ start: [0, 0], end: [4, 0] }), level.id)

    const result = await client.callTool({ name: 'verify_scene', arguments: {} })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.ok).toBe(true)
    expect(parsed.valid).toBe(true)
    expect(parsed.hasIssues).toBe(true)
    expect(parsed.issues.join('\n')).toContain('walls but no zones')
  })

  test('verify_scene reports stair wall obstructions and missing destination slab openings', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const ground = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const upper = LevelNode.parse({ name: 'Upper Floor', level: 1 })
    bridge.createNode(upper, building.id)
    const upperSlab = SlabNode.parse({
      name: 'Upper Floor Slab',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    bridge.createNode(upperSlab, upper.id)
    bridge.createNode(
      WallNode.parse({ name: 'Stair Blocker', start: [0, 2], end: [4, 2] }),
      ground.id,
    )

    const segment = StairSegmentNode.parse({
      width: 1,
      length: 2.6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      name: 'Main Stair',
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    bridge.createNode(stair, ground.id)
    bridge.createNode(segment, stair.id)

    const result = await client.callTool({ name: 'verify_scene', arguments: {} })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.hasIssues).toBe(true)
    expect(parsed.issues.join('\n')).toContain('obstructs stair Main Stair')
    expect(parsed.issues.join('\n')).toContain('no destination slab opening')
  })
})
