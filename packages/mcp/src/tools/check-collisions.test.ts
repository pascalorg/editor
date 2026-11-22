import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { CeilingNode, ItemNode, ProceduralItemNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerCheckCollisions } from './check-collisions'

function makeItem(position: [number, number, number], dims: [number, number, number] = [1, 1, 1]) {
  return ItemNode.parse({
    position,
    asset: {
      id: 'x',
      name: 'x',
      category: 'x',
      thumbnail: '',
      src: 'asset://x',
      dimensions: dims,
    },
  })
}

describe('check_collisions', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCheckCollisions(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('detects overlapping item AABBs', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const a = makeItem([0, 0, 0])
    const b = makeItem([0.5, 0, 0.5])
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.collisions.length).toBeGreaterThanOrEqual(1)
    const ids = parsed.collisions.flatMap((c: { aId: string; bId: string }) => [c.aId, c.bId])
    expect(ids).toContain(a.id)
    expect(ids).toContain(b.id)
  })

  test('returns empty array when items do not overlap', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const a = makeItem([-10, 0, -10])
    const b = makeItem([10, 0, 10])
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.collisions.length).toBe(0)
  })

  // This tool reports *actual* overlap, not "too close together". It shares
  // findItemItemCollisions with furnish_room, which defaults to an 8cm spacing
  // gap; if that default ever leaks in here, neighbouring furniture starts
  // getting reported as colliding. 7cm apart must stay clean.
  test('items standing close but not overlapping are not collisions', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    // a spans x [0, 1], b spans x [1.07, 2.07] — 7cm of clear air between them.
    const a = makeItem([0.5, 0, 0])
    const b = makeItem([1.57, 0, 0])
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.collisions.length).toBe(0)
  })

  test('rejects an unknown levelId instead of reporting a clean empty result', async () => {
    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { levelId: 'level_missing' },
    })
    expect(result.isError).toBe(true)
  })

  test('preserves level scoping for children-only legacy hierarchy records', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const a = makeItem([0, 0, 0])
    const b = makeItem([0.5, 0, 0])
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)
    const graph = bridge.exportJSON()
    graph.nodes[a.id] = { ...graph.nodes[a.id]!, parentId: null }
    graph.nodes[b.id] = { ...graph.nodes[b.id]!, parentId: null }
    bridge.loadJSON(graph)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { levelId: level.id },
    })
    const parsed = result.structuredContent as { collisions: unknown[]; checkedItems: unknown[] }
    expect(parsed.checkedItems).toHaveLength(2)
    expect(parsed.collisions).toHaveLength(1)
  })

  test('advertises the prospective-item assessment as read-only and idempotent', async () => {
    const tools = await client.listTools()
    const tool = tools.tools.find((entry) => entry.name === 'check_collisions')
    expect(tool?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    const candidate = (tool!.inputSchema.properties as Record<string, unknown>).candidate as {
      properties: Record<string, { items?: unknown; minItems?: number; maxItems?: number }>
    }
    for (const field of ['position', 'dimensions']) {
      expect(Array.isArray(candidate.properties[field]?.items)).toBe(false)
      expect(candidate.properties[field]?.minItems).toBe(3)
      expect(candidate.properties[field]?.maxItems).toBe(3)
    }
  })

  test('reports units, source dimensions, clearance violations, and limitations', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const a = makeItem([0, 0, 0])
    const b = makeItem([1.05, 0, 0])
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { minimumClearance: '10 cm', floorOnly: true },
    })
    const parsed = result.structuredContent as {
      status: string
      units: string
      minimumClearanceMeters: number
      checkedItems: Array<{ sourceDimensionsMeters: number[]; source: { uri: string } }>
      collisions: Array<{ violation: string }>
      unsupportedChecks: Array<{ check: string }>
    }
    expect(parsed.status).toBe('checked')
    expect(parsed.units).toBe('meters')
    expect(parsed.minimumClearanceMeters).toBeCloseTo(0.1)
    expect(parsed.checkedItems[0]?.sourceDimensionsMeters).toEqual([1, 1, 1])
    expect(parsed.checkedItems[0]?.source.uri).toBe('asset://x')
    expect(parsed.collisions[0]?.violation).toBe('clearance')
    expect(parsed.unsupportedChecks.map((entry) => entry.check)).toContain('delivery_path')
  })

  test('marks unsuitable footprint geometry as insufficient evidence', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const item = makeItem([0, 0, 0], [0, 1, 1])
    bridge.createNode(item, level.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { floorOnly: true },
    })
    const parsed = result.structuredContent as {
      status: string
      checkedItems: unknown[]
      skippedItems: Array<{ reason: string }>
    }
    expect(parsed.status).toBe('insufficient_evidence')
    expect(parsed.checkedItems).toHaveLength(0)
    expect(parsed.skippedItems[0]?.reason).toBe('non_positive_plan_dimensions')
  })

  test('checks a supplied candidate without mutating the scene', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const existing = makeItem([0, 0, 0])
    bridge.createNode(existing, level.id)
    const before = JSON.stringify(bridge.exportJSON())

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {
        minimumClearance: '4 in',
        floorOnly: true,
        candidate: {
          id: 'prospective-sofa',
          name: 'Prospective sofa',
          levelId: level.id,
          position: ['3 ft', 0, 0],
          dimensions: ['6 ft', '32 in', '36 in'],
          rotationY: '90 deg',
          source: { assetId: 'retailer-sofa', uri: 'https://example.test/sofa' },
        },
      },
    })
    const parsed = result.structuredContent as {
      candidateItemId: string | null
      checkedItems: Array<{ id: string; source: { catalog: string } }>
      collisions: Array<{ aId: string; bId: string }>
    }
    expect(result.isError).toBeFalsy()
    expect(parsed.candidateItemId).toBe('prospective-sofa')
    expect(
      parsed.checkedItems.find((entry) => entry.id === 'prospective-sofa')?.source.catalog,
    ).toBe('supplied')
    expect(parsed.collisions).toHaveLength(1)
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
  })

  test('rejects invalid supplied candidate dimensions', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {
        candidate: {
          levelId: level.id,
          position: [0, 0, 0],
          dimensions: [0, 1, 1],
        },
      },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects a candidate scoped to a different level', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {
        levelId: level.id,
        candidate: {
          levelId: 'level_other',
          position: [0, 0, 0],
          dimensions: [1, 1, 1],
        },
      },
    })
    expect(result.isError).toBe(true)
  })

  test('skips hosted item-local coordinates in floor-only mode', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const floorItem = makeItem([0, 0, 0])
    const host = makeItem([10, 0, 0])
    const hosted = makeItem([0, 0, 0])
    bridge.createNode(floorItem, level.id)
    bridge.createNode(host, level.id)
    bridge.createNode(hosted, host.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { levelId: level.id, floorOnly: true },
    })
    const parsed = result.structuredContent as {
      status: string
      collisions: unknown[]
      skippedItems: Array<{ id: string; name: string; reason: string }>
    }
    expect(parsed.status).toBe('partial')
    expect(parsed.collisions).toHaveLength(0)
    expect(parsed.skippedItems).toContainEqual({
      id: hosted.id,
      name: hosted.name ?? hosted.asset.name,
      reason: 'unsupported_attachment',
    })

    const unfilteredResult = await client.callTool({
      name: 'check_collisions',
      arguments: { levelId: level.id },
    })
    const unfiltered = unfilteredResult.structuredContent as {
      status: string
      collisions: unknown[]
      skippedItems: Array<{ id: string; reason: string }>
      unsupportedChecks: Array<{ check: string }>
    }
    expect(unfiltered.status).toBe('partial')
    expect(unfiltered.collisions).toHaveLength(0)
    expect(unfiltered.skippedItems).toContainEqual({
      id: hosted.id,
      name: hosted.name ?? hosted.asset.name,
      reason: 'parent_local_coordinates',
    })
    expect(unfiltered.unsupportedChecks.map((entry) => entry.check)).toContain(
      'hosted_item_world_transform',
    )
  })

  test('does not compare an item whose level cannot be resolved', async () => {
    const orphan = makeItem([0, 0, 0])
    bridge.createNode(orphan)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {},
    })
    const parsed = result.structuredContent as {
      status: string
      checkedItems: unknown[]
      skippedItems: Array<{ id: string; reason: string }>
    }
    expect(parsed.status).toBe('insufficient_evidence')
    expect(parsed.skippedItems).toContainEqual({
      id: orphan.id,
      name: orphan.name ?? orphan.asset.name,
      reason: 'unresolved_level',
    })
  })

  describe('procedural-item support (#1255)', () => {
    const blockRecipe = {
      version: 1,
      name: 'M0 D2.5 Overlap Block',
      description: 'A solid 2 m by 2 m by 0.9 m floor-standing test block.',
      classification: {
        category: 'test_furniture',
        functionTags: ['test'],
        tags: ['collision'],
      },
      parameters: [
        {
          id: 'width',
          label: 'Width',
          default: 2,
          min: 2,
          max: 2,
          step: 0.1,
          unit: 'm',
          axis: 'x',
        },
        {
          id: 'depth',
          label: 'Depth',
          default: 2,
          min: 2,
          max: 2,
          step: 0.1,
          unit: 'm',
          axis: 'z',
        },
        {
          id: 'height',
          label: 'Height',
          default: 0.9,
          min: 0.9,
          max: 0.9,
          step: 0.1,
          unit: 'm',
          axis: 'y',
        },
      ],
      slots: [{ id: 'wood', label: 'Wood', color: '#8b5a2b', finish: 'wood' }],
      parts: [
        {
          id: 'block',
          label: 'Block',
          count: 1,
          shapes: [
            {
              id: 'body',
              primitive: 'box',
              slot: 'wood',
              size: ['width', 'height', 'depth'],
              position: [0, { op: 'div', args: ['height', 2] }, 0],
              support: true,
            },
          ],
        },
      ],
      constraints: [],
    }

    function makeProcedural(
      id: string,
      position: [number, number, number],
      extra: Record<string, unknown> = {},
    ) {
      return ProceduralItemNode.parse({
        object: 'node',
        id,
        type: 'procedural-item',
        name: id,
        visible: true,
        metadata: {},
        recipe: blockRecipe,
        parameters: { width: 2, depth: 2, height: 0.9 },
        slots: {},
        position,
        rotation: [0, 0, 0],
        children: [],
        attachments: {},
        ...extra,
      })
    }

    test('detects overlapping floor-standing procedural-item nodes and populates checkedItems', async () => {
      const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
      const a = makeProcedural('procedural-item_m0d25_proc_a', [0, 0, 0], {
        name: 'M0 D2.5 Procedural A',
      })
      const b = makeProcedural('procedural-item_m0d25_proc_b', [0, 0, 0], {
        name: 'M0 D2.5 Procedural B',
      })
      bridge.createNode(a, level.id)
      bridge.createNode(b, level.id)

      const result = await client.callTool({
        name: 'check_collisions',
        arguments: { levelId: level.id, minimumClearance: 0, floorOnly: true },
      })
      const parsed = result.structuredContent as {
        status: string
        checkedItems: Array<{
          id: string
          source: { assetId: string; uri: string; catalog: string }
          effectiveDimensionsMeters: [number, number, number]
        }>
        skippedItems: unknown[]
        collisions: Array<{ aId: string; bId: string; kind: string; violation: string }>
      }
      expect(result.isError).toBeFalsy()
      expect(parsed.status).toBe('checked')
      expect(parsed.checkedItems).toHaveLength(2)
      expect(parsed.checkedItems[0]?.source).toEqual({
        assetId: 'M0 D2.5 Overlap Block',
        uri: 'procedural://recipe',
        catalog: 'procedural',
      })
      expect(parsed.checkedItems[0]?.effectiveDimensionsMeters).toEqual([2, 0.9, 2])
      expect(parsed.skippedItems).toEqual([])
      expect(parsed.collisions).toEqual([
        expect.objectContaining({
          aId: 'procedural-item_m0d25_proc_a',
          bId: 'procedural-item_m0d25_proc_b',
          kind: 'item-aabb',
          violation: 'overlap',
        }),
      ])
    })

    test('detects item vs procedural-item overlap and clearance violations', async () => {
      const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
      const proc = makeProcedural('procedural-item_sofa', [0, 0, 0])
      const nearItem = makeItem([1.55, 0, 0], [1, 0.8, 1]) // 0.05 m gap (< 0.1 m clearance)
      bridge.createNode(proc, level.id)
      bridge.createNode(nearItem, level.id)

      const result = await client.callTool({
        name: 'check_collisions',
        arguments: { levelId: level.id, minimumClearance: 0.1, floorOnly: true },
      })
      const parsed = result.structuredContent as {
        status: string
        checkedItems: unknown[]
        collisions: Array<{ aId: string; bId: string; violation: string }>
      }
      expect(parsed.status).toBe('checked')
      expect(parsed.checkedItems).toHaveLength(2)
      expect(parsed.collisions).toHaveLength(1)
      expect(parsed.collisions[0]?.violation).toBe('clearance')
    })

    test('skips ceiling-hosted and non-planar procedural-item nodes without leaking phantom collisions', async () => {
      const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
      const ceiling = CeilingNode.parse({
        id: 'ceiling_proc',
        polygon: [
          [-3, -3],
          [3, -3],
          [3, 3],
          [-3, 3],
        ],
      })
      bridge.createNode(ceiling, level.id)
      const pendantRecipe = {
        ...blockRecipe,
        name: 'Procedural Pendant',
        mounting: { attachTo: 'ceiling', reference: 'mount' },
        surfaces: [
          {
            id: 'mount',
            label: 'Mount',
            position: [0, 0.9, 0],
            size: [0.2, 0.2],
          },
        ],
      }
      const pendant = makeProcedural('procedural-item_pendant', [0, 0, 0], {
        recipe: pendantRecipe,
      })
      const tilted = makeProcedural('procedural-item_tilted', [0, 0, 0], {
        rotation: [0.2, 0, 0],
      })
      bridge.createNode(pendant, ceiling.id)
      bridge.createNode(tilted, level.id)

      const floorResult = await client.callTool({
        name: 'check_collisions',
        arguments: { levelId: level.id, floorOnly: true },
      })
      const floorParsed = floorResult.structuredContent as {
        status: string
        checkedItems: unknown[]
        skippedItems: Array<{ id: string; reason: string }>
        collisions: unknown[]
      }
      expect(floorParsed.status).toBe('insufficient_evidence')
      expect(floorParsed.checkedItems).toHaveLength(0)
      expect(floorParsed.collisions).toHaveLength(0)
      expect(floorParsed.skippedItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'procedural-item_pendant',
            reason: 'unsupported_attachment',
          }),
          expect.objectContaining({ id: 'procedural-item_tilted', reason: 'non_planar_rotation' }),
        ]),
      )

      const wallSideRecipe = {
        ...blockRecipe,
        name: 'Wall-Side Sconce Draft',
        mounting: { attachTo: 'wall-side', reference: 'back' },
        surfaces: [
          {
            id: 'back',
            label: 'Back',
            position: [0, 0.45, -1],
            rotation: [-Math.PI / 2, 0, 0],
            size: [0.2, 0.2],
          },
        ],
      }
      const wallDraftOnLevel = makeProcedural('procedural-item_wall_draft', [0, 0, 0], {
        recipe: wallSideRecipe,
        metadata: { isTransient: true },
      })
      bridge.createNode(wallDraftOnLevel, level.id)

      const defaultResult = await client.callTool({
        name: 'check_collisions',
        arguments: { levelId: level.id },
      })
      const defaultParsed = defaultResult.structuredContent as {
        status: string
        checkedItems: unknown[]
        skippedItems: Array<{ id: string; reason: string }>
      }
      expect(defaultParsed.status).toBe('insufficient_evidence')
      expect(defaultParsed.checkedItems).toHaveLength(0)
      expect(defaultParsed.skippedItems).toContainEqual(
        expect.objectContaining({
          id: 'procedural-item_wall_draft',
          reason: 'unsupported_attachment',
        }),
      )
    })
  })
})
