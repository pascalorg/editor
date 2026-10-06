import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  LevelNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerApplyPatch } from './apply-patch'

describe('apply_patch', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerApplyPatch(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('applies a batch of create + update', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })

    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'create', node: wall, parentId: level.id },
          { op: 'update', id: wall.id, data: { thickness: 0.2 } },
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.appliedOps).toBe(2)
    expect(parsed.createdIds).toContain(wall.id)
    // Wait a tick for RAF-scheduled dirty-marking to settle.
    await new Promise((r) => setTimeout(r, 10))
    const stored = bridge.getNode(wall.id)
    expect(stored).not.toBeNull()
    expect((stored as { thickness?: number }).thickness).toBe(0.2)
  })

  // L46 (run 3): a pier's `material: {color}` reported applied and stored {}, and
  // `materialPreset: null` was refused, so the agent could not clear the preset hiding it.
  test('an update the node would drop is refused, naming the path; null clears a field', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({
      start: [0, 0],
      end: [5, 0],
      materialPreset: 'library:concrete-raw',
    })
    await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'create', node: wall, parentId: level.id }] },
    })
    const dropped = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [{ op: 'update', id: wall.id, data: { material: { color: '#8a8a8a' } } }],
      },
    })
    expect(dropped.isError).toBe(true)
    const refusal = JSON.parse((dropped.content as Array<{ text: string }>)[0]!.text)
    // Registered as a patch guard, it answers as it did when apply_patch held it.
    expect(refusal).toEqual({
      code: 'unknown_field',
      patchIndex: 0,
      id: wall.id,
      message: expect.stringContaining(
        `unknown_field: patches[0] wall ${wall.id} would not keep material.color: the patch would report it applied and drop it.`,
      ),
    })
    const cleared = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'update', id: wall.id, data: { materialPreset: null } }] },
    })
    expect(cleared.isError).toBeFalsy()
    expect(bridge.getNode(wall.id)).not.toHaveProperty('materialPreset')
  })

  test('syncs derived stair openings after stair patches', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const ground = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const upper = LevelNode.parse({ name: 'Upper Floor', level: 1 })
    const upperSlab = SlabNode.parse({
      name: 'Upper Floor Slab',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const segment = StairSegmentNode.parse({
      width: 1,
      length: 2.6,
      height: 3.05,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      name: 'Main Stair',
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      openingOffset: 0.1,
      children: [segment.id],
    })

    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'create', node: upper, parentId: building.id },
          { op: 'create', node: upperSlab, parentId: upper.id },
          { op: 'create', node: stair, parentId: ground.id },
          { op: 'create', node: segment, parentId: stair.id },
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    const slab = bridge.getNode(upperSlab.id)
    expect(slab?.type).toBe('slab')
    if (slab?.type !== 'slab') return
    expect(slab.holes).toHaveLength(1)
    const metadata = slab.holeMetadata[0]
    expect(metadata?.source).toBe('floor-opening')
    if (metadata?.source === 'floor-opening')
      expect(bridge.getNode(metadata.openingId)).toMatchObject({
        source: 'stair',
        ownerId: stair.id,
      })
  })

  test('rejects update to a non-existent node', async () => {
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [{ op: 'update', id: 'wall_none', data: { thickness: 0.1 } }],
      },
    })
    expect(result.isError).toBe(true)
  })

  test('refuses a create whose id already exists, keeping the hosted windows', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ id: 'wall_ground-exterior-01', start: [0, 0], end: [6, 0] })
    const windows = [1, 3, 5].map((x) =>
      WindowNode.parse({ wallId: wall.id, position: [x, 1.2, 0] }),
    )
    const seeded = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'create', node: wall, parentId: level.id },
          ...windows.map((w) => ({ op: 'create', node: w, parentId: wall.id })),
        ],
      },
    })
    expect(seeded.isError).toBeFalsy()

    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          {
            op: 'create',
            node: WallNode.parse({ id: wall.id, start: [0, 5], end: [4, 5] }),
            parentId: level.id,
          },
        ],
      },
    })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    expect(text).toContain('node_exists')
    expect(text).toContain(wall.id)
    const kept = bridge.getNode(wall.id)
    expect(kept?.type === 'wall' && kept.children).toEqual(windows.map((w) => w.id))
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('refuses an update that changes id or type', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'create', node: wall, parentId: level.id }] },
    })

    for (const data of [{ id: 'wall_other' }, { type: 'fence' }]) {
      const result = await client.callTool({
        name: 'apply_patch',
        arguments: { patches: [{ op: 'update', id: wall.id, data }] },
      })
      expect(result.isError).toBe(true)
      const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
      expect(text).toContain('identity_change')
    }
    const stored = bridge.getNode(wall.id)
    expect(stored?.id).toBe(wall.id)
    expect(stored?.type).toBe('wall')
  })

  test('rejects authoring derived construction, leaving the scene untouched', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    const plate = SlabNode.parse({
      polygon: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
      boundary: 'auto',
    })

    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'create', node: wall, parentId: level.id },
          { op: 'create', node: plate, parentId: level.id },
        ],
      },
    })
    expect(result.isError).toBe(true)
    const message = (result.content as Array<{ type: string; text: string }>)[0]!.text
    expect(message).toContain('Refusing to create the derived slab')
    expect(message).toContain('derived from rooms')
    // Atomic: the wall in the same batch was not applied either.
    expect(bridge.getNode(wall.id)).toBeNull()
    expect(bridge.getNode(plate.id)).toBeNull()
  })

  test('rejects reshaping derived construction', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const polygon: Array<[number, number]> = [
      [0, 0],
      [5, 0],
      [5, 4],
      [0, 4],
    ]
    for (const [index, start] of polygon.entries()) {
      bridge.createNode(
        WallNode.parse({ start, end: polygon[(index + 1) % polygon.length] }),
        level.id,
      )
    }
    bridge.deriveStructure()
    const plate = Object.values(bridge.getNodes()).find((n) => n.type === 'slab')!
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [{ op: 'update', id: plate.id, data: { polygon: [] } }],
      },
    })
    expect(result.isError).toBe(true)
    expect((result.content as Array<{ type: string; text: string }>)[0]!.text).toContain(
      'Refusing to change polygon on the derived slab',
    )
  })

  test('rejects malformed patch shape', async () => {
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [{ op: 'nope', garbage: true } as unknown as object],
      },
    })
    expect(result.isError).toBe(true)
  })
})
