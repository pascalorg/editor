import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../../registry'
import type { AnyNodeDefinition } from '../../registry/types'
import type { AnyNode, SlabNode } from '../../schema'
import useScene from '../../store/use-scene'
import { GROUND_SUPPORT_ID, getFloorPlacedElevation } from './floor-placed-elevation'
import { spatialGridManager } from './spatial-grid-manager'
import { resolveSupportSlabPatch } from './support-host-patch'

const LEVEL_ID = 'level_test'

/** Deck footprint in plan: x/z ∈ [-1, 1]. */
const DECK_POLYGON: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]

/** Ground floor slab under (and far beyond) the deck: x/z ∈ [-5, 5]. */
const GROUND_POLYGON: Array<[number, number]> = [
  [-5, -5],
  [5, -5],
  [5, 5],
  [-5, 5],
]

const DECK_ELEVATION = 0.9
const FLOOR_ELEVATION = 0.05

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

function registerFloorPlacedItem() {
  registerNode(
    makeDefinition('item', {
      floorPlaced: {
        footprint: () => ({ dimensions: [1, 1, 1], rotation: [0, 0, 0] }),
      },
    }),
  )
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

function makeSlab(
  id: string,
  polygon: Array<[number, number]>,
  elevation: number,
  overrides: Partial<SlabNode> = {},
): SlabNode {
  return {
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
    autoFromWalls: false,
    ...overrides,
  } as SlabNode
}

function addSlab(slab: SlabNode) {
  spatialGridManager.handleNodeCreated(slab as AnyNode, LEVEL_ID)
}

function addDeckAndFloor() {
  addSlab(makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION))
  addSlab(makeSlab('slab_floor', GROUND_POLYGON, FLOOR_ELEVATION))
}

function nodesFor(...nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

beforeEach(() => {
  nodeRegistry._reset()
  spatialGridManager.clear()
  useScene.setState({ nodes: {} })
})

describe('pointer-capped slab support election', () => {
  test('hit at the floor under the deck elects the floor, not the deck above', () => {
    addDeckAndFloor()
    expect(
      spatialGridManager.getSlabSupportForItem(
        LEVEL_ID,
        [0, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
        FLOOR_ELEVATION,
      ),
    ).toEqual({ elevation: FLOOR_ELEVATION, slabId: 'slab_floor' })
  })

  test('hit on the deck top still elects the deck', () => {
    addDeckAndFloor()
    expect(
      spatialGridManager.getSlabSupportForItem(
        LEVEL_ID,
        [0, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
        DECK_ELEVATION,
      ),
    ).toEqual({ elevation: DECK_ELEVATION, slabId: 'slab_deck' })
  })

  test('no cap keeps the historical max election', () => {
    addDeckAndFloor()
    expect(
      spatialGridManager.getSlabSupportForItem(LEVEL_ID, [0, 0, 0], [1, 1, 1], [0, 0, 0]),
    ).toEqual({ elevation: DECK_ELEVATION, slabId: 'slab_deck' })
  })

  test('epsilon boundary: a slab within EPS above the cap is elected, beyond EPS is not', () => {
    // Cap 0.05 with EPS 0.05: a slab at 0.10 is still electable, 0.11 is not.
    addSlab(makeSlab('slab_within', DECK_POLYGON, 0.1))
    expect(
      spatialGridManager.getSlabSupportForItem(LEVEL_ID, [0, 0, 0], [1, 1, 1], [0, 0, 0], 0.05),
    ).toEqual({ elevation: 0.1, slabId: 'slab_within' })

    spatialGridManager.clear()
    addSlab(makeSlab('slab_beyond', DECK_POLYGON, 0.11))
    expect(
      spatialGridManager.getSlabSupportForItem(LEVEL_ID, [0, 0, 0], [1, 1, 1], [0, 0, 0], 0.05),
    ).toEqual({ elevation: 0, slabId: null })
  })
})

describe('getPointedSupportSurface (ray → aimed-at walking surface)', () => {
  test('ray aimed at the floor under the deck resolves the floor, aimed at the deck resolves the deck', () => {
    addDeckAndFloor()

    // Camera in front of the deck (negative z), high up. Aiming at the
    // floor point (0, FLOOR, 0) — a point that lies UNDER the deck in
    // plan — crosses the deck's elevation plane before reaching the deck
    // polygon, so only the floor is hit.
    const origin: [number, number, number] = [0, 5, -10]
    const toFloorUnderDeck: [number, number, number] = [
      0 - origin[0],
      FLOOR_ELEVATION - origin[1],
      0 - origin[2],
    ]
    expect(spatialGridManager.getPointedSupportSurface(LEVEL_ID, origin, toFloorUnderDeck)).toEqual(
      { elevation: FLOOR_ELEVATION, slabId: 'slab_floor' },
    )

    // Aiming at the deck's top surface: the deck plane crossing lands
    // inside the deck polygon and is nearer along the ray than the floor.
    const toDeckTop: [number, number, number] = [
      0 - origin[0],
      DECK_ELEVATION - origin[1],
      0.5 - origin[2],
    ]
    expect(spatialGridManager.getPointedSupportSurface(LEVEL_ID, origin, toDeckTop)).toEqual({
      elevation: DECK_ELEVATION,
      slabId: 'slab_deck',
    })
  })

  test('a ray through a deck hole falls through to the surface below', () => {
    addSlab(
      makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION, {
        holes: [
          [
            [-0.5, -0.5],
            [0.5, -0.5],
            [0.5, 0.5],
            [-0.5, 0.5],
          ],
        ],
      }),
    )
    addSlab(makeSlab('slab_floor', GROUND_POLYGON, FLOOR_ELEVATION))

    // Straight down through the hole center.
    expect(spatialGridManager.getPointedSupportSurface(LEVEL_ID, [0, 5, 0], [0, -1, 0])).toEqual({
      elevation: FLOOR_ELEVATION,
      slabId: 'slab_floor',
    })
  })

  test('no slab crossing resolves the level base', () => {
    addSlab(makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION))
    expect(spatialGridManager.getPointedSupportSurface(LEVEL_ID, [3, 5, 3], [0, -1, 0])).toEqual({
      elevation: 0,
      slabId: null,
    })
  })
})

describe('getFloorPlacedElevation under a pointer cap', () => {
  test('cap at the floor keeps the item on the floor even though the deck overlaps in plan', () => {
    registerFloorPlacedItem()
    addDeckAndFloor()
    const level = makeLevel()
    const node = makeFloorNode()

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, node),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        maxElevation: FLOOR_ELEVATION,
      }),
    ).toBeCloseTo(FLOOR_ELEVATION)

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, node),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        maxElevation: DECK_ELEVATION,
      }),
    ).toBeCloseTo(DECK_ELEVATION)

    // Uncapped read keeps the historical max election.
    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, node),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    ).toBeCloseTo(DECK_ELEVATION)
  })

  test('the pointer cap bypasses a persisted host — the cursor decides during a drag', () => {
    registerFloorPlacedItem()
    addDeckAndFloor()
    const level = makeLevel()
    const node = makeFloorNode({ supportSlabId: 'slab_deck' } as Partial<AnyNode>)

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, node),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        maxElevation: FLOOR_ELEVATION,
      }),
    ).toBeCloseTo(FLOOR_ELEVATION)
  })

  test('the ground sentinel pins a committed node to the level base under an overlapping deck', () => {
    registerFloorPlacedItem()
    addSlab(makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION))
    const level = makeLevel()
    const node = makeFloorNode({ supportSlabId: GROUND_SUPPORT_ID } as Partial<AnyNode>)

    expect(
      getFloorPlacedElevation({
        node,
        nodes: nodesFor(level, node),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    ).toBe(0)
  })
})

describe('resolveSupportSlabPatch under a pointer cap (commit determinism)', () => {
  test('a commit under the deck persists the elected lower slab', () => {
    registerFloorPlacedItem()
    addDeckAndFloor()
    const level = makeLevel()
    const node = makeFloorNode()
    const nodes = nodesFor(level, node)

    expect(resolveSupportSlabPatch(node, nodes, { maxElevation: FLOOR_ELEVATION })).toEqual({
      supportSlabId: 'slab_floor',
    })
    expect(resolveSupportSlabPatch(node, nodes, { maxElevation: DECK_ELEVATION })).toEqual({
      supportSlabId: 'slab_deck',
    })
    // Uncapped commits keep the historical rule (max winner on ambiguity).
    expect(resolveSupportSlabPatch(node, nodes)).toEqual({ supportSlabId: 'slab_deck' })
  })

  test('a commit on bare ground under the deck persists the ground sentinel', () => {
    registerFloorPlacedItem()
    addSlab(makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION))
    const level = makeLevel()
    const node = makeFloorNode()
    const nodes = nodesFor(level, node)

    expect(resolveSupportSlabPatch(node, nodes, { maxElevation: 0 })).toEqual({
      supportSlabId: GROUND_SUPPORT_ID,
    })
    // Aiming at the deck top with only the deck overlapping stays
    // unambiguous — no host persisted, same as the uncapped rule.
    expect(resolveSupportSlabPatch(node, nodes, { maxElevation: DECK_ELEVATION })).toEqual({
      supportSlabId: undefined,
    })
  })

  test('a single floor slab under the cap stays unpersisted (unambiguous)', () => {
    registerFloorPlacedItem()
    addSlab(makeSlab('slab_floor', GROUND_POLYGON, FLOOR_ELEVATION))
    const level = makeLevel()
    const node = makeFloorNode()
    const nodes = nodesFor(level, node)

    expect(resolveSupportSlabPatch(node, nodes, { maxElevation: FLOOR_ELEVATION })).toEqual({
      supportSlabId: undefined,
    })
  })
})
