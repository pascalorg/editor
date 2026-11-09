import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import {
  type AnyNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
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

  test('can replace site ground presentation without changing the site or its buildings', async () => {
    const before = structuredClone(bridge.getNodes())
    const site = Object.values(before).find((node) => node.type === 'site')!
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'update', id: site.id, data: { showGround: false } }] },
    })
    expect(result.isError).toBeFalsy()
    expect(bridge.getNodes()).toEqual({
      ...before,
      [site.id]: { ...site, showGround: false },
    })
    const restored = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'update', id: site.id, data: { showGround: null } }] },
    })
    expect(restored.isError).toBeFalsy()
    expect(bridge.getNodes()).toEqual(before)
  })

  test('saves and clears project lighting through the existing patch contract', async () => {
    const site = Object.values(bridge.getNodes()).find((node) => node.type === 'site')!
    const before = structuredClone(bridge.getNodes())
    const presentation = {
      exposure: 0.94,
      edges: 'off',
      shading: 'rendered',
      lighting: {
        background: '#dce4e5',
        backgroundSky: null,
        environment: { source: 'room', intensity: 0.28 },
      },
      postprocessing: { ambientOcclusion: false, colorGrading: false },
    }
    for (const value of [presentation, null]) {
      const result = await client.callTool({
        name: 'apply_patch',
        arguments: { patches: [{ op: 'update', id: site.id, data: { presentation: value } }] },
      })
      expect(result.isError).toBeFalsy()
      expect((bridge.getNode(site.id) as typeof site).presentation).toEqual(value ?? undefined)
      for (const [id, node] of Object.entries(before))
        if (id !== site.id) expect(bridge.getNode(id)).toEqual(node)
    }
  })

  // A pier's `material: {color}` reported applied and stored {}, and
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

  // A level written without a height is legacy to the editor's load, which derives its storey from
  // what it holds; the session read 2.5 m. The write now gets the derived height, said in notes.
  test('a level created without a height gets the height its walls give, and says so', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const { height: _height, ...level } = LevelNode.parse({ parentId: building.id, level: 1 })
    const walls = [
      WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0], height: 3 }),
      WallNode.parse({ parentId: level.id, start: [4, 0], end: [4, 4], height: 3 }),
    ]
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'create', node: level, parentId: building.id },
          ...walls.map((wall) => ({ op: 'create', node: wall, parentId: level.id })),
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    const stored = bridge.getNode(level.id) as { height?: number }
    expect(stored.height).toBe(3)
    expect((result.structuredContent as { notes?: string[] }).notes).toEqual([
      `level ${level.id}: height ${Math.round(stored.height! * 100) / 100} m derived from its walls and ceilings, as the editor reads a level written without one`,
    ])
  })

  test('an empty level created without a height gets the default storey height', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const { height: _height, ...level } = LevelNode.parse({ parentId: building.id, level: 1 })
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'create', node: level, parentId: building.id }] },
    })
    expect(result.isError).toBeFalsy()
    expect((bridge.getNode(level.id) as { height?: number }).height).toBe(2.5)
  })

  // The roof-level rule: a roof on the walls of the storey holding it goes to the level above
  // them in the same write; storey content aimed at a roof level is refused at its index.
  function roofedRoom(levelId: string) {
    const corners: [number, number][] = [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ]
    const walls = corners.map((start, i) =>
      WallNode.parse({ parentId: levelId, start, end: corners[(i + 1) % 4], height: 2.5 }),
    )
    const roof = RoofNode.parse({ position: [4, 0, 3], support: { kind: 'walls' } })
    const segment = RoofSegmentNode.parse({ width: 8, depth: 6 })
    return {
      roof,
      patches: [
        ...walls.map((wall) => ({ op: 'create', node: wall, parentId: levelId })),
        { op: 'create', node: roof, parentId: levelId },
        { op: 'create', node: segment, parentId: roof.id },
      ],
    }
  }

  test('a roof made on its walls’ storey lands on a new Roof level in the one undo step, said in notes', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const before = Object.keys(bridge.getNodes()).length
    const roots = bridge.getRootNodeIds()
    const { roof, patches } = roofedRoom(level.id)
    const result = await client.callTool({ name: 'apply_patch', arguments: { patches } })
    expect(result.isError).toBeFalsy()
    const placed = bridge.getNode(roof.id)!
    const roofLevel = bridge.getNode(placed.parentId as AnyNode['id']) as LevelNode
    expect(roofLevel).toMatchObject({ type: 'level', metadata: { role: 'roof' } })
    // in exactly one parent's children, no new root
    const holders = Object.values(bridge.getNodes()).filter((node) =>
      ((node as { children?: string[] }).children ?? []).includes(roof.id),
    )
    expect(holders.map((node) => node.id)).toEqual([roofLevel.id])
    expect(bridge.getRootNodeIds()).toEqual(roots)
    const notes = (result.structuredContent as { notes?: string[] }).notes ?? []
    expect(
      notes.some((note) => note.includes(`roof ${roof.id}`) && note.includes(roofLevel.id)),
    ).toBe(true)
    bridge.undo(1)
    expect(Object.keys(bridge.getNodes())).toHaveLength(before)
    expect(bridge.getNode(roofLevel.id)).toBeNull()
  })

  test('a wall written on the roof level is refused at its index, naming the storey it covers', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const { roof, patches } = roofedRoom(level.id)
    await client.callTool({ name: 'apply_patch', arguments: { patches } })
    const roofLevelId = bridge.getNode(roof.id)!.parentId!
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0] })
    const refused = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'update', id: roof.id, data: { name: 'Main roof' } },
          { op: 'create', node: wall, parentId: roofLevelId },
        ],
      },
    })
    expect(refused.isError).toBe(true)
    const refusal = JSON.parse((refused.content as Array<{ text: string }>)[0]!.text)
    expect(refusal).toMatchObject({ code: 'roof_level', patchIndex: 1, id: wall.id })
    expect(refusal.message).toContain(level.id)
    expect(bridge.getNode(wall.id)).toBeNull()
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
