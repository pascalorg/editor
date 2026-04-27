import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LevelNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerRoomTools } from './room-tools'

describe('room tools', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerRoomTools(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('search_assets returns built-in catalog matches', async () => {
    const result = await client.callTool({
      name: 'search_assets',
      arguments: { query: 'sofa' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.total).toBeGreaterThan(0)
    expect(parsed.results.map((item: { id: string }) => item.id)).toContain('sofa')
  })

  test('create_room creates a valid zone/slab/ceiling/wall bundle', async () => {
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
    expect(parsed.slabId).toMatch(/^slab_/)
    expect(parsed.ceilingId).toMatch(/^ceiling_/)
    expect(parsed.wallIds).toHaveLength(4)
    expect(parsed.areaSqMeters).toBe(12)
    expect(bridge.validateScene().valid).toBe(true)
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
    expect(
      (bridge.getNode(door.doorId) as { position: [number, number, number] }).position[0],
    ).toBeCloseTo(2.5, 3)

    const windowResult = await client.callTool({
      name: 'add_window',
      arguments: { wallId, t: 0.25, width: 1, height: 1, sillHeight: 1 },
    })
    const win = JSON.parse((windowResult.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(win.localX).toBeCloseTo(1.25, 3)
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

    const windowResult = await client.callTool({
      name: 'add_window',
      arguments: { wallId, position: 0.75, width: 1 },
    })
    const win = JSON.parse((windowResult.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(win.localX).toBeCloseTo(4.5, 3)
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
})
