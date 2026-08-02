import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { encodeTerrainField } from '../../lib/terrain-codec'
import { applyHeightPatch, createTerrainField, flattenPatch } from '../../lib/terrain-field'
import { nodeRegistry, registerNode } from '../../registry'
import type { AnyNodeDefinition } from '../../registry/types'
import type { AnyNode, SlabNode } from '../../schema'
import useScene from '../../store/use-scene'
import {
  GROUND_SUPPORT_ID,
  getFloorPlacedElevation,
  getFloorStackedPosition,
} from './floor-placed-elevation'
import { spatialGridManager } from './spatial-grid-manager'

const LEVEL_ID = 'level_test'

function makeDefinition(
  kind: AnyNode['type'],
  capabilities: AnyNodeDefinition['capabilities'] = {},
): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as never,
    category: 'utility',
    defaults: () => ({}) as never,
    capabilities,
  }
}

function makeLevel(): AnyNode {
  return {
    id: LEVEL_ID,
    type: 'level',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    level: 0,
  } as AnyNode
}

function makeFloorNode(overrides: Partial<AnyNode> = {}): AnyNode {
  return {
    id: 'item_test',
    type: 'item',
    object: 'node',
    parentId: LEVEL_ID,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    asset: {
      id: 'asset_test',
      category: 'test',
      name: 'Test',
      thumbnail: '',
      src: 'asset:test',
      dimensions: [1, 1, 1],
      source: 'library',
    },
    ...overrides,
  } as AnyNode
}

function addSlab(polygon: Array<[number, number]>, elevation: number, id = `slab_${elevation}`) {
  const slab = {
    id,
    type: 'slab',
    object: 'node',
    parentId: LEVEL_ID,
    visible: true,
    metadata: {},
    children: [],
    polygon,
    holes: [],
    holeMetadata: [],
    elevation,
    thickness: Math.max(elevation, 0),
    recessed: elevation < 0,
    autoFromWalls: false,
  } as SlabNode
  spatialGridManager.handleNodeCreated(slab as AnyNode, LEVEL_ID)
}

function nodesFor(...nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

/** A point on the plateau below, and the ground height there. */
const ON_PLATEAU: [number, number, number] = [3, 0, 3]
const PLATEAU_HEIGHT = 2.5

/** A site whose ground is a 2.5 m plateau over x,z ∈ [2,5] and flat at 0 elsewhere. */
function makeSite(): AnyNode {
  const base = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
  const patch = flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, PLATEAU_HEIGHT)
  return {
    id: 'site_test',
    type: 'site',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    terrain: encodeTerrainField(applyHeightPatch(base, patch as never)),
  } as unknown as AnyNode
}

describe('floor-placed elevation resolver', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    spatialGridManager.clear()
    useScene.setState({ nodes: {} })
  })

  test('returns 0 without a floorPlaced capability', () => {
    registerNode(makeDefinition('item'))
    addSlab(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      0.4,
    )

    const level = makeLevel()
    const node = makeFloorNode()

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, node),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    ).toBe(0)
  })

  test('canPlaceOnFloorFootprints accepts an L-shaped draft in the open corner gap', () => {
    const baseAsset = (makeFloorNode() as { asset: Record<string, unknown> }).asset
    registerNode(
      makeDefinition('item', {
        floorPlaced: {
          footprint: (node) => ({
            dimensions: (node as { asset: { dimensions: [number, number, number] } }).asset
              .dimensions,
            rotation: [0, (node as { rotation: [number, number, number] }).rotation[1] ?? 0, 0],
          }),
          collides: true,
        },
      }),
    )

    const level = makeLevel()
    const blocker = makeFloorNode({
      id: 'item_blocker',
      position: [0.85, 0, 0.85],
      asset: {
        ...baseAsset,
        id: 'asset_blocker',
        name: 'Blocker',
        src: 'asset:blocker',
        dimensions: [0.3, 1, 0.3],
      } as AnyNode extends { asset: infer T } ? T : never,
    })
    useScene.setState({ nodes: nodesFor(level, blocker) })

    const coarse = spatialGridManager.canPlaceOnFloor(LEVEL_ID, [0.5, 0, 0.5], [1, 1, 1], [0, 0, 0])
    const precise = spatialGridManager.canPlaceOnFloorFootprints(LEVEL_ID, [
      { position: [0.2, 0, 0.5], dimensions: [0.4, 1, 1], rotation: [0, 0, 0] },
      { position: [0.8, 0, 0.2], dimensions: [0.4, 1, 0.4], rotation: [0, 0, 0] },
    ])

    expect(coarse.valid).toBe(false)
    expect(coarse.conflictIds).toEqual(['item_blocker'])
    expect(precise.valid).toBe(true)
    expect(precise.conflictIds).toEqual([])
  })

  test('canPlaceOnFloorFootprints rejects overlapping draft footprints', () => {
    useScene.setState({ nodes: nodesFor(makeLevel()) })

    const result = spatialGridManager.canPlaceOnFloorFootprints(LEVEL_ID, [
      { position: [0, 0, 0], dimensions: [1, 1, 1], rotation: [0, 0, 0] },
      { position: [0.25, 0, 0], dimensions: [1, 1, 1], rotation: [0, 0, 0] },
    ])

    expect(result.valid).toBe(false)
    expect(result.conflictIds).toEqual([])
  })

  test('canPlaceOnFloorFootprints ignores descendants of an ignored composite node', () => {
    registerNode(
      makeDefinition('cabinet', {
        floorPlaced: {
          footprint: () => ({
            dimensions: [1, 1, 1],
            rotation: [0, 0, 0],
          }),
          collides: true,
        },
      }),
    )
    registerNode(
      makeDefinition('cabinet-module', {
        floorPlaced: {
          footprint: () => ({
            dimensions: [1, 1, 1],
            rotation: [0, 0, 0],
          }),
          collides: true,
        },
      }),
    )

    const level = makeLevel()
    const run = {
      id: 'cabinet_run',
      type: 'cabinet',
      object: 'node',
      parentId: LEVEL_ID,
      visible: true,
      metadata: {},
      children: ['cabinet-module_child'],
      position: [0, 0, 0],
      rotation: 0,
    } as unknown as AnyNode
    const module = {
      id: 'cabinet-module_child',
      type: 'cabinet-module',
      object: 'node',
      parentId: run.id,
      visible: true,
      metadata: {},
      children: [],
      position: [0, 0, 0],
      rotation: 0,
    } as unknown as AnyNode
    useScene.setState({ nodes: nodesFor(level, run, module) })

    const result = spatialGridManager.canPlaceOnFloorFootprints(
      LEVEL_ID,
      [{ position: [0, 0, 0], dimensions: [1, 1, 1], rotation: [0, 0, 0] }],
      [run.id],
    )

    expect(result.valid).toBe(true)
    expect(result.conflictIds).toEqual([])
  })

  test('returns 0 when applies returns false', () => {
    registerNode(
      makeDefinition('item', {
        floorPlaced: {
          footprint: () => ({ dimensions: [1, 1, 1], rotation: [0, 0, 0] }),
          applies: () => false,
        },
      }),
    )
    addSlab(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      0.4,
    )

    const level = makeLevel()
    const node = makeFloorNode()

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, node),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    ).toBe(0)
  })

  test('clamps non-finite slab elevation to 0', () => {
    registerNode(
      makeDefinition('item', {
        floorPlaced: {
          footprint: () => ({ dimensions: [1, 1, 1], rotation: [0, 0, 0] }),
        },
      }),
    )

    // A winning slab whose stored elevation is corrupt: the id must be present, or
    // the resolver takes the no-slab path and this asserts nothing.
    const original = spatialGridManager.getSlabSupportForItem
    spatialGridManager.getSlabSupportForItem = (() => ({
      elevation: Number.NaN,
      slabId: 'slab_corrupt',
    })) as typeof original

    try {
      const level = makeLevel()
      const node = makeFloorNode()

      expect(
        getFloorPlacedElevation({
          node,
          nodes: nodesFor(level, node),
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        }),
      ).toBe(0)
    } finally {
      spatialGridManager.getSlabSupportForItem = original
    }
  })

  test('returns 0 for a non-level direct parent', () => {
    registerNode(
      makeDefinition('item', {
        floorPlaced: {
          footprint: () => ({ dimensions: [1, 1, 1], rotation: [0, 0, 0] }),
        },
      }),
    )
    addSlab(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      0.4,
    )

    const level = makeLevel()
    const shelf = {
      id: 'shelf_test',
      type: 'shelf',
      parentId: LEVEL_ID,
    } as unknown as AnyNode
    const node = makeFloorNode({ parentId: shelf.id })

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, shelf, node),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    ).toBe(0)
  })

  test('returns 0 when the declared parent is missing', () => {
    registerNode(
      makeDefinition('item', {
        floorPlaced: {
          footprint: () => ({ dimensions: [1, 1, 1], rotation: [0, 0, 0] }),
        },
      }),
    )
    addSlab(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      0.4,
    )

    const node = makeFloorNode({ parentId: 'missing_level' })

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(node),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        levelId: LEVEL_ID,
      }),
    ).toBe(0)
  })

  test('uses the pending rotated footprint', () => {
    registerNode(
      makeDefinition('item', {
        floorPlaced: {
          footprint: (node) => ({
            dimensions: [4, 1, 1],
            rotation: (node as { rotation: [number, number, number] }).rotation,
          }),
        },
      }),
    )
    addSlab(
      [
        [-0.2, 1.2],
        [0.2, 1.2],
        [0.2, 1.8],
        [-0.2, 1.8],
      ],
      0.45,
    )

    const level = makeLevel()
    const node = makeFloorNode()

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, node),
        position: [0, 0, 0],
        rotation: [0, Math.PI / 2, 0],
      }),
    ).toBeCloseTo(0.45)
  })

  test('returns slab overlap elevation and stacks Y onto canonical position', () => {
    registerNode(
      makeDefinition('item', {
        floorPlaced: {
          footprint: (node) => ({
            dimensions: [1, 1, 1],
            rotation: (node as { rotation: [number, number, number] }).rotation,
          }),
        },
      }),
    )
    addSlab(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      0.35,
    )

    const level = makeLevel()
    const node = makeFloorNode()

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, node),
        position: [0, 0.1, 0],
        rotation: [0, 0, 0],
      }),
    ).toBeCloseTo(0.35)
    const stacked = getFloorStackedPosition({
      node,
      nodes: nodesFor(level, node),
      position: [0, 0.1, 0],
      rotation: [0, 0, 0],
    })
    expect(stacked[0]).toBe(0)
    expect(stacked[1]).toBeCloseTo(0.45)
    expect(stacked[2]).toBe(0)
  })

  test('takes the max elevation across composite footprints', () => {
    registerNode(
      makeDefinition('item', {
        floorPlaced: {
          footprints: () => [
            { position: [0, 0, 0], dimensions: [1, 1, 1], rotation: [0, 0, 0] },
            { position: [3, 0, 0], dimensions: [1, 1, 1], rotation: [0, 0, 0] },
          ],
        },
      }),
    )
    addSlab(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      0.2,
      'slab_low',
    )
    addSlab(
      [
        [2.5, -0.5],
        [3.5, -0.5],
        [3.5, 0.5],
        [2.5, 0.5],
      ],
      0.8,
      'slab_high',
    )

    const level = makeLevel()
    const node = makeFloorNode()

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, node),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    ).toBeCloseTo(0.8)
  })

  describe('terrain as the level base', () => {
    function registerItem(capabilities: Record<string, unknown> = {}) {
      registerNode(
        makeDefinition('item', {
          floorPlaced: {
            footprint: () => ({ dimensions: [1, 1, 1], rotation: [0, 0, 0] }),
            ...capabilities,
          },
        }),
      )
    }

    test('the no-winning-support fallback follows the ground', () => {
      registerItem()
      const level = makeLevel()
      const site = makeSite()
      const node = makeFloorNode()

      // No slab anywhere, so the node rests on the level base — the terrain.
      expect(
        getFloorPlacedElevation({
          node,
          nodes: nodesFor(site, level, node),
          position: ON_PLATEAU,
          rotation: [0, 0, 0],
        }),
      ).toBeCloseTo(PLATEAU_HEIGHT)

      // Off the plateau the same scene reports flat ground, so nothing moves.
      expect(
        getFloorPlacedElevation({
          node,
          nodes: nodesFor(site, level, node),
          position: [-3, 0, -3],
          rotation: [0, 0, 0],
        }),
      ).toBeCloseTo(0)
    })

    test('an elected slab still wins over the ground under it', () => {
      registerItem()
      addSlab(
        [
          [2, 2],
          [5, 2],
          [5, 5],
          [2, 5],
        ],
        0.35,
      )
      const level = makeLevel()
      const site = makeSite()
      const node = makeFloorNode()

      // A built floor is flat by definition — terrain does not compete with one.
      expect(
        getFloorPlacedElevation({
          node,
          nodes: nodesFor(site, level, node),
          position: ON_PLATEAU,
          rotation: [0, 0, 0],
        }),
      ).toBeCloseTo(0.35)
    })

    test('the ground sentinel host resolves to the ground, not to 0', () => {
      registerItem()
      // A deck overlapping the footprint above the pointer cap: the sentinel is
      // exactly what stops the election from lifting the node onto it, and before
      // terrain it meant "y = 0". Now it means "the ground under this node".
      addSlab(
        [
          [2, 2],
          [5, 2],
          [5, 5],
          [2, 5],
        ],
        1.2,
        'slab_deck',
      )
      const level = makeLevel()
      const site = makeSite()
      const node = makeFloorNode({ supportSlabId: GROUND_SUPPORT_ID } as Partial<AnyNode>)

      expect(
        getFloorPlacedElevation({
          node,
          nodes: nodesFor(site, level, node),
          position: ON_PLATEAU,
          rotation: [0, 0, 0],
        }),
      ).toBeCloseTo(PLATEAU_HEIGHT)
    })

    test('stacks the ground onto the canonical position', () => {
      registerItem()
      const level = makeLevel()
      const site = makeSite()
      const node = makeFloorNode()

      const stacked = getFloorStackedPosition({
        node,
        nodes: nodesFor(site, level, node),
        position: [3, 0.1, 3],
        rotation: [0, 0, 0],
      })
      expect(stacked[0]).toBe(3)
      expect(stacked[1]).toBeCloseTo(PLATEAU_HEIGHT + 0.1)
      expect(stacked[2]).toBe(3)
    })

    test('a composite footprint straddling a recess rests on the higher support', () => {
      registerNode(
        makeDefinition('item', {
          floorPlaced: {
            footprints: () => [
              { position: [3, 0, 3], dimensions: [1, 1, 1], rotation: [0, 0, 0] },
              { position: [-3, 0, -3], dimensions: [1, 1, 1], rotation: [0, 0, 0] },
            ],
          },
        }),
      )
      // A recess under one half only. Electing the base per footprint is what keeps
      // the node on the flat ground the other half sits on instead of sinking it.
      addSlab(
        [
          [2, 2],
          [5, 2],
          [5, 5],
          [2, 5],
        ],
        -0.3,
        'slab_recess',
      )
      const level = makeLevel()
      const node = makeFloorNode()

      // Without terrain: the bare-floor half wins at 0, not the recess at -0.3.
      expect(
        getFloorPlacedElevation({
          node,
          nodes: nodesFor(level, node),
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        }),
      ).toBeCloseTo(0)

      // With terrain the ground under the node is the plateau, which still wins.
      expect(
        getFloorPlacedElevation({
          node,
          nodes: nodesFor(makeSite(), level, node),
          position: ON_PLATEAU,
          rotation: [0, 0, 0],
        }),
      ).toBeCloseTo(PLATEAU_HEIGHT)
    })

    test('the six no-op branches still return exactly 0 over terrain', () => {
      // The whole risk of this change: `0` in these branches means "do not touch
      // this node's Y", not "the ground is at 0". Substituting terrain here would
      // lift wall sconces off their walls and cabinet interiors out of their runs.
      const site = makeSite()
      const level = makeLevel()

      const atZero = (nodes: Record<string, AnyNode>, node: AnyNode, levelId?: string) =>
        getFloorPlacedElevation({
          node,
          nodes,
          position: ON_PLATEAU,
          rotation: [0, 0, 0],
          ...(levelId ? { levelId } : {}),
        })

      // 1. No floorPlaced capability.
      registerNode(makeDefinition('item'))
      const plain = makeFloorNode()
      expect(atZero(nodesFor(site, level, plain), plain)).toBe(0)

      // 2. `applies` opts out — the wall-mounted case.
      nodeRegistry._reset()
      registerItem({ applies: () => false })
      expect(atZero(nodesFor(site, level, plain), plain)).toBe(0)

      // 3. The declared parent is missing.
      nodeRegistry._reset()
      registerItem()
      const orphan = makeFloorNode({ parentId: 'missing_level' })
      expect(atZero(nodesFor(site, orphan), orphan)).toBe(0)

      // 4. A non-`level` parent — hosted by a shelf, not by the storey.
      const shelf = { id: 'shelf_test', type: 'shelf', parentId: LEVEL_ID } as unknown as AnyNode
      const shelved = makeFloorNode({ parentId: shelf.id })
      expect(atZero(nodesFor(site, level, shelf, shelved), shelved)).toBe(0)

      // 5. No parent and no levelId.
      const unparented = makeFloorNode({ parentId: null })
      expect(atZero(nodesFor(site, unparented), unparented)).toBe(0)

      // 6. An empty levelId string resolves to nothing.
      expect(atZero(nodesFor(site, unparented), unparented, '')).toBe(0)
    })
  })
})
