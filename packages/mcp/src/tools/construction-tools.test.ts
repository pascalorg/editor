import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LevelNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerConstructionTools } from './construction-tools'
import { registerSceneQueryTools } from './scene-query'

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
    registerSceneQueryTools(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  afterEach(async () => {
    await client.close()
    await server.close()
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

  test('create_stair_between_levels creates one rectangular manual opening', async () => {
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

    const stair = bridge.getNode(parsed.stairId)
    expect(stair?.type).toBe('stair')
    if (stair?.type === 'stair') expect(stair.slabOpeningMode).toBe('none')

    const destinationSlab = bridge.getNode(parsed.destinationSlabId)
    expect(destinationSlab?.type).toBe('slab')
    if (destinationSlab?.type === 'slab') {
      expect(destinationSlab.holes).toHaveLength(1)
      expect(destinationSlab.holes[0]).toHaveLength(4)
      expect(destinationSlab.holeMetadata).toEqual([{ source: 'manual' }])
    }

    const sourceCeiling = bridge.getNode(parsed.sourceCeilingId)
    expect(sourceCeiling?.type).toBe('ceiling')
    if (sourceCeiling?.type === 'ceiling') {
      expect(sourceCeiling.holes).toHaveLength(1)
      expect(sourceCeiling.holes[0]).toHaveLength(4)
      expect(sourceCeiling.holeMetadata).toEqual([{ source: 'manual' }])
    }
    expect(bridge.validateScene().valid).toBe(true)
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
    expect(parsed.issues.join('\n')).toContain('multi-story exterior walls should be split')
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
    expect(parsed.issues.join('\n')).toContain('dedicated roof level')
  })
})
