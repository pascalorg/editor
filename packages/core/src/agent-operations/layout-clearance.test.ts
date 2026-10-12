import { describe, expect, test } from 'bun:test'
import { type AnyNode, CeilingNode, ItemNode, LevelNode, SlabNode, ZoneNode } from '../schema'
import { CEILING_DRAW_OFFSET } from '../services'
import { authoredItem } from './__fixtures__/add-object-cases'
import {
  aabbsOverlap,
  inspectItemPlanFootprint,
  itemNodePlanAabb,
  resolveNodeLevelId,
} from './door-clearance'
import { AGENT_OPERATIONS, applySceneChanges, verifyScene } from './index'
import {
  classifyPlacement,
  collectOccupiedFootprints,
  findItemItemCollisions,
  findValidPlacement,
  generatePlacementCandidates,
  itemPlanAabb,
  layoutIssuesFromScene,
} from './layout-clearance'

function item(
  id: string,
  position: [number, number, number],
  dimensions: [number, number, number],
  name = 'Item',
  rotY = 0,
  parentId = 'level_1',
  scale: [number, number, number] = [1, 1, 1],
) {
  return {
    object: 'node' as const,
    id,
    type: 'item' as const,
    parentId,
    visible: true,
    metadata: {},
    name,
    position,
    rotation: [0, rotY, 0] as [number, number, number],
    scale,
    asset: {
      id: 'x',
      name,
      category: 'furniture',
      thumbnail: '',
      src: 'asset://x',
      dimensions,
    },
  }
}

describe('layout-clearance', () => {
  test.each([
    null,
    'level_missing',
  ])('an underlay with unresolved parent %s remains an occupied footprint', (parentId) => {
    const rug = ItemNode.parse({
      id: 'item_rug',
      parentId,
      position: [3, 0, 3],
      asset: {
        id: 'large-rug',
        name: 'Large rug',
        category: 'furniture',
        thumbnail: '',
        src: 'asset://large-rug',
        dimensions: [4, 0.02, 4],
      },
    })
    expect(collectOccupiedFootprints([rug])).toMatchObject([
      {
        id: 'item_rug',
        levelId: null,
        aabb: { minX: 1, maxX: 5, minZ: 1, maxZ: 5 },
      },
    ])
    const level = LevelNode.parse({ id: 'level_floor' })
    const floorRug = ItemNode.parse({ ...rug, parentId: level.id })
    expect(collectOccupiedFootprints([level, floorRug])).toEqual([])
  })

  function bedRoom(blocker?: 'large-rug' | 'solid-cabinet' | 'thick-rug' | 'raised-rug') {
    const level = LevelNode.parse({ id: 'level_r' })
    const zone = ZoneNode.parse({
      id: 'zone_r',
      parentId: level.id,
      name: 'Room',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 6],
        [0, 6],
      ],
    })
    const underlay = ItemNode.parse({
      id: 'item_underlay',
      parentId: level.id,
      position: [3, blocker === 'raised-rug' ? 0.5 : 0, 3],
      asset: {
        id: blocker ?? 'large-rug',
        name: blocker ?? 'large-rug',
        category: 'furniture',
        thumbnail: '',
        src: 'asset://underlay',
        dimensions: [4, blocker === 'solid-cabinet' || blocker === 'thick-rug' ? 0.8 : 0.02, 4],
        ...(blocker === 'thick-rug' ? { surface: { height: 0.02 } } : {}),
      },
    })
    const catalog = [
      {
        ...underlay.asset,
        id: 'double-bed',
        name: 'double-bed',
        dimensions: [1.6, 0.6, 2] as [number, number, number],
        surface: undefined,
      },
    ]
    const nodes = Object.fromEntries(
      [level, zone, ...(blocker ? [underlay] : [])].map((node) => [node.id, node]),
    )
    return { nodes, catalog }
  }

  test.each([
    undefined,
    'large-rug',
  ] as const)('automatic bed fits against a wall with floor covering %s', (blocker) => {
    const { nodes, catalog } = bedRoom(blocker)
    const before = structuredClone(nodes)
    const outcome = AGENT_OPERATIONS.place_in_room(
      nodes,
      { assetId: 'double-bed', zoneId: 'zone_r' },
      { catalog },
    )
    const after = applySceneChanges(nodes, outcome.changes!)
    const bed = after[outcome.result.itemId as string]
    expect(nodes).toEqual(before)
    expect(outcome.result).toMatchObject({ ok: true })
    expect(bed).toMatchObject({ type: 'item', parentId: 'level_r' })
    if (bed?.type !== 'item') throw new Error('bed missing')
    const footprint = itemNodePlanAabb(bed)!
    expect([footprint.minX, footprint.minZ].every((value) => value >= 0)).toBe(true)
    expect([footprint.maxX, footprint.maxZ].every((value) => value <= 6)).toBe(true)
    expect(
      Math.min(footprint.minX, footprint.minZ, 6 - footprint.maxX, 6 - footprint.maxZ),
    ).toBeLessThanOrEqual(0.2)
    expect(bed.position[1]).toBe(0)
    if (blocker) {
      expect(after.item_underlay).toEqual(before.item_underlay)
      expect(aabbsOverlap(footprint, itemNodePlanAabb(after.item_underlay!)!)).toBe(true)
      expect(findItemItemCollisions({ nodes: Object.values(after) })).toEqual([])
    }
  })

  test.each([
    'solid-cabinet',
    'thick-rug',
    'raised-rug',
  ] as const)('automatic bed remains blocked by %s', (blocker) => {
    const { nodes, catalog } = bedRoom(blocker)
    expect(() =>
      AGENT_OPERATIONS.place_in_room(
        nodes,
        { assetId: 'double-bed', zoneId: 'zone_r' },
        { catalog },
      ),
    ).toThrow(expect.objectContaining({ code: 'no_free_spot' }))
  })

  test('automatic bed over a rug still respects reserved clearance', () => {
    const { nodes, catalog } = bedRoom('large-rug')
    expect(() =>
      AGENT_OPERATIONS.place_in_room(
        nodes,
        {
          assetId: 'double-bed',
          zoneId: 'zone_r',
          clearanceAreas: [{ id: 'reserved-floor', minX: 0, maxX: 6, minZ: 0, maxZ: 6 }],
        },
        { catalog },
      ),
    ).toThrow(expect.objectContaining({ code: 'stair_blocked' }))
  })

  test('scripted plan bounds keep their offset through yaw and scale', () => {
    const node = authoredItem('item_offset', 'level_1', {
      name: 'Offset',
      category: 'furniture',
      size: [2, 1, 3],
    })
    node.position = [10, 0, 20]
    node.rotation = [0, Math.PI / 2, 0]
    node.scale = [2, 1, 3]
    node.source!.manifest.bounds.min = [1, 0, 2]
    node.source!.manifest.bounds.max = [3, 1, 5]
    const expected = { minX: 16, maxX: 25, minZ: 14, maxZ: 18 }
    expect(itemNodePlanAabb(node)).toMatchObject(expected)
    expect(inspectItemPlanFootprint(node)).toMatchObject({ ok: true, aabb: expected })
    const blocker = authoredItem('item_blocker', 'level_1', {
      name: 'Blocker',
      category: 'furniture',
      size: [1, 1, 1],
    })
    blocker.position = [20, 0, 16]
    expect(findItemItemCollisions({ nodes: [node, blocker] })).toHaveLength(1)
  })

  function verticalScene() {
    const level = LevelNode.parse({ id: 'level_vertical', height: 3 })
    const ceiling = CeilingNode.parse({
      id: 'ceiling_vertical',
      parentId: level.id,
      height: 3,
      polygon: [
        [-3, -3],
        [3, -3],
        [3, 3],
        [-3, 3],
      ],
    })
    const furniture = authoredItem('item_furniture', level.id, {
      name: 'Table',
      category: 'furniture',
      size: [2, 1, 2],
    })
    const pendant = authoredItem('item_pendant', ceiling.id, {
      name: 'Pendant',
      category: 'lighting',
      size: [1, 0.4, 1],
    })
    pendant.asset.attachTo = 'ceiling'
    pendant.source!.manifest.bounds.min[1] = -0.4
    pendant.source!.manifest.bounds.max[1] = 0
    return { level, ceiling, furniture, pendant }
  }

  test('proven ceiling pendant height clears floor furniture through scene verification', () => {
    const { level, ceiling, furniture, pendant } = verticalScene()
    const nodes = [level, ceiling, furniture, pendant]
    expect(findItemItemCollisions({ nodes })).toEqual([])
    const result = verifyScene(
      Object.fromEntries(nodes.map((node) => [node.id, node])),
      {},
      { activeLevelId: level.id },
    ).result
    expect(result.issues).not.toContainEqual(expect.objectContaining({ type: 'item_overlap' }))
    expect(result.issues).not.toContainEqual(expect.objectContaining({ type: 'item_too_close' }))
    pendant.position[0] = 1.53
    expect(findItemItemCollisions({ nodes })).toEqual([])
  })

  test('low pendants, ceiling peers and floor collisions remain warnings', () => {
    const { level, ceiling, furniture, pendant } = verticalScene()
    pendant.position[1] = -2
    expect(findItemItemCollisions({ nodes: [level, ceiling, furniture, pendant] })).toHaveLength(1)
    pendant.position[1] = 0
    const peer = { ...pendant, id: 'item_peer' as const }
    expect(findItemItemCollisions({ nodes: [level, ceiling, pendant, peer] })).toHaveLength(1)
    expect(
      findItemItemCollisions({
        nodes: [level, furniture, { ...furniture, id: 'item_peer' }],
      }),
    ).toHaveLength(1)
  })

  test('vertical separation uses corrective transforms and elected slab support', () => {
    const { level, ceiling, furniture, pendant } = verticalScene()
    const slab = SlabNode.parse({
      parentId: level.id,
      polygon: ceiling.polygon,
      elevation: 2,
    })
    const nodes = [level, ceiling, slab, furniture, pendant]
    expect(findItemItemCollisions({ nodes })).toHaveLength(1)
    furniture.supportSlabId = 'ground'
    expect(findItemItemCollisions({ nodes })).toEqual([])
    pendant.asset.offset[1] = -2
    expect(findItemItemCollisions({ nodes })).toHaveLength(1)
    pendant.asset.offset[1] = 0
    pendant.asset.scale[1] = 6
    expect(findItemItemCollisions({ nodes })).toHaveLength(1)
    pendant.asset.scale[1] = 1
    pendant.scale[1] = 6
    expect(findItemItemCollisions({ nodes })).toHaveLength(1)
  })

  test('following ceiling height and contact remain conservative', () => {
    const { level, ceiling, furniture, pendant } = verticalScene()
    const nodes = [level, ceiling, furniture, pendant]
    delete ceiling.height
    expect(findItemItemCollisions({ nodes })).toEqual([])
    level.height = 1.4
    expect(findItemItemCollisions({ nodes })).toHaveLength(1)
    ceiling.height = 1.4 + CEILING_DRAW_OFFSET
    expect(findItemItemCollisions({ nodes })).toHaveLength(1)
    ceiling.height += 0.5e-6
    expect(findItemItemCollisions({ nodes })).toHaveLength(1)
    ceiling.height += 1e-4
    expect(findItemItemCollisions({ nodes })).toEqual([])
  })

  test('two catalogue recessed lights without raw bounds retain floor and ceiling warnings', () => {
    const { level, ceiling, furniture } = verticalScene()
    const lights = ['item_recessed_a', 'item_recessed_b'].map((id) =>
      ItemNode.parse({
        id,
        parentId: ceiling.id,
        asset: {
          id: 'recessed-light',
          name: 'Recessed Light',
          category: 'furniture',
          thumbnail: '',
          src: 'asset://recessed-light',
          dimensions: [0.23, 0.06, 0.23],
          offset: [0, 0.0057, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          attachTo: 'ceiling',
          recessed: true,
        },
      }),
    )
    const nodes = [level, ceiling, furniture, ...lights]
    const hits = findItemItemCollisions({ nodes })
    expect(hits).toHaveLength(3)
    expect(hits.filter((hit) => hit.aId === furniture.id)).toHaveLength(2)
    const result = verifyScene(
      Object.fromEntries(nodes.map((node) => [node.id, node])),
      {},
      { activeLevelId: level.id },
    ).result
    expect(result.issues.filter((issue) => issue.type === 'item_overlap')).toHaveLength(3)
  })

  test('unknown bounds and non-planar or malformed transforms cannot waive collisions', () => {
    const mutations = [
      (node: ReturnType<typeof authoredItem>) => {
        node.source = undefined
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.rotation[0] = 0.1
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.asset.rotation[2] = 0.1
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.scale[1] = -1
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.position[1] = Number.NaN
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.asset.offset[1] = Number.NaN
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.source!.manifest.bounds.min[1] = 1
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.source!.manifest.animations = [{ name: 'swing', duration: 1 }]
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.roofSegmentId = 'rseg_unknown'
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.blockFaceId = 'block_unknown'
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.parentId = 'missing_parent'
      },
      (node: ReturnType<typeof authoredItem>) => {
        node.parentId = 'item_furniture'
      },
    ]
    for (const mutate of mutations) {
      const { level, ceiling, furniture, pendant } = verticalScene()
      mutate(pendant)
      expect(findItemItemCollisions({ nodes: [level, ceiling, furniture, pendant] })).toHaveLength(
        1,
      )
    }
    const { level, ceiling, furniture, pendant } = verticalScene()
    level.height = Number.NaN
    expect(findItemItemCollisions({ nodes: [level, ceiling, furniture, pendant] })).toHaveLength(1)
  })

  test('findItemItemCollisions detects rotated footprint overlap', () => {
    // Two 2x1 footprints; second rotated 90° so it extends along X
    const a = item('a', [0, 0, 0], [2, 1, 1], 'A', 0)
    const b = item('b', [0.9, 0, 0], [2, 1, 1], 'B', Math.PI / 2)
    const hits = findItemItemCollisions({ nodes: [a, b] as unknown as AnyNode[] })
    expect(hits.length).toBe(1)
    expect(hits[0]!.message).toContain('overlap')
  })

  test('findItemItemCollisions ignores separated items', () => {
    const a = item('a', [0, 0, 0], [1, 1, 1], 'A')
    const b = item('b', [3, 0, 0], [1, 1, 1], 'B')
    expect(findItemItemCollisions({ nodes: [a, b] as unknown as AnyNode[] })).toEqual([])
  })

  test('classifyPlacement flags door keep-out and item overlap', () => {
    const aabb = itemPlanAabb([1, 0, 1], [1, 1, 1], 0)
    expect(
      classifyPlacement({
        aabb,
        doorKeepouts: [{ minX: 0.5, maxX: 1.5, minZ: 0.5, maxZ: 1.5 }],
        occupied: [],
      }),
    ).toBe('blocks_door_clearance')
    expect(
      classifyPlacement({
        aabb,
        doorKeepouts: [],
        occupied: [{ minX: 0.5, maxX: 1.5, minZ: 0.5, maxZ: 1.5 }],
      }),
    ).toBe('overlaps_item')
    expect(
      classifyPlacement({
        aabb,
        doorKeepouts: [],
        occupied: [{ minX: 5, maxX: 6, minZ: 5, maxZ: 6 }],
      }),
    ).toBe('ok')
  })

  test('findValidPlacement nudges off an overlapping neighbor', () => {
    const primary = { x: 2, z: 2, rotationDeg: 0 }
    // Blocker sits on primary
    const occupied = [itemPlanAabb([2, 0, 2], [1.2, 1, 1.2], 0)]
    const found = findValidPlacement({
      primary,
      dimensions: [1, 1, 1],
      doorKeepouts: [],
      occupied,
      roomBounds: { minX: 0, maxX: 6, minZ: 0, maxZ: 6 },
      along: { x: 1, z: 0 },
      inward: { x: 0, z: 1 },
    })
    expect(found.candidate).not.toBeNull()
    expect(found.candidate!.x !== 2 || found.candidate!.z !== 2).toBe(true)
  })

  test('generatePlacementCandidates includes primary and offsets', () => {
    const c = generatePlacementCandidates(
      { x: 0, z: 0, rotationDeg: 0 },
      { lateralsM: [0, 1], insetsM: [0, 0.5], along: { x: 1, z: 0 }, inward: { x: 0, z: 1 } },
    )
    expect(c.some((p) => p.x === 0 && p.z === 0)).toBe(true)
    expect(c.some((p) => p.x === 1 && p.z === 0)).toBe(true)
    expect(c.some((p) => p.x === 0 && p.z === 0.5)).toBe(true)
  })

  test('layoutIssuesFromScene merges door blocks and item overlaps', () => {
    const level = {
      object: 'node' as const,
      id: 'level_1',
      type: 'level' as const,
      parentId: null,
      visible: true,
      metadata: {},
      children: [] as string[],
    }
    const wall = {
      object: 'node' as const,
      id: 'wall_1',
      type: 'wall' as const,
      parentId: 'level_1',
      visible: true,
      metadata: {},
      start: [0, 2.5] as [number, number],
      end: [5.5, 2.5] as [number, number],
      height: 2.5,
      thickness: 0.15,
      children: [] as string[],
    }
    const door = {
      object: 'node' as const,
      id: 'door_1',
      type: 'door' as const,
      parentId: 'wall_1',
      wallId: 'wall_1',
      visible: true,
      metadata: {},
      position: [1.375, 1.05, 0] as [number, number, number],
      width: 0.8,
      height: 2.1,
    }
    const toilet = item('t', [0.7, 0, 1.95], [1, 0.9, 1], 'Toilet')
    const a = item('a', [3, 0, 4], [1.5, 1, 1.5], 'A')
    const b = item('b', [3.2, 0, 4.1], [1.5, 1, 1.5], 'B')
    const issues = layoutIssuesFromScene([level, wall, door, toilet, a, b] as unknown as AnyNode[])
    expect(issues.some((m) => m.message.includes('blocked'))).toBe(true)
    expect(issues.some((m) => m.message.includes('overlap'))).toBe(true)
  })

  test('item gap of 0.08 m flags near-touching items (L3)', () => {
    // centers 1.05 m apart, each half-width 0.5 → 0.05 m free space
    const a = item('a', [0, 0, 0], [1, 1, 1], 'A')
    const b = item('b', [1.05, 0, 0], [1, 1, 1], 'B')
    const hits = findItemItemCollisions({
      nodes: [a, b] as unknown as AnyNode[],
      gap: 0.08,
    })
    expect(hits.length).toBe(1)
  })

  test('scaled items collide via getScaledDimensions (L4)', () => {
    // base 1x1, scale 3 → large footprint at origin overlaps neighbor at 1.5
    const a = item('a', [0, 0, 0], [1, 1, 1], 'A', 0, 'level_1', [3, 1, 3])
    const b = item('b', [1.5, 0, 0], [1, 1, 1], 'B')
    const hits = findItemItemCollisions({ nodes: [a, b] as unknown as AnyNode[] })
    expect(hits.length).toBe(1)
  })

  test('mirrored scale uses a positive physical footprint', () => {
    const a = item('a', [0, 0, 0], [1, 1, 1], 'A', 0, 'level_1', [-2, 1, 1])
    const b = item('b', [1.2, 0, 0], [1, 1, 1], 'B')
    const hits = findItemItemCollisions({ nodes: [a, b] as unknown as AnyNode[], gap: 0 })
    expect(hits).toHaveLength(1)
  })

  test('rejects zero-area and non-planar item footprints', () => {
    const zero = item('zero', [0, 0, 0], [0, 1, 1], 'Zero') as unknown as Extract<
      AnyNode,
      { type: 'item' }
    >
    const tilted = item('tilted', [0, 0, 0], [1, 1, 1], 'Tilted') as unknown as Extract<
      AnyNode,
      { type: 'item' }
    >
    tilted.rotation = [0.1, 0, 0]

    expect(inspectItemPlanFootprint(zero)).toEqual({
      ok: false,
      reason: 'non_positive_plan_dimensions',
    })
    expect(inspectItemPlanFootprint(tilted)).toEqual({
      ok: false,
      reason: 'non_planar_rotation',
    })
    expect(itemNodePlanAabb(tilted)).not.toBeNull()
  })

  test('rejects missing, non-finite, and wall-attached floor-fit evidence', () => {
    const missing = item('missing', [0, 0, 0], [1, 1, 1], 'Missing') as unknown as Extract<
      AnyNode,
      { type: 'item' }
    >
    delete (missing.asset as { dimensions?: [number, number, number] }).dimensions
    const nonFinite = item(
      'non-finite',
      [0, 0, 0],
      [Number.POSITIVE_INFINITY, 1, 1],
      'Non-finite',
    ) as unknown as Extract<AnyNode, { type: 'item' }>
    const nonFiniteY = item(
      'non-finite-y',
      [0, Number.NaN, 0],
      [1, 1, 1],
      'Non-finite Y',
    ) as unknown as Extract<AnyNode, { type: 'item' }>
    const attached = item('attached', [0, 0, 0], [1, 1, 1], 'Attached') as unknown as Extract<
      AnyNode,
      { type: 'item' }
    >
    attached.asset.attachTo = 'wall'

    expect(inspectItemPlanFootprint(missing)).toEqual({ ok: false, reason: 'missing_dimensions' })
    expect(inspectItemPlanFootprint(nonFinite)).toEqual({
      ok: false,
      reason: 'non_finite_dimensions',
    })
    expect(inspectItemPlanFootprint(nonFiniteY)).toEqual({
      ok: false,
      reason: 'non_finite_position',
    })
    expect(inspectItemPlanFootprint(attached, { floorOnly: true })).toEqual({
      ok: false,
      reason: 'unsupported_attachment',
    })
  })

  test('rejects a positive scale and dimension whose effective extent underflows to zero', () => {
    const underflow = item(
      'underflow',
      [0, 0, 0],
      [Number.MIN_VALUE, 1, 1],
      'Underflow',
      0,
      'level_1',
      [Number.MIN_VALUE, 1, 1],
    ) as unknown as Extract<AnyNode, { type: 'item' }>
    expect(inspectItemPlanFootprint(underflow)).toEqual({
      ok: false,
      reason: 'non_positive_plan_dimensions',
    })
  })

  test('resolves a level through children when parentId is dangling', () => {
    const child = item('child', [0, 0, 0], [1, 1, 1], 'Child', 0, 'missing_parent')
    const level = {
      object: 'node' as const,
      id: 'level_1',
      type: 'level' as const,
      parentId: null,
      visible: true,
      metadata: {},
      level: 0,
      baseElevation: 0,
      height: 2.7,
      children: ['child'],
    }
    const nodes = [level, child] as unknown as AnyNode[]
    expect(resolveNodeLevelId('child', new Map(nodes.map((node) => [node.id, node])))).toBe(
      'level_1',
    )
  })

  test('findValidPlacement reports primary door failure not last OOB (L7)', () => {
    // Tiny room so lateral nudges go out of bounds; primary sits in door keep-out.
    const found = findValidPlacement({
      primary: { x: 1, z: 1, rotationDeg: 0 },
      dimensions: [1, 1, 1],
      doorKeepouts: [{ minX: 0, maxX: 2, minZ: 0, maxZ: 2 }],
      occupied: [],
      roomBounds: { minX: 0, maxX: 2.2, minZ: 0, maxZ: 2.2 },
      along: { x: 1, z: 0 },
      inward: { x: 0, z: 1 },
    })
    expect(found.candidate).toBeNull()
    expect(found.reason).toBe('blocks_door_clearance')
  })
})
