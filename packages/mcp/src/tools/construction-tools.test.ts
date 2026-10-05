import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { pointInPolygon, type Vec2 } from '@pascal-app/core/agent-operations'
import { type AnyNodeId, LevelNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerConstructionTools } from './construction-tools'
import { registerSharedTools } from './shared-tools'

const concaveFootprint: Vec2[] = [
  [0, 0],
  [6, 0],
  [6, 2],
  [2, 2],
  [2, 6],
  [0, 6],
]

const shellFootprints: Array<{ name: string; points: Vec2[] }> = [
  {
    name: 'rectangular',
    points: [
      [-4, -3],
      [4, -3],
      [4, 3],
      [-4, 3],
    ],
  },
  { name: 'concave', points: concaveFootprint },
  {
    name: 'narrow',
    points: [
      [0, 0],
      [6, 0],
      [6, 0.1],
      [0, 0.1],
    ],
  },
  {
    name: 'rotated concave with shifted start and large coordinates',
    points: [...concaveFootprint.slice(3), ...concaveFootprint.slice(0, 3)].map(([x, z]) => [
      1e9 + x * Math.cos(Math.PI / 7) - z * Math.sin(Math.PI / 7),
      -1e9 + x * Math.sin(Math.PI / 7) + z * Math.cos(Math.PI / 7),
    ]),
  },
]

describe('construction tools', () => {
  let client: Client
  let server: McpServer
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    server = new McpServer({ name: 'test', version: '0.0.0' })
    registerConstructionTools(server, bridge)
    registerSharedTools(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  afterEach(async () => {
    await client.close()
    await server.close()
  })

  for (const { name, points } of shellFootprints) {
    for (const winding of ['counterclockwise', 'clockwise'] as const) {
      test(`create_story_shell faces ${winding} ${name} walls' interior sides into the room`, async () => {
        const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
        const footprint = winding === 'counterclockwise' ? points : [...points].reverse()
        const result = await client.callTool({
          name: 'create_story_shell',
          arguments: { levelId: level.id, footprint, namePrefix: 'Perimeter', wallThickness: 0.02 },
        })
        expect(result.isError).toBeFalsy()
        const parsed = JSON.parse(
          (result.content as Array<{ type: string; text: string }>)[0]!.text,
        )
        expect(parsed.wallIds).toHaveLength(footprint.length)
        expect(
          (parsed.wallIds as AnyNodeId[]).map((wallId) => bridge.getNode(wallId)?.name),
        ).toEqual(footprint.map((_, index) => `Perimeter Wall ${index + 1}`))

        for (const wallId of parsed.wallIds as AnyNodeId[]) {
          const wall = bridge.getNode(wallId)
          if (wall?.type !== 'wall') throw new Error('Expected perimeter wall')
          expect(wall.parentId).toBe(level.id)

          const dx = wall.end[0] - wall.start[0]
          const dz = wall.end[1] - wall.start[1]
          const length = Math.hypot(dx, dz)
          const midpoint: Vec2 = [
            (wall.start[0] + wall.end[0]) / 2,
            (wall.start[1] + wall.end[1]) / 2,
          ]
          const frontPoint: Vec2 = [
            midpoint[0] - (dz / length) * 0.01,
            midpoint[1] + (dx / length) * 0.01,
          ]
          const backPoint: Vec2 = [
            midpoint[0] + (dz / length) * 0.01,
            midpoint[1] - (dx / length) * 0.01,
          ]
          expect(pointInPolygon(frontPoint, footprint, false)).toBe(wall.frontSide === 'interior')
          expect(pointInPolygon(backPoint, footprint, false)).toBe(wall.backSide === 'interior')
        }
      })
    }
  }

  test('create_story_shell writes walls only; the shell floor and ceiling are derived', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'create_story_shell',
      arguments: {
        levelId: level.id,
        footprint: [
          [-4, -3],
          [4, -3],
          [4, 3],
          [-4, 3],
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    const children = Object.values(bridge.getNodes()).filter((n) => n.parentId === level.id)
    expect(children.filter((n) => n.type === 'wall')).toHaveLength(4)
    expect(parsed.zoneIds).toHaveLength(1)
    const slabs = children.filter((n) => n.type === 'slab')
    const ceilings = children.filter((n) => n.type === 'ceiling')
    expect(slabs).toHaveLength(2)
    expect(slabs.find((slab) => slab.plateRole === 'platform')).toMatchObject({
      id: parsed.slabId,
      boundary: 'auto',
      elevation: 0.1,
      thickness: 0.05,
    })
    expect(slabs.find((slab) => slab.plateRole === 'base')).toMatchObject({
      elevation: 0.05,
      thickness: 0.05,
    })
    expect(ceilings).toHaveLength(1)
    expect(ceilings[0]).toMatchObject({ id: parsed.ceilingId, boundary: 'auto' })
    expect((ceilings[0] as { zoneId?: string }).zoneId).toBe(parsed.zoneIds[0])
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('create_story_shell records hasFloor / hasCeiling when they are declined', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'create_story_shell',
      arguments: {
        levelId: level.id,
        footprint: [
          [-4, -3],
          [4, -3],
          [4, 3],
          [-4, 3],
        ],
        createSlab: false,
        createCeiling: false,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.slabId).toBeNull()
    expect(parsed.ceilingId).toBeNull()
    const children = Object.values(bridge.getNodes()).filter((n) => n.parentId === level.id)
    expect(children.filter((n) => n.type === 'slab')).toHaveLength(0)
    expect(children.filter((n) => n.type === 'ceiling')).toHaveLength(0)
    expect(bridge.getNode(parsed.zoneIds[0])).toMatchObject({
      hasFloor: false,
      hasCeiling: false,
    })
  })

  test('create_story_shell creates level-owned walls plus slab and ceiling', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'create_story_shell',
      arguments: {
        levelId: level.id,
        footprint: [
          [-4, -3],
          [4, -3],
          [4, 3],
          [-4, 3],
        ],
        wallHeight: 2.8,
        namePrefix: 'Ground',
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.wallIds).toHaveLength(4)
    expect(parsed.slabId).toMatch(/^slab_/)
    expect(parsed.ceilingId).toMatch(/^ceiling_/)

    for (const wallId of parsed.wallIds) {
      const wall = bridge.getNode(wallId)
      expect(wall?.parentId).toBe(level.id)
      expect(wall?.type).toBe('wall')
      if (wall?.type === 'wall') expect(wall.height).toBe(2.8)
    }
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('create_stair_between_levels creates one persistent floor opening', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const ground = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const upper = LevelNode.parse({ name: 'Second Floor', level: 1, metadata: { height: 2.8 } })
    bridge.createNode(upper, building.id)

    for (const level of [ground, upper]) {
      const result = await client.callTool({
        name: 'create_story_shell',
        arguments: {
          levelId: level.id,
          footprint: [
            [-4, -3],
            [4, -3],
            [4, 3],
            [-4, 3],
          ],
          wallHeight: 2.8,
        },
      })
      expect(result.isError).toBeFalsy()
    }

    const result = await client.callTool({
      name: 'create_stair_between_levels',
      arguments: {
        fromLevelId: ground.id,
        toLevelId: upper.id,
        position: [0, 0, -1],
        width: 1,
        runLength: 3,
        totalRise: 2.8,
        openingOffset: 0.2,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.openingPolygon).toHaveLength(4)
    expect(parsed.openingIds).toHaveLength(1)
    expect(bridge.getNode(parsed.openingIds[0])).toMatchObject({
      type: 'floor-opening',
      source: 'stair',
      polygon: parsed.openingPolygon,
      cutsPrimary: true,
      cutsAdjacent: true,
    })

    const stair = bridge.getNode(parsed.stairId)
    expect(stair?.type).toBe('stair')
    if (stair?.type === 'stair') expect(stair.slabOpeningMode).toBe('none')

    const destinationSlab = bridge.getNode(parsed.destinationSlabId)
    expect(destinationSlab?.type).toBe('slab')
    if (destinationSlab?.type === 'slab') {
      expect(destinationSlab.holes).toHaveLength(1)
      expect(destinationSlab.holes[0]).toHaveLength(4)
      expect(destinationSlab.holeMetadata).toEqual([
        { source: 'floor-opening', openingId: parsed.openingIds[0] },
      ])
    }

    const sourceCeiling = bridge.getNode(parsed.sourceCeilingId)
    expect(sourceCeiling?.type).toBe('ceiling')
    if (sourceCeiling?.type === 'ceiling') {
      expect(sourceCeiling.holes).toHaveLength(1)
      expect(sourceCeiling.holes[0]).toHaveLength(4)
      expect(sourceCeiling.holeMetadata).toEqual([
        { source: 'floor-opening', openingId: parsed.openingIds[0] },
      ])
    }
    bridge.clearHistory()
    bridge.updateNode(parsed.stairId, { position: [1, 0, -1] })
    const movedOpening = bridge.getNode(parsed.openingIds[0])
    expect(movedOpening?.type).toBe('floor-opening')
    if (movedOpening?.type === 'floor-opening')
      expect(movedOpening.polygon[0]?.[0]).toBeCloseTo(parsed.openingPolygon[0][0] + 1)
    expect(bridge.getHistory().pastCount).toBe(1)
    expect(bridge.undo()).toBe(1)
    const restored = bridge.getNode(parsed.openingIds[0])
    if (restored?.type === 'floor-opening') expect(restored.polygon).toEqual(parsed.openingPolygon)
    expect(bridge.redo()).toBe(1)
    bridge.deleteNode(parsed.stairId, true)
    expect(bridge.getNode(parsed.openingIds[0])).toBeNull()
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('create_stair_between_levels defaults opening offset to zero', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const ground = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const upper = LevelNode.parse({ name: 'Second Floor', level: 1, metadata: { height: 2.8 } })
    bridge.createNode(upper, building.id)

    for (const level of [ground, upper]) {
      const result = await client.callTool({
        name: 'create_story_shell',
        arguments: {
          levelId: level.id,
          footprint: [
            [-4, -3],
            [4, -3],
            [4, 3],
            [-4, 3],
          ],
          wallHeight: 2.8,
        },
      })
      expect(result.isError).toBeFalsy()
    }

    const result = await client.callTool({
      name: 'create_stair_between_levels',
      arguments: {
        fromLevelId: ground.id,
        toLevelId: upper.id,
        position: [0, 0, -1],
        width: 1,
        runLength: 3,
        totalRise: 2.8,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    const stair = bridge.getNode(parsed.stairId)

    expect(stair?.type).toBe('stair')
    if (stair?.type === 'stair') expect(stair.openingOffset).toBe(0)
  })

  test('verify_scene flags suspicious multi-story wall heights', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const ground = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const upper = LevelNode.parse({ name: 'Second Floor', level: 1, metadata: { height: 2.8 } })
    bridge.createNode(upper, building.id)

    const shell = await client.callTool({
      name: 'create_story_shell',
      arguments: {
        levelId: ground.id,
        footprint: [
          [-4, -3],
          [4, -3],
          [4, 3],
          [-4, 3],
        ],
        wallHeight: 5.6,
      },
    })
    expect(shell.isError).toBeFalsy()

    const result = await client.callTool({ name: 'verify_scene', arguments: {} })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.hasIssues).toBe(true)
    expect(parsed.issues.map((issue: { message: string }) => issue.message).join('\n')).toContain(
      'multi-story exterior walls should be split',
    )
  })

  test('create_roof creates a dedicated roof level by default', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'create_roof',
      arguments: { levelId: level.id, width: 8, depth: 6, roofType: 'gable' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    const roofLevel = bridge.getNode(parsed.roofLevelId)
    const roof = bridge.getNode(parsed.roofId)
    const segment = bridge.getNode(parsed.roofSegmentId)
    expect(parsed.createdRoofLevelId).toBe(parsed.roofLevelId)
    expect(roofLevel?.parentId).toBe(building.id)
    expect(roofLevel?.type).toBe('level')
    if (roofLevel?.type === 'level') {
      expect(roofLevel.level).toBe(level.type === 'level' ? level.level + 1 : 1)
      expect(roofLevel.metadata).toMatchObject({ role: 'roof', referenceLevelId: level.id })
    }
    expect(roof?.parentId).toBe(parsed.roofLevelId)
    expect(roof?.type).toBe('roof')
    expect(segment?.parentId).toBe(parsed.roofId)
    expect(segment?.type).toBe('roof-segment')
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('story construction tools reject dedicated roof support levels', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const roofLevel = LevelNode.parse({
      name: 'Roof',
      level: 1,
      children: [],
      metadata: { role: 'roof', referenceLevelId: level.id },
    })
    bridge.createNode(roofLevel, building.id)

    const shell = await client.callTool({
      name: 'create_story_shell',
      arguments: {
        levelId: roofLevel.id,
        footprint: [
          [-4, -3],
          [4, -3],
          [4, 3],
          [-4, 3],
        ],
      },
    })
    expect(shell.isError).toBe(true)

    const stair = await client.callTool({
      name: 'create_stair_between_levels',
      arguments: {
        fromLevelId: level.id,
        toLevelId: roofLevel.id,
        position: [0, 0, 0],
        runLength: 3,
        totalRise: 2.8,
      },
    })
    expect(stair.isError).toBe(true)
  })

  test('create_roof requires an explicit roof support level when roofLevelId is provided', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const occupiedUpper = LevelNode.parse({
      name: 'Second Floor',
      level: 1,
      children: [],
    })
    bridge.createNode(occupiedUpper, building.id)

    const result = await client.callTool({
      name: 'create_roof',
      arguments: {
        levelId: level.id,
        roofLevelId: occupiedUpper.id,
        width: 8,
        depth: 6,
      },
    })
    expect(result.isError).toBe(true)
  })

  test('verify_scene flags roofs mixed into occupied levels', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    await client.callTool({
      name: 'create_story_shell',
      arguments: {
        levelId: level.id,
        footprint: [
          [-4, -3],
          [4, -3],
          [4, 3],
          [-4, 3],
        ],
      },
    })

    const roof = await client.callTool({
      name: 'create_roof',
      arguments: {
        levelId: level.id,
        width: 8,
        depth: 6,
        useDedicatedRoofLevel: false,
      },
    })
    expect(roof.isError).toBeFalsy()

    const result = await client.callTool({ name: 'verify_scene', arguments: {} })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.hasIssues).toBe(true)
    expect(parsed.issues.map((issue: { message: string }) => issue.message).join('\n')).toContain(
      'dedicated roof level',
    )
  })
})
