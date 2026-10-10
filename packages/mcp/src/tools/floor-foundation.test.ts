import { expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  floorFootprintSupportClass,
  getLevelElevations,
  LevelNode,
  SlabNode,
} from '@pascal-app/core'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

test('set_floor_foundation sets one footprint in one call and one undo; raw updates preserve intent', async () => {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = createPascalMcpServer({ bridge })
  const [st, ct] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'foundation-contract', version: '1' })
  await Promise.all([server.connect(st), client.connect(ct)])
  try {
    const levelId = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!.id
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError, JSON.stringify(result)).toBeFalsy()
      return result.structuredContent as { changes: number; conflicts?: unknown[] }
    }
    await call('create_room', {
      levelId,
      name: 'House',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    await call('create_room', {
      levelId,
      name: 'Shed',
      polygon: [
        [10, 0],
        [12, 0],
        [12, 2],
        [10, 2],
      ],
    })
    const plates = Object.values(bridge.getNodes()).filter(
      (n): n is SlabNode => n.type === 'slab' && n.plateRole === 'base',
    )
    const house = plates.find((n) => n.polygon[0]![0] < 5)!
    const shed = plates.find((n) => n.id !== house.id)!
    const upper = LevelNode.parse({
      id: 'level_foundation_upper',
      level: 1,
      parentId: bridge.getNode(levelId)!.parentId,
    })
    bridge.createNode(upper, upper.parentId as never)
    const upperSlab = SlabNode.parse({
      id: 'slab_foundation_upper',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    bridge.createNode(upperSlab, upper.id)
    const before = bridge.getNodes()
    bridge.clearHistory()
    const result = await call('set_floor_foundation', {
      slabId: house.id,
      patch: {
        floorHeight: 0.55,
        thickness: 0.15,
        foundation: { type: 'solid', material: 'library:concrete-raw' },
      },
    })
    expect(result.conflicts).toEqual([])
    expect(bridge.getNode(house.id)).toMatchObject({
      floorHeight: 0.55,
      elevation: 0.55,
      thickness: 0.15,
      foundation: { type: 'solid', material: 'library:concrete-raw' },
    })
    expect(bridge.getNode(shed.id)).toEqual(shed)
    expect(
      getLevelElevations(bridge.getNodes()).get(upper.id)!.baseY -
        getLevelElevations(before).get(upper.id)!.baseY,
    ).toBeCloseTo(0.5)
    for (const wall of Object.values(bridge.getNodes()).filter((node) => node.type === 'wall'))
      expect(wall).not.toHaveProperty('height')
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(bridge.getNodes()).toEqual(before)
    bridge.updateNode(house.id, { floorHeight: 0.35, foundation: { type: 'solid' } })
    expect(bridge.getNode(house.id)).toMatchObject({
      floorHeight: 0.35,
      elevation: 0.35,
      foundation: { type: 'solid' },
    })
    expect(() => bridge.updateNode(house.id, { elevation: 0.6 })).toThrow('set_floor_foundation')
    bridge.undo()
    bridge.updateNode(upperSlab.id, {
      polygon: [
        [0, 0],
        [12, 0],
        [12, 4],
        [0, 4],
      ],
    })
    const unchanged = bridge.getNodes()
    const conflict = await call('set_floor_foundation', {
      slabId: house.id,
      patch: { floorHeight: 0.55 },
    })
    expect(conflict.conflicts?.[0]).toMatchObject({
      code: 'floor-foundation-shared-storey',
      message: 'The upper floor also sits over Shed floor; raise both or neither.',
    })
    expect(bridge.getNodes()).toEqual(unchanged)
    expect(() => bridge.updateNode(house.id, { floorHeight: 0.55 })).toThrow(
      'raise both or neither',
    )
    bridge.clearHistory()
    const both = await call('set_floor_foundation', {
      slabIds: [house.id, shed.id],
      patch: { floorHeight: 0.55, foundation: { type: 'solid', material: 'library:concrete-raw' } },
    })
    expect(both.conflicts).toEqual([])
    expect(bridge.getNode(shed.id)).toMatchObject({ floorHeight: 0.55 })
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(bridge.getNodes()).toEqual(unchanged)
    const refused = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId,
        name: 'Overlapping terrace',
        polygon: [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ],
        outdoor: true,
      },
    })
    expect(refused.isError).toBe(true)
    expect(
      JSON.parse((refused.content as Array<{ type: string; text: string }>)[0]!.text),
    ).toMatchObject({
      code: 'outdoor_room_overlap',
      conflicts: [{ code: 'outdoor-room-overlap' }],
    })
    expect(bridge.getNodes()).toEqual(unchanged)
  } finally {
    await client.close()
    await server.close()
  }
})

test('set_floor_foundation and raw thickness edits lift a supported upper plate without a foundation', async () => {
  const bridge = new SceneBridge()
  // The store is shared with the test before, which built a room named House on this polygon.
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = createPascalMcpServer({ bridge })
  const [st, ct] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'upper-floor-contract', version: '1' })
  await Promise.all([server.connect(st), client.connect(ct)])
  try {
    const lower = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    const polygon = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError, JSON.stringify(result)).toBeFalsy()
      return result.structuredContent as { conflicts?: Array<{ code: string }> }
    }
    await call('create_room', { levelId: lower.id, name: 'Ground room', polygon })
    const upper = LevelNode.parse({
      id: 'level_supported_upper',
      level: 1,
      parentId: Object.values(bridge.getNodes()).find((node) => node.type === 'building')!.id,
    })
    bridge.createNode(upper, upper.parentId as never)
    await call('create_room', { levelId: upper.id, name: 'Upper room', polygon })
    const plate = Object.values(bridge.getNodes()).find(
      (node): node is SlabNode =>
        node.type === 'slab' && node.plateRole === 'base' && node.parentId === upper.id,
    )!
    const groundPlate = Object.values(bridge.getNodes()).find(
      (node): node is SlabNode =>
        node.type === 'slab' && node.plateRole === 'base' && node.parentId === lower.id,
    )!
    expect(floorFootprintSupportClass(bridge.getNodes(), plate)).toBe('supported')
    const before = getLevelElevations(bridge.getNodes()).get(upper.id)!.baseY
    const result = await call('set_floor_foundation', {
      slabId: plate.id,
      patch: { thickness: 0.3 },
    })
    expect(result.conflicts).toEqual([])
    expect(bridge.getNode(plate.id)).toMatchObject({ thickness: 0.3, elevation: 0.3 })
    expect((bridge.getNode(plate.id) as SlabNode).floorHeight).toBeUndefined()
    expect(bridge.getNode(groundPlate.id)).toEqual(groundPlate)
    expect(getLevelElevations(bridge.getNodes()).get(upper.id)!.baseY).toBe(before)
    expect(() => bridge.updateNode(plate.id, { foundation: { type: 'solid' } })).toThrow(
      'Only a plate at ground contact can have a solid foundation',
    )
    bridge.updateNode(plate.id, { thickness: 0.4 })
    expect(bridge.getNode(plate.id)).toMatchObject({ thickness: 0.4, elevation: 0.4 })
    expect((bridge.getNode(plate.id) as SlabNode).floorHeight).toBeUndefined()
    const height = await call('set_floor_foundation', {
      slabId: plate.id,
      patch: { floorHeight: 0.6 },
    })
    expect(height.conflicts).toEqual([])
    expect(bridge.getNode(plate.id)).toMatchObject({ thickness: 0.6, elevation: 0.6 })
    expect((bridge.getNode(plate.id) as SlabNode).floorHeight).toBeUndefined()
  } finally {
    await client.close()
    await server.close()
  }
})

test('room-owned floor construction and reference rebase are single MCP undo steps', async () => {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = createPascalMcpServer({ bridge })
  const [st, ct] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'room-floor-contract', version: '1' })
  await Promise.all([server.connect(st), client.connect(ct)])
  try {
    const levelId = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!.id
    const polygon = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    const created = await client.callTool({
      name: 'create_room',
      arguments: { levelId, polygon, name: 'Owned floor' },
    })
    expect(created.isError).toBeFalsy()
    const zone = Object.values(bridge.getNodes()).find(
      (node) => node.type === 'zone' && node.parentId === levelId,
    )!
    const plate = Object.values(bridge.getNodes()).find(
      (node): node is SlabNode =>
        node.type === 'slab' && node.plateRole === 'base' && node.zoneIds.includes(zone.id),
    )!
    const original = bridge.getNodes()
    bridge.clearHistory()
    const edit = await client.callTool({
      name: 'set_room_floor_construction',
      arguments: { zoneId: zone.id, patch: { thickness: 0.18 } },
    })
    expect(edit.isError).toBeFalsy()
    expect(bridge.getNode(plate.id)).toMatchObject({ thickness: 0.18 })
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(bridge.getNodes()).toEqual(original)

    const rebase = await client.callTool({
      name: 'rebase_floor_reference',
      arguments: { slabId: plate.id, referenceFloorElevation: 0.1 },
    })
    expect(rebase.isError).toBeFalsy()
    expect(bridge.getNode(plate.id)).toMatchObject({
      referenceFloorElevation: 0.1,
      elevation: plate.elevation,
    })
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(bridge.getNodes()).toEqual(original)
  } finally {
    await client.close()
    await server.close()
  }
})
