import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getLevelElevations, getWallPlaneTop } from '@pascal-app/core'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerRoomTools } from './room-tools'
import { registerSharedTools } from './shared-tools'
import { registerStructureTools } from './structure-tools'

describe('duplicate_level', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSharedTools(server, bridge)
    registerRoomTools(server, bridge)
    registerStructureTools(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('duplicates a level with its wall descendants', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [3, 0] })
    bridge.createNode(wall, level.id)

    const result = await client.callTool({
      name: 'duplicate_level',
      arguments: { levelId: level.id },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.newLevelId).toMatch(/^level_/)
    expect(parsed.newLevelId).not.toBe(level.id)
    expect(parsed.newNodeIds.length).toBeGreaterThanOrEqual(2)

    const newLevel = bridge.getNode(parsed.newLevelId)
    expect(newLevel).not.toBeNull()
    expect(newLevel!.type).toBe('level')
  })

  test('copies a level with automatic room surfaces and can undo the copy', async () => {
    const level = bridge.findNodes({ type: 'level' })[0]!
    const room = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Room',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
    })
    expect(room.isError).toBeFalsy()
    expect(bridge.findNodes({ type: 'ceiling' })[0]).toMatchObject({ boundary: 'auto' })
    bridge.clearHistory()
    const before = bridge.exportJSON()
    const result = await client.callTool({
      name: 'duplicate_level',
      arguments: { levelId: level.id },
    })
    expect(result.isError).toBeFalsy()
    const { newLevelId } = result.structuredContent as { newLevelId: string }
    expect(bridge.findNodes({ type: 'ceiling', levelId: newLevelId as never })).toHaveLength(1)
    expect(bridge.validateScene().valid).toBe(true)
    expect(bridge.undo(1)).toBe(1)
    expect(bridge.exportJSON()).toEqual(before)
  })

  for (const position of ['above', 'below'] as const) {
    test(`copies a foundation ${position} through MCP with one regenerated plate and no gap`, async () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args })
        expect(result.isError, JSON.stringify(result)).toBeFalsy()
        return result.structuredContent as { newLevelId: string; name: string }
      }
      await call('create_room', {
        levelId: level.id,
        name: 'House',
        polygon: [
          [0, 0],
          [6, 0],
          [6, 4],
          [0, 4],
        ],
      })
      const plate = bridge.findNodes({ type: 'slab' })[0]!
      await call('set_floor_foundation', {
        slabId: plate.id,
        patch: { thickness: 0.2, foundationHeight: 0.6 },
      })
      bridge.clearHistory()
      const before = bridge.exportJSON()
      const result = await call('duplicate_level', { levelId: level.id, position })
      expect(result.name).toBe(position === 'above' ? 'Floor 1' : 'Ground floor')
      const nodes = bridge.getNodes()
      const lowerId = position === 'above' ? level.id : result.newLevelId
      const upperId = position === 'above' ? result.newLevelId : level.id
      const plates = bridge.findNodes({ type: 'slab' })
      expect(plates).toHaveLength(2)
      const upper = plates.find((node) => node.parentId === upperId)!
      expect(upper).toMatchObject({
        thickness: 0.2,
        foundation: { type: 'none' },
        boundary: 'auto',
      })
      if (upper.type !== 'slab') throw new Error('missing plate')
      expect(upper.floorHeight).toBeUndefined()
      const wall = bridge.findNodes({ type: 'wall', levelId: lowerId as never })[0]!
      if (wall.type !== 'wall') throw new Error('missing wall')
      const elevations = getLevelElevations(nodes)
      expect(elevations.get(upperId)!.baseY + upper.elevation - upper.thickness).toBeCloseTo(
        elevations.get(lowerId)!.baseY + getWallPlaneTop(wall, lowerId, nodes),
        6,
      )
      expect(bridge.validateScene().valid).toBe(true)
      expect(bridge.undo(1)).toBe(1)
      expect(bridge.exportJSON()).toEqual(before)
    })
  }

  test('rejects unknown id', async () => {
    const result = await client.callTool({
      name: 'duplicate_level',
      arguments: { levelId: 'level_nope' },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects non-level target', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const result = await client.callTool({
      name: 'duplicate_level',
      arguments: { levelId: building.id },
    })
    expect(result.isError).toBe(true)
  })
})
