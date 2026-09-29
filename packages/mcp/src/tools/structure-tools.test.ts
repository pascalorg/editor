import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DoorNode, ItemNode, WallNode } from '@pascal-app/core'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

describe('MCP structure adapters', () => {
  test('cut_floor_opening and remove_floor_opening round-trip room construction', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const server = createPascalMcpServer({ bridge })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'floor-opening-contract', version: '1' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args })
        expect(response.isError, JSON.stringify(response)).toBeFalsy()
        return response.structuredContent as Record<string, unknown>
      }
      const levelId = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!.id
      const room = await call('create_room', {
        levelId,
        name: 'Hall',
        polygon: [
          [0, 0],
          [6, 0],
          [6, 5],
          [0, 5],
        ],
      })
      const opened = await call('cut_floor_opening', {
        zoneId: room.zoneId,
        rect: { x: 2, z: 2, width: 1, depth: 1 },
      })
      const id = (opened.openingIds as string[])[0]!
      expect(bridge.getNode(id)).toMatchObject({ type: 'floor-opening', source: 'manual' })
      expect(
        Object.values(bridge.getNodes())
          .filter((node) => node.type === 'slab')
          .some((node) => node.holeMetadata.some((entry) => entry.openingId === id)),
      ).toBe(true)
      const summary = await call('get_level_summary', { levelId })
      expect(summary.openings).toEqual([expect.objectContaining({ id })])
      const removed = await call('remove_floor_opening', { id })
      expect(removed.openingId).toBe(id)
      expect(bridge.getNode(id)).toBeNull()
      expect(
        Object.values(bridge.getNodes())
          .filter((node) => node.type === 'slab')
          .some((node) => node.holeMetadata.some((entry) => entry.openingId === id)),
      ).toBe(false)
    } finally {
      await client.close()
      await server.close()
    }
  })
  for (const closed of [false, true]) {
    test(`divide_zone accepts a multi-point path and returns every separator (closed=${closed})`, async () => {
      const bridge = new SceneBridge()
      bridge.setScene({}, [])
      bridge.loadDefault()
      const server = createPascalMcpServer({ bridge })
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
      const client = new Client({ name: 'divide-path-contract', version: '1' })
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      try {
        const call = async (name: string, args: Record<string, unknown>) => {
          const response = await client.callTool({ name, arguments: args })
          expect(response.isError, JSON.stringify(response)).toBeFalsy()
          return response.structuredContent as Record<string, unknown>
        }
        const tools = await client.listTools()
        const schema = tools.tools.find((tool) => tool.name === 'divide_zone')!.inputSchema
        expect(schema.properties).toHaveProperty('path')
        expect(schema.properties).toHaveProperty('closed')
        const levelId = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!.id
        const { zoneId } = await call('create_room', {
          levelId,
          name: 'Room',
          polygon: [
            [0, 0],
            [8, 0],
            [8, 4],
            [0, 4],
          ],
        })
        const before = bridge.getNodes()
        bridge.clearHistory()
        const result = await call('divide_zone', {
          zoneId,
          closed,
          path: closed
            ? [
                [3, 1],
                [5, 1],
                [5, 3],
                [3, 3],
              ]
            : [
                [2, 0],
                [2, 2],
                [8, 2],
              ],
        })
        expect(result.conflicts).toBeUndefined()
        expect(result.separatorIds).toHaveLength(closed ? 4 : 2)
        expect(result.zoneIds).toHaveLength(2)
        const zones = Object.values(bridge.getNodes()).filter((n) => n.type === 'zone')
        expect(result.zoneIds).toEqual(zones.map((n) => n.id).sort())
        if (closed) expect(zones.find((n) => n.id === zoneId)!.holes).toHaveLength(1)
        expect(bridge.getHistory().pastCount).toBe(1)
        expect(bridge.undo()).toBe(1)
        expect(bridge.getNodes()).toEqual(before)
        const invalid = await call('divide_zone', {
          zoneId,
          closed: true,
          path: [
            [3, 1],
            [3.2, 1],
            [3.2, 1.2],
            [3, 1.2],
          ],
        })
        expect(invalid).toMatchObject({
          changes: 0,
          separatorIds: [],
          conflicts: [{ code: 'small-island' }],
        })
        expect(bridge.getNodes()).toEqual(before)
        expect(bridge.getHistory().pastCount).toBe(0)
      } finally {
        await client.close()
        await server.close()
      }
    })
  }
  test('listed schemas, intent, divide, merge and delete reconcile and undo', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = createPascalMcpServer({ bridge })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'structure-contract', version: '1' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'set_zone',
          'set_zone_intent',
          'divide_zone',
          'merge_zones',
          'delete_zone',
        ]),
      )
      expect(
        tools.tools.find((tool) => tool.name === 'set_zone_intent')?.annotations?.destructiveHint,
      ).toBe(false)
      const levelId = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!.id
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args })
        expect(response.isError).toBeFalsy()
        return response.structuredContent as Record<string, unknown>
      }
      const { zoneId } = await call('create_room', {
        levelId,
        name: 'Kitchen',
        polygon: [
          [0, 0],
          [8, 0],
          [8, 4],
          [0, 4],
        ],
      })
      await call('set_zone_intent', {
        zoneId,
        patch: { name: ' Studio ', floor: { finish: 'wood' }, hasCeiling: false },
      })
      expect(Object.values(bridge.getNodes()).filter((n) => n.type === 'ceiling')).toHaveLength(0)
      bridge.clearHistory()
      const split = await call('divide_zone', {
        zoneId,
        cut: [
          [2, 0],
          [2, 4],
        ],
      })
      expect(split.separatorId).toBeString()
      expect(bridge.getHistory().pastCount).toBe(1)
      const zones = Object.values(bridge.getNodes()).filter((n) => n.type === 'zone')
      expect(zones).toHaveLength(2)
      expect(split.zoneIds).toEqual(zones.map((n) => n.id).sort())
      await call('merge_zones', { zoneIds: zones.map((n) => n.id) })
      const survivor = Object.values(bridge.getNodes()).find((n) => n.type === 'zone')!
      bridge.clearHistory()
      const deletion = await call('delete_zone', { zoneId: survivor.id, contents: 'keep' })
      expect(deletion.payload).toMatchObject({
        zoneId: survivor.id,
        mode: 'delete',
        contents: 'keep',
        opensZoneIds: [],
      })
      expect(Object.values(bridge.getNodes()).filter((n) => n.type === 'zone')).toHaveLength(0)
      expect(bridge.getHistory().pastCount).toBe(1)
      expect(bridge.undo()).toBe(1)
      expect(bridge.getNode(survivor.id)).toBeDefined()
      const points: [number, number][] = [
        [-2, -2],
        [10, -2],
        [10, 6],
        [-2, 6],
      ]
      bridge.applyPatch(
        points.map((start, i) => ({
          op: 'create',
          node: WallNode.parse({ parentId: levelId, start, end: points[(i + 1) % 4] }),
          parentId: levelId as never,
        })),
      )
      bridge.deriveStructure()
      const boundaryIds = Object.values(bridge.getNodes())
        .filter((n) => n.type === 'wall' || n.type === 'separator')
        .map((n) => n.id)
        .sort()
      bridge.clearHistory()
      const before = bridge.getNode(survivor.id)
      const refused = await call('delete_zone', { zoneId: survivor.id, contents: 'keep' })
      expect(refused.payload).toMatchObject({
        zoneId: survivor.id,
        mode: 'blocked',
        wallIds: [],
        separatorIds: [],
      })
      expect(refused.changes).toBe(0)
      expect(refused.conflicts).toEqual([
        expect.objectContaining({
          code: 'shared-walls',
          message: 'To remove this room, delete one of its walls.',
        }),
      ])
      expect(bridge.getNode(survivor.id)).toEqual(before)
      expect(
        Object.values(bridge.getNodes())
          .filter((n) => n.type === 'wall' || n.type === 'separator')
          .map((n) => n.id)
          .sort(),
      ).toEqual(boundaryIds)
      expect(bridge.getHistory().pastCount).toBe(0)
      // A room Divide made merges back into its neighbour in one step.
      const halves = await call('divide_zone', {
        zoneId: survivor.id,
        cut: [
          [2, 0],
          [2, 4],
        ],
      })
      const other = halves.zoneIds.find((id: string) => id !== survivor.id)
      bridge.clearHistory()
      const merged = await call('delete_zone', { zoneId: other, contents: 'delete' })
      expect(merged.payload).toMatchObject({
        zoneId: other,
        mode: 'merge',
        mergedIntoZoneId: survivor.id,
        wallIds: [],
        separatorIds: [halves.separatorId],
      })
      expect(Object.values(bridge.getNodes()).filter((n) => n.type === 'separator')).toEqual([])
      expect(bridge.getNode(other)).toBeNull()
      expect(bridge.getNode(survivor.id)).toBeDefined()
      expect(bridge.getHistory().pastCount).toBe(1)
    } finally {
      await client.close()
      await server.close()
    }
  })
})

describe('MCP room transform contracts', () => {
  test('duplicate_zone keeps copied fixtures on the copied ceiling in one history step', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = createPascalMcpServer({ bridge })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'ceiling-copy-contract', version: '1' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const levelId = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!.id
      const created = await client.callTool({
        name: 'create_room',
        arguments: {
          levelId,
          name: 'Kitchen',
          polygon: [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
          ],
        },
      })
      expect(created.isError).toBeFalsy()
      const { zoneId } = created.structuredContent as { zoneId: string }
      const ceiling = Object.values(bridge.getNodes()).find((node) => node.type === 'ceiling')!
      const light = ItemNode.parse({
        parentId: ceiling.id,
        position: [2, -0.1, 2],
        asset: {
          id: 'light',
          category: 'lighting',
          name: 'Light',
          thumbnail: '',
          src: 'https://example.com/light.glb',
        },
      })
      bridge.applyPatch([{ op: 'create', node: light, parentId: ceiling.id }])
      const before = bridge.getNodes()
      bridge.clearHistory()
      const response = await client.callTool({
        name: 'duplicate_zone',
        arguments: { zoneId, translate: [6, 0] },
      })
      expect(response.isError, JSON.stringify(response)).toBeFalsy()
      const copy = response.structuredContent as { zoneId: string; idMap: Record<string, string[]> }
      const copiedCeiling = Object.values(bridge.getNodes()).find(
        (node) => node.type === 'ceiling' && node.zoneId === copy.zoneId,
      )!
      const copiedLightId = copy.idMap[light.id]![0]!
      expect(bridge.getNode(copy.zoneId)).toMatchObject({ name: 'Kitchen 2' })
      expect(bridge.getNode(copiedLightId)).toMatchObject({
        parentId: copiedCeiling.id,
        position: [8, -0.1, 2],
      })
      expect(copiedCeiling.children).toContain(copiedLightId)
      expect(bridge.getNode(light.id)).toEqual(before[light.id])
      expect(bridge.getHistory().pastCount).toBe(1)
      const after = bridge.getNodes()
      bridge.undo()
      expect(bridge.getNodes()).toEqual(before)
      bridge.redo()
      expect(bridge.getNodes()).toEqual(after)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('lock_outside_faces preserves divided room IDs and moving a division keeps both enclosed', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = createPascalMcpServer({ bridge })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'divided-room-contract', version: '1' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args })
        expect(response.isError, JSON.stringify(response)).toBeFalsy()
        const result = response.structuredContent as { zoneId: string; conflicts?: unknown[] }
        expect(result.conflicts).toBeUndefined()
        return result
      }
      const roomIds = () =>
        Object.values(bridge.getNodes())
          .filter((node) => node.type === 'zone')
          .map((node) => node.id)
          .sort()
      const levelId = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!.id
      const { zoneId } = await call('create_room', {
        levelId,
        name: 'Kitchen',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      })
      await call('divide_zone', {
        zoneId,
        cut: [
          [2, 0],
          [2, 4],
        ],
      })
      const before = bridge.getNodes(),
        ids = roomIds()
      expect(ids).toHaveLength(2)
      bridge.clearHistory()
      await call('lock_outside_faces', { levelId })
      expect(roomIds()).toEqual(ids)
      expect(bridge.getHistory().pastCount).toBe(1)
      bridge.undo()
      expect(bridge.getNodes()).toEqual(before)
      bridge.clearHistory()
      await call('move_zone', { zoneId, translate: [10, 0] })
      expect(roomIds()).toEqual(ids)
      expect(
        Object.values(bridge.getNodes()).filter((node) => node.type === 'separator'),
      ).toHaveLength(2)
      expect(bridge.getHistory().pastCount).toBe(1)
      bridge.undo()
      expect(bridge.getNodes()).toEqual(before)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('listed move, duplicate and outside-face tools reconcile once and return ID maps', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = createPascalMcpServer({ bridge })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'room-transform-contract', version: '1' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const listed = await client.listTools()
      // The server adds persistence tools only when a scene store is supplied.
      for (const name of ['move_zone', 'duplicate_zone', 'rotate_zone', 'lock_outside_faces']) {
        const tool = listed.tools.find((tool) => tool.name === name)!
        expect(tool.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        })
        expect(tool.outputSchema?.properties).toHaveProperty('idMap')
      }
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args })
        expect(result.isError, JSON.stringify(result)).toBeFalsy()
        return result.structuredContent as {
          zoneId: string
          idMap: Record<string, string[]>
          changes: number
          conflicts?: Array<{ code: string }>
        }
      }
      const levelId = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!.id
      const { zoneId } = await call('create_room', {
        levelId,
        name: 'Kitchen',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      })
      const before = bridge.getNodes()
      bridge.clearHistory()
      const moved = await call('move_zone', {
        zoneId,
        translate: [10, 0],
        rotate: { angle: Math.PI / 2 },
      })
      expect(moved.zoneId).toBe(zoneId)
      expect(moved.idMap[zoneId]).toEqual([zoneId])
      expect(bridge.getHistory().pastCount).toBe(1)
      expect(bridge.getNode(zoneId)).toMatchObject({ seed: [12, 2] })
      bridge.undo()
      expect(bridge.getNodes()).toEqual(before)
      bridge.clearHistory()
      const copied = await call('duplicate_zone', { zoneId, translate: [6, 0] })
      expect(copied.zoneId).not.toBe(zoneId)
      expect(copied.idMap[zoneId]).toEqual([copied.zoneId])
      expect(Object.values(bridge.getNodes()).filter((n) => n.type === 'zone')).toHaveLength(2)
      expect(Object.values(bridge.getNodes()).filter((n) => n.type === 'ceiling')).toHaveLength(2)
      expect(bridge.getHistory().pastCount).toBe(1)
      bridge.undo()
      expect(bridge.getNodes()).toEqual(before)
      bridge.clearHistory()
      await call('lock_outside_faces', { zoneIds: [zoneId] })
      expect(
        Object.values(bridge.getNodes())
          .filter((n) => n.type === 'wall')
          .every((n) => n.justification === 'a'),
      ).toBe(true)
      expect(bridge.getHistory().pastCount).toBe(1)
      bridge.undo()
      expect(bridge.getNodes()).toEqual(before)
      bridge.clearHistory()
      const overlapping = await call('duplicate_zone', { zoneId, translate: [1, 1] })
      expect(overlapping.changes).toBeGreaterThan(0)
      expect(overlapping.conflicts).toBeUndefined()
      expect(bridge.getHistory().pastCount).toBe(1)
      expect(Object.values(bridge.getNodes()).filter((node) => node.type === 'zone')).toHaveLength(
        3,
      )
      bridge.undo()
      expect(bridge.getNodes()).toEqual(before)
      bridge.clearHistory()
      const rotated = await call('rotate_zone', { zoneId, quarterTurns: 1 })
      expect(rotated.zoneId).toBe(zoneId)
      expect(rotated.conflicts).toBeUndefined()
      for (const wall of Object.values(before).filter((node) => node.type === 'wall'))
        expect(bridge.getNode(wall.id)).toMatchObject({
          start: [wall.start[1], 4 - wall.start[0]],
          end: [wall.end[1], 4 - wall.end[0]],
        })
      expect(bridge.getHistory().pastCount).toBe(1)
      bridge.undo()
      expect(bridge.getNodes()).toEqual(before)
      const badRotation = await client.callTool({
        name: 'rotate_zone',
        arguments: { zoneId, quarterTurns: 2, gridStep: 0 },
      })
      expect(badRotation.isError).toBe(true)
      const invalid = await client.callTool({
        name: 'lock_outside_faces',
        arguments: { zoneIds: [zoneId], levelId },
      })
      expect(invalid.isError).toBe(true)
    } finally {
      await client.close()
      await server.close()
    }
  })
})

describe('MCP Sims placement', () => {
  test('move_zone and duplicate_zone preserve default-seed room identities across partial overlaps', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = createPascalMcpServer({ bridge })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'sims-placement', version: '1' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args })
        expect(response.isError, JSON.stringify(response)).toBeFalsy()
        const result = response.structuredContent as {
          zoneId: string
          idMap: Record<string, string[]>
          conflicts?: unknown[]
        }
        expect(result.conflicts).toBeUndefined()
        return result
      }
      const levelId = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!.id
      const room = await call('create_room', {
        levelId,
        name: 'Kitchen',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      })
      const destination = await call('create_room', {
        levelId,
        name: 'Bedroom',
        polygon: [
          [8, 0],
          [12, 0],
          [12, 4],
          [8, 4],
        ],
      })
      const before = bridge.getNodes()
      bridge.clearHistory()
      const moved = await call('move_zone', { zoneId: room.zoneId, translate: [9, 1] })
      expect(moved.zoneId).toBe(room.zoneId)
      expect(bridge.getNode(moved.zoneId)).toMatchObject({ name: 'Kitchen' })
      expect(bridge.getNode(destination.zoneId)).toMatchObject({ name: 'Bedroom' })
      expect(Object.values(bridge.getNodes()).filter((node) => node.type === 'zone')).toHaveLength(
        3,
      )
      expect(Object.values(bridge.getNodes()).filter((node) => node.type === 'wall')).toHaveLength(
        12,
      )
      expect(bridge.getHistory().pastCount).toBe(1)
      bridge.undo()
      expect(bridge.getNodes()).toEqual(before)
      bridge.clearHistory()
      const copied = await call('duplicate_zone', { zoneId: room.zoneId, translate: [9, 1] })
      expect(copied.zoneId).not.toBe(destination.zoneId)
      expect(copied.zoneId).not.toBe(room.zoneId)
      expect(bridge.getNode(copied.zoneId)).toMatchObject({ name: 'Kitchen 2' })
      expect(bridge.getNode(room.zoneId)).toEqual(before[room.zoneId])
      expect(bridge.getNode(destination.zoneId)).toMatchObject({ name: 'Bedroom' })
      expect(copied.idMap[room.zoneId]).toEqual([copied.zoneId])
      expect(Object.values(bridge.getNodes()).filter((node) => node.type === 'zone')).toHaveLength(
        4,
      )
      expect(bridge.getHistory().pastCount).toBe(1)
      bridge.undo()
      expect(bridge.getNodes()).toEqual(before)
      expect(bridge.getNode(destination.zoneId)).toBeDefined()
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('move_zone force preserves openings and refuses when no segment fits', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = createPascalMcpServer({ bridge })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'occupied-placement', version: '1' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args })
        expect(response.isError, JSON.stringify(response)).toBeFalsy()
        return response.structuredContent as {
          zoneId: string
          changes: number
          conflicts?: Array<{ code: string }>
        }
      }
      const levelId = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!.id
      const room = await call('create_room', {
        levelId,
        name: 'Room',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      })
      await call('create_room', {
        levelId,
        name: 'Room',
        polygon: [
          [8, 0],
          [12, 0],
          [12, 4],
          [8, 4],
        ],
      })
      const wall = Object.values(bridge.getNodes()).find(
        (node) =>
          node.type === 'wall' && node.start[0] === 0 && node.start[1] === 0 && node.end[1] === 0,
      )!
      const door = DoorNode.parse({
        parentId: wall.id,
        wallId: wall.id,
        position: [2, 0, 0],
        width: 3.5,
      })
      bridge.applyPatch([{ op: 'create', node: door, parentId: wall.id }])
      const before = bridge.getNodes()
      bridge.clearHistory()
      for (const force of [false, true]) {
        const blocked = await call('move_zone', { zoneId: room.zoneId, translate: [9, 1], force })
        expect(blocked.changes).toBe(0)
        expect(blocked.conflicts?.map((entry) => entry.code)).toEqual(['occupied-split'])
        expect(bridge.getNodes()).toEqual(before)
        expect(bridge.getHistory().pastCount).toBe(0)
      }
      bridge.applyPatch([{ op: 'update', id: door.id, data: { position: [3, 0, 0], width: 1 } }])
      const narrow = bridge.getNodes()
      bridge.clearHistory()
      const forced = await call('move_zone', {
        zoneId: room.zoneId,
        translate: [9, 1],
        force: true,
      })
      expect(forced.conflicts).toBeUndefined()
      expect(forced.changes).toBeGreaterThan(0)
      expect(bridge.getNode(door.id)).toBeDefined()
      expect(bridge.getHistory().pastCount).toBe(1)
      bridge.undo()
      expect(bridge.getNodes()).toEqual(narrow)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
