import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CeilingNode,
  DoorNode,
  LevelNode,
  RoofNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  WindowNode,
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

  test('verify_scene separates occupied stories from dedicated roof levels', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const ground = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const upper = LevelNode.parse({
      name: 'Second Floor',
      level: 1,
      metadata: { height: 2.8 },
    })
    const roofLevel = LevelNode.parse({
      name: 'Roof',
      level: 2,
      metadata: { role: 'roof', referenceLevelId: upper.id, height: 2.5 },
      children: [],
    })
    bridge.createNode(upper, building.id)
    bridge.createNode(roofLevel, building.id)

    for (const levelId of [ground.id, upper.id]) {
      bridge.createNode(
        ZoneNode.parse({
          name: 'Room',
          polygon: [
            [0, 0],
            [4, 0],
            [4, 3],
            [0, 3],
          ],
        }),
        levelId,
      )
      bridge.createNode(
        SlabNode.parse({
          polygon: [
            [0, 0],
            [4, 0],
            [4, 3],
            [0, 3],
          ],
        }),
        levelId,
      )
      bridge.createNode(
        CeilingNode.parse({
          polygon: [
            [0, 0],
            [4, 0],
            [4, 3],
            [0, 3],
          ],
        }),
        levelId,
      )
    }

    const roof = RoofNode.parse({
      name: 'Main roof',
      metadata: { referenceLevelId: upper.id, roofLevelId: roofLevel.id },
    })
    bridge.createNode(roof, roofLevel.id)

    const result = await client.callTool({ name: 'verify_scene', arguments: {} })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.levelCount).toBe(3)
    expect(parsed.occupiedStoryCount).toBe(2)
    expect(parsed.supportLevelCount).toBe(1)
    expect(parsed.roofLevelIds).toEqual([roofLevel.id])
    expect(parsed.hasIssues).toBe(false)

    const listed = await client.callTool({ name: 'list_levels', arguments: {} })
    expect(listed.isError).toBeFalsy()
    const listPayload = JSON.parse(
      (listed.content as Array<{ type: string; text: string }>)[0]!.text,
    )
    expect(listPayload.occupiedStoryCount).toBe(2)
    expect(listPayload.roofLevelIds).toEqual([roofLevel.id])
    expect(listPayload.levels.find((level: { id: string }) => level.id === roofLevel.id)).toMatchObject({
      role: 'roof',
      isSupportLevel: true,
      referenceLevelId: upper.id,
    })
  })

  test('verify_scene reports bad opening linkage and wall-local bounds', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const hostWall = WallNode.parse({ start: [0, 0], end: [4, 0], height: 2.5 })
    const otherWall = WallNode.parse({ start: [0, 2], end: [4, 2], height: 2.5 })
    bridge.createNode(hostWall, level.id)
    bridge.createNode(otherWall, level.id)

    const window = WindowNode.parse({
      wallId: otherWall.id,
      position: [4.8, 2.4, 0],
      width: 1,
      height: 1,
    })
    bridge.createNode(window, hostWall.id)

    const result = await client.callTool({ name: 'verify_scene', arguments: {} })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    const issues = parsed.issues.join('\n')
    expect(issues).toContain(`window ${window.id} has wallId ${otherWall.id}`)
    expect(issues).toContain(`window ${window.id} extends outside wall ${hostWall.id}`)
    expect(issues).toContain(`window ${window.id} vertical bounds`)
  })

  test('verify_scene reports stairs outside their source floor slab', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    bridge.createNode(slab, level.id)

    const segment = StairSegmentNode.parse({
      width: 1,
      length: 3,
      height: 2.5,
      stepCount: 10,
    })
    const stair = StairNode.parse({
      name: 'Escaping Stair',
      position: [3.6, 0, 1],
      rotation: Math.PI / 2,
      stairType: 'straight',
      children: [segment.id],
    })
    bridge.createNode(stair, level.id)
    bridge.createNode(segment, stair.id)

    const result = await client.callTool({ name: 'verify_scene', arguments: {} })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.issues.join('\n')).toContain(
      'Stair Escaping Stair footprint extends outside source floor slab',
    )
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
