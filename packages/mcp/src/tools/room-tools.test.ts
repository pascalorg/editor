import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { CeilingNode, LevelNode, SlabNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerRoomTools } from './room-tools'
import { registerSharedTools } from './shared-tools'

describe('room tools', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSharedTools(server, bridge)
    registerRoomTools(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('create_room writes walls and a room zone only; floor and ceiling are derived', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Bedroom',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.zoneId).toMatch(/^zone_/)
    expect(parsed.wallIds).toHaveLength(4)
    expect(parsed.reusedWalls).toBe(0)
    expect(parsed.areaSqMeters).toBe(12)

    const children = Object.values(bridge.getNodes()).filter((n) => n.parentId === level.id)
    const zones = children.filter((n) => n.type === 'zone')
    const slabs = children.filter((n) => n.type === 'slab')
    const ceilings = children.filter((n) => n.type === 'ceiling')
    expect(children.filter((n) => n.type === 'wall')).toHaveLength(4)
    expect(zones).toHaveLength(1)
    expect(zones[0]).toMatchObject({ id: parsed.zoneId, name: 'Bedroom', spaceRole: 'room' })

    // Both surfaces exist only because the reconciler derived them.
    expect(slabs).toHaveLength(1)
    expect(slabs[0]).toMatchObject({ id: parsed.slabId, boundary: 'auto' })
    expect((slabs[0] as { zoneIds?: string[] }).zoneIds).toContain(parsed.zoneId)
    expect(ceilings).toHaveLength(1)
    expect(ceilings[0]).toMatchObject({
      id: parsed.ceilingId,
      boundary: 'auto',
      zoneId: parsed.zoneId,
    })
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('create_room outdoor: a terrace with separators and no walls or ceiling', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Terrace',
        outdoor: true,
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.wallIds).toEqual([null, null, null, null])
    expect(parsed.ceilingId).toBeNull()
    const children = Object.values(bridge.getNodes()).filter((n) => n.parentId === level.id)
    expect(children.filter((n) => n.type === 'wall')).toHaveLength(0)
    expect(children.filter((n) => n.type === 'separator')).toHaveLength(4)
    expect(children.filter((n) => n.type === 'ceiling')).toHaveLength(0)
    expect(children.find((n) => n.id === parsed.zoneId)).toMatchObject({
      name: 'Terrace',
      spaceRole: 'room',
      hasCeiling: false,
    })
    // It still stands on a derived floor, like any room.
    expect(parsed.slabId).toMatch(/^slab_/)
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('create_room reuses the shared wall of an adjacent room', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const call = (name: string, polygon: number[][]) =>
      client.callTool({ name: 'create_room', arguments: { levelId: level.id, name, polygon } })
    const first = await call('Kitchen', [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    expect(first.isError).toBeFalsy()
    const second = await call('Dining', [
      [0, 3],
      [4, 3],
      [4, 6],
      [0, 6],
    ])
    expect(second.isError).toBeFalsy()
    const parsed = JSON.parse((second.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.reusedWalls).toBe(1)

    const children = Object.values(bridge.getNodes()).filter((n) => n.parentId === level.id)
    expect(children.filter((n) => n.type === 'wall')).toHaveLength(7)
    expect(children.filter((n) => n.type === 'zone')).toHaveLength(2)
    expect(children.filter((n) => n.type === 'ceiling')).toHaveLength(2)
    // Two rooms with the same construction share one floor plate.
    expect(children.filter((n) => n.type === 'slab')).toHaveLength(1)
  })

  test('the bridge refuses derived construction with a clear message', () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const polygon: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    expect(() =>
      bridge.createNode(SlabNode.parse({ polygon, boundary: 'auto' }), level.id as AnyNodeId),
    ).toThrow(/Refusing to create the derived slab/)
    expect(() =>
      bridge.applyPatch([
        {
          op: 'create',
          node: CeilingNode.parse({ polygon, autoFromWalls: true }),
          parentId: level.id as AnyNodeId,
        },
      ]),
    ).toThrow(/Refusing to create the derived ceiling/)
    expect(Object.values(bridge.getNodes()).filter((n) => n.type === 'slab')).toHaveLength(0)
    expect(Object.values(bridge.getNodes()).filter((n) => n.type === 'ceiling')).toHaveLength(0)
  })

  test('create_room rejects dedicated roof support levels', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const roofLevel = LevelNode.parse({
      name: 'Roof',
      level: 1,
      metadata: { role: 'roof' },
      children: [],
    })
    bridge.createNode(roofLevel, building.id)

    const result = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: roofLevel.id,
        name: 'Accidental attic room',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
    })
    expect(result.isError).toBe(true)
  })

  test('add_door and add_window convert t to wall-local meters', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const roomResult = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Living',
        polygon: [
          [0, 0],
          [5, 0],
          [5, 4],
          [0, 4],
        ],
      },
    })
    const room = JSON.parse((roomResult.content as Array<{ type: string; text: string }>)[0]!.text)
    const wallId = room.wallIds[0]

    const doorResult = await client.callTool({
      name: 'add_door',
      arguments: { wallId, t: 0.5 },
    })
    const door = JSON.parse((doorResult.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(door.localX).toBeCloseTo(2.5, 3)
    expect(door.t).toBe(0.5)
    expect(door.position).toBe(0.5)
    expect(door.wallLength).toBeCloseTo(5, 3)
    expect(door.coordinateSystem).toBe('wall-local-meters')
    expect(
      (bridge.getNode(door.doorId) as { position: [number, number, number] }).position[0],
    ).toBeCloseTo(2.5, 3)

    const windowResult = await client.callTool({
      name: 'add_window',
      arguments: { wallId, t: 0.25, width: 1, height: 1, sillHeight: 1 },
    })
    const win = JSON.parse((windowResult.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(win.localX).toBeCloseTo(1.25, 3)
    expect(win.t).toBe(0.25)
    expect(win.position).toBe(0.25)
    expect(win.wallLength).toBeCloseTo(5, 3)
    expect(win.coordinateSystem).toBe('wall-local-meters')
    expect(
      (bridge.getNode(win.windowId) as { position: [number, number, number] }).position[1],
    ).toBe(1.5)
  })

  test('add_door and add_window accept position as a t alias', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const roomResult = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Entry',
        polygon: [
          [0, 0],
          [6, 0],
          [6, 3],
          [0, 3],
        ],
      },
    })
    const room = JSON.parse((roomResult.content as Array<{ type: string; text: string }>)[0]!.text)
    const wallId = room.wallIds[0]

    const doorResult = await client.callTool({
      name: 'add_door',
      arguments: { wallId, position: 0.25 },
    })
    const door = JSON.parse((doorResult.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(door.localX).toBeCloseTo(1.5, 3)
    expect(door.t).toBe(0.25)

    const windowResult = await client.callTool({
      name: 'add_window',
      arguments: { wallId, position: 0.75, width: 1 },
    })
    const win = JSON.parse((windowResult.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(win.localX).toBeCloseTo(4.5, 3)
    expect(win.t).toBe(0.75)
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('furnish_room parents floor items to the level and keeps the scene valid', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'furnish_room',
      arguments: {
        levelId: level.id,
        roomType: 'bedroom',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        doorWallIndex: 0,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.placed).toBeGreaterThan(0)
    for (const itemId of parsed.itemIds) {
      expect(bridge.getNode(itemId)?.parentId).toBe(level.id)
    }
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('furnish_room can infer level and polygon from zoneId', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const roomResult = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Bedroom',
        polygon: [
          [0, 0],
          [5, 0],
          [5, 4],
          [0, 4],
        ],
      },
    })
    const room = JSON.parse((roomResult.content as Array<{ type: string; text: string }>)[0]!.text)
    const result = await client.callTool({
      name: 'furnish_room',
      arguments: {
        zoneId: room.zoneId,
        roomType: 'bedroom',
        doorWallIndex: 0,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.placed).toBeGreaterThan(0)
    for (const itemId of parsed.itemIds) {
      expect(bridge.getNode(itemId)?.parentId).toBe(level.id)
    }
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('furnish_room never leaves items blocking doors after bathroom layout', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const roomResult = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Bath',
        polygon: [
          [0, 0],
          [2.75, 0],
          [2.75, 2.5],
          [0, 2.5],
        ],
      },
    })
    const room = JSON.parse((roomResult.content as Array<{ type: string; text: string }>)[0]!.text)
    // Door on north wall (index 2) — same geometry as the blocked master-suite bath.
    await client.callTool({
      name: 'add_door',
      arguments: { wallId: room.wallIds[2], t: 0.5, width: 0.8 },
    })

    const furnish = await client.callTool({
      name: 'furnish_room',
      arguments: {
        zoneId: room.zoneId,
        roomType: 'bathroom',
        doorWallIndex: 0,
      },
    })
    expect(furnish.isError).toBeFalsy()
    const parsed = JSON.parse((furnish.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.placed + parsed.skipped.length).toBeGreaterThan(0)

    const { findBlockedDoors } = await import('@pascal-app/core/agent-operations')
    const blocked = findBlockedDoors({ nodes: Object.values(bridge.getNodes()) })
    expect(blocked).toEqual([])
    // If the heuristic wanted a fixture in the clear zone, it must be skipped explicitly.
    for (const reason of parsed.skipped as string[]) {
      expect(typeof reason).toBe('string')
    }
  })

  test('furnish_room does not stack items on each other (overlap smart skip/nudge)', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    // Large bedroom so multiple placements exist; still must end with zero item–item overlaps.
    const roomResult = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Bedroom',
        polygon: [
          [0, 0],
          [6, 0],
          [6, 5],
          [0, 5],
        ],
      },
    })
    const room = JSON.parse((roomResult.content as Array<{ type: string; text: string }>)[0]!.text)
    await client.callTool({
      name: 'add_door',
      arguments: { wallId: room.wallIds[0], t: 0.5, width: 0.9 },
    })
    const furnish = await client.callTool({
      name: 'furnish_room',
      arguments: { zoneId: room.zoneId, roomType: 'bedroom', doorWallIndex: 0 },
    })
    expect(furnish.isError).toBeFalsy()
    const { findItemItemCollisions, findBlockedDoors } = await import(
      '@pascal-app/core/agent-operations'
    )
    const nodes = Object.values(bridge.getNodes())
    expect(findItemItemCollisions({ nodes })).toEqual([])
    expect(findBlockedDoors({ nodes })).toEqual([])
  })

  test('furnish_room records door-clearance skips when a door sits on the furniture wall', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    // Large bedroom so bed placement is near the "back" wall (edge opposite doorWallIndex).
    const roomResult = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Bedroom',
        polygon: [
          [0, 0],
          [5.5, 0],
          [5.5, 4],
          [0, 4],
        ],
      },
    })
    const room = JSON.parse((roomResult.content as Array<{ type: string; text: string }>)[0]!.text)
    // doorWallIndex default 0 → back wall is edge 2 (north). Put a door there so bed on back wall is blocked.
    await client.callTool({
      name: 'add_door',
      arguments: { wallId: room.wallIds[2], t: 0.5, width: 0.9 },
    })

    const furnish = await client.callTool({
      name: 'furnish_room',
      arguments: {
        zoneId: room.zoneId,
        roomType: 'bedroom',
        doorWallIndex: 0,
      },
    })
    expect(furnish.isError).toBeFalsy()
    const parsed = JSON.parse((furnish.content as Array<{ type: string; text: string }>)[0]!.text)
    const { findBlockedDoors } = await import('@pascal-app/core/agent-operations')
    expect(findBlockedDoors({ nodes: Object.values(bridge.getNodes()) })).toEqual([])
    // Bed is placed against the back wall where the door is; expect clearance skip or empty bed.
    const bedPlaced = Object.values(bridge.getNodes()).some(
      (n) => n.type === 'item' && (n.name === 'Double Bed' || n.name === 'Single Bed'),
    )
    const doorSkips = (parsed.skipped as string[]).filter((s) =>
      s.includes('blocks door clearance'),
    )
    expect(bedPlaced || doorSkips.length > 0).toBe(true)
    if (bedPlaced) {
      expect(doorSkips.length).toBe(0)
    }
  })
})
