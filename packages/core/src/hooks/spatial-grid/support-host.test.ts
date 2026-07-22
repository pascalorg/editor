import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../../registry'
import type { AnyNodeDefinition } from '../../registry/types'
import type { AnyNode, AnyNodeId, SlabNode } from '../../schema'
import { WallNode } from '../../schema'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import { resolveWallEffectiveHeight, resolveWallTop } from '../../systems/wall/wall-top'
import { getFloorPlacedElevation } from './floor-placed-elevation'
import { spatialGridManager } from './spatial-grid-manager'
import { initSpatialGridSync } from './spatial-grid-sync'
import { resolveSupportSlabPatch, resolveWallSupportSlabPatch } from './support-host-patch'

const LEVEL_ID = 'level_test'

const SQUARE: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]

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

function makeLevel(children: string[] = []): AnyNode {
  return {
    id: LEVEL_ID,
    type: 'level',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children,
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

function nodesFor(...nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

describe('persisted support hosts (items)', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    spatialGridManager.clear()
    useScene.setState({ nodes: {} })
  })

  test('no-host election over stacked slabs keeps returning the highest elevation', () => {
    registerFloorPlacedItem()
    addSlab(makeSlab('slab_low', SQUARE, 0.2))
    addSlab(makeSlab('slab_high', SQUARE, 0.8))

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

  test('a persisted host wins over the election, whichever slab it names', () => {
    registerFloorPlacedItem()
    addSlab(makeSlab('slab_low', SQUARE, 0.2))
    addSlab(makeSlab('slab_high', SQUARE, 0.8))

    const level = makeLevel()
    const hostedLow = makeFloorNode({ supportSlabId: 'slab_low' } as Partial<AnyNode>)
    const hostedHigh = makeFloorNode({ supportSlabId: 'slab_high' } as Partial<AnyNode>)

    expect(
      getFloorPlacedElevation({
        node: hostedLow,
        nodes: nodesFor(level, hostedLow),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    ).toBeCloseTo(0.2)
    expect(
      getFloorPlacedElevation({
        node: hostedHigh,
        nodes: nodesFor(level, hostedHigh),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    ).toBeCloseTo(0.8)
  })

  test('a host reshaped away falls back without clearing the field, and resumes on return', () => {
    registerFloorPlacedItem()
    const host = makeSlab('slab_low', SQUARE, 0.2)
    addSlab(host)
    addSlab(makeSlab('slab_high', SQUARE, 0.8))

    const level = makeLevel()
    const node = makeFloorNode({ supportSlabId: 'slab_low' } as Partial<AnyNode>)
    const args = {
      node,
      nodes: nodesFor(level, node),
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    }

    expect(getFloorPlacedElevation(args)).toBeCloseTo(0.2)

    // Reshape the host away from the item's footprint.
    const movedAway: Array<[number, number]> = [
      [10, 10],
      [12, 10],
      [12, 12],
      [10, 12],
    ]
    spatialGridManager.handleNodeUpdated(makeSlab('slab_low', movedAway, 0.2) as AnyNode, LEVEL_ID)
    expect(getFloorPlacedElevation(args)).toBeCloseTo(0.8)
    expect((node as { supportSlabId?: string }).supportSlabId).toBe('slab_low')

    // Reshape it back — the stale reference resumes hosting.
    spatialGridManager.handleNodeUpdated(host as AnyNode, LEVEL_ID)
    expect(getFloorPlacedElevation(args)).toBeCloseTo(0.2)
  })

  test('getSlabSupportForItem surfaces the winning slab id', () => {
    addSlab(makeSlab('slab_low', SQUARE, 0.2))
    addSlab(makeSlab('slab_high', SQUARE, 0.8))

    expect(
      spatialGridManager.getSlabSupportForItem(LEVEL_ID, [0, 0, 0], [1, 1, 1], [0, 0, 0]),
    ).toEqual({ elevation: 0.8, slabId: 'slab_high' })
    expect(
      spatialGridManager.getSlabSupportForItem(LEVEL_ID, [20, 0, 20], [1, 1, 1], [0, 0, 0]),
    ).toEqual({ elevation: 0, slabId: null })
  })

  test('getSupportCandidatesForFootprint lists distinct overlapping slabs, highest first', () => {
    addSlab(makeSlab('slab_low', SQUARE, 0.2))
    addSlab(makeSlab('slab_high', SQUARE, 0.8))
    addSlab(
      makeSlab(
        'slab_far',
        [
          [10, 10],
          [12, 10],
          [12, 12],
          [10, 12],
        ],
        0.5,
      ),
    )

    expect(
      spatialGridManager.getSupportCandidatesForFootprint(
        LEVEL_ID,
        [0, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
      ),
    ).toEqual([
      { slabId: 'slab_high', elevation: 0.8 },
      { slabId: 'slab_low', elevation: 0.2 },
    ])
    expect(
      spatialGridManager.getSupportCandidatesForFootprint(
        LEVEL_ID,
        [20, 0, 20],
        [1, 1, 1],
        [0, 0, 0],
      ),
    ).toEqual([])
  })

  test('resolveSupportSlabPatch persists only an ambiguous stacked-slab winner', () => {
    registerFloorPlacedItem()
    const low = makeSlab('slab_low', SQUARE, 0.2)
    const high = makeSlab('slab_high', SQUARE, 0.8)
    addSlab(low)
    addSlab(high)

    const level = makeLevel()
    const node = makeFloorNode()
    const nodes = nodesFor(level, node, low as AnyNode, high as AnyNode)
    expect(resolveSupportSlabPatch(node, nodes)).toEqual({ supportSlabId: 'slab_high' })

    spatialGridManager.handleNodeDeleted(high.id, 'slab', LEVEL_ID)
    expect(resolveSupportSlabPatch(node, nodesFor(level, node, low as AnyNode))).toEqual({
      supportSlabId: undefined,
    })
  })

  test('item support follows the RENDERED slab polygon (wall band adoption)', () => {
    registerFloorPlacedItem()

    // Room slab drawn on the wall centerlines; the rendered polygon
    // extends to the walls' outer faces (x/z ± 0.05 for 0.1-thick walls).
    const roomPolygon: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.1, parentId: LEVEL_ID }),
      WallNode.parse({ start: [4, 0], end: [4, 3], thickness: 0.1, parentId: LEVEL_ID }),
      WallNode.parse({ start: [4, 3], end: [0, 3], thickness: 0.1, parentId: LEVEL_ID }),
      WallNode.parse({ start: [0, 3], end: [0, 0], thickness: 0.1, parentId: LEVEL_ID }),
    ]
    const level = makeLevel(walls.map((wall) => wall.id))
    const node = makeFloorNode()
    useScene.setState({ nodes: nodesFor(level, node, ...(walls as AnyNode[])) })
    // Grounded raised floor (thickness = elevation): band adoption only
    // applies to grounded slabs — a floating deck keeps its drawn polygon.
    addSlab(makeSlab('slab_room', roomPolygon, 0.4, { thickness: 0.4 }))

    // Footprint fully outside the STORED polygon (x from 4.0 to 4.6 with a
    // 0.01 overlap inset) but inside the rendered band edge at x = 4.05.
    const elevation = spatialGridManager.getSlabElevationForItem(
      LEVEL_ID,
      [4.3, 0, 1.5],
      [0.6, 1, 0.6],
      [0, 0, 0],
    )
    expect(elevation).toBeCloseTo(0.4)

    // The manager sees wall changes: removing the walls drops the adopted
    // band, so the same footprint stops electing the slab.
    for (const wall of walls) {
      spatialGridManager.handleNodeDeleted(wall.id, 'wall', LEVEL_ID)
    }
    useScene.setState({ nodes: nodesFor(makeLevel(), node) })
    expect(
      spatialGridManager.getSlabElevationForItem(LEVEL_ID, [4.3, 0, 1.5], [0.6, 1, 0.6], [0, 0, 0]),
    ).toBe(0)
  })
})

describe('persisted support hosts (walls, via the manager)', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    spatialGridManager.clear()
    useScene.setState({ nodes: {} })
  })

  test('preferred slab pins the elected elevation; invalid preference falls back', () => {
    const polygon: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    addSlab(makeSlab('slab_low', polygon, 0.1))
    addSlab(makeSlab('slab_high', polygon, 0.6))

    const start: [number, number] = [0, 1.5]
    const end: [number, number] = [4, 1.5]

    const elected = spatialGridManager.getSlabSupportForWall(LEVEL_ID, start, end)
    expect(elected.elevation).toBeCloseTo(0.6)
    expect(elected.electedSlabId).toBe('slab_high')

    const preferred = spatialGridManager.getSlabSupportForWall(
      LEVEL_ID,
      start,
      end,
      0,
      0.1,
      'slab_low',
    )
    expect(preferred.elevation).toBeCloseTo(0.1)
    expect(preferred.electedSlabId).toBe('slab_low')

    const fallback = spatialGridManager.getSlabSupportForWall(
      LEVEL_ID,
      start,
      end,
      0,
      0.1,
      'slab_missing',
    )
    expect(fallback.elevation).toBeCloseTo(0.6)
    expect(fallback.electedSlabId).toBe('slab_high')
  })

  test('resolveWallSupportSlabPatch persists the winner over two elevations', () => {
    const low = makeSlab(
      'slab_low',
      [
        [-2, -1],
        [0, -1],
        [0, 1],
        [-2, 1],
      ],
      0.2,
    )
    const high = makeSlab(
      'slab_high',
      [
        [0, -1],
        [2, -1],
        [2, 1],
        [0, 1],
      ],
      0.8,
    )
    const wall = WallNode.parse({
      id: 'wall_test',
      parentId: LEVEL_ID,
      start: [-2, 0],
      end: [2, 0],
      thickness: 0.1,
    })
    const level = makeLevel([low.id, high.id, wall.id])
    const nodes = nodesFor(level, low as AnyNode, high as AnyNode, wall as AnyNode)
    useScene.setState({ nodes })
    addSlab(low)
    addSlab(high)

    expect(resolveWallSupportSlabPatch(wall, nodes)).toEqual({
      supportSlabId: 'slab_high',
    })
  })

  // Elevated deck stacked over a ground floor slab — the "wall on a deck"
  // fixture (both slabs cover the wall band; the deck sits above).
  const DECK_ELEVATION = 0.9
  const FLOOR_ELEVATION = 0.05
  function makeDeckOverFloorFixture() {
    const deck = makeSlab(
      'slab_deck',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      DECK_ELEVATION,
    )
    const ground = makeSlab(
      'slab_ground',
      [
        [-6, -6],
        [6, -6],
        [6, 6],
        [-6, 6],
      ],
      FLOOR_ELEVATION,
    )
    const wall = WallNode.parse({
      id: 'wall_on_deck',
      parentId: LEVEL_ID,
      start: [0.5, 1.5],
      end: [3.5, 1.5],
      thickness: 0.1,
    })
    const level = makeLevel([deck.id, ground.id, wall.id])
    const nodes = nodesFor(level, deck as AnyNode, ground as AnyNode, wall as AnyNode)
    useScene.setState({ nodes })
    addSlab(deck)
    addSlab(ground)
    return { wall, nodes }
  }

  test('a wall whose band lies over an elevated deck bases on the deck with a plane-bound top', () => {
    const { wall, nodes } = makeDeckOverFloorFixture()

    const support = spatialGridManager.getSlabSupportForWall(
      LEVEL_ID,
      wall.start,
      wall.end,
      0,
      wall.thickness,
    )
    expect(support.electedSlabId).toBe('slab_deck')
    expect(support.elevation).toBeCloseTo(DECK_ELEVATION)

    // Wall-top inversion: no stored height → the top stays at the storey
    // plane, so the extruded body is the plane minus the deck base.
    const storeyHeight = 2.7
    expect(resolveWallTop(wall, storeyHeight, support.elevation)).toBeCloseTo(storeyHeight)
    expect(resolveWallEffectiveHeight(wall, storeyHeight, support.elevation)).toBeCloseTo(
      storeyHeight - DECK_ELEVATION,
    )

    // Commit persists the deck deterministically (two candidate elevations).
    expect(resolveWallSupportSlabPatch(wall, nodes)).toEqual({ supportSlabId: 'slab_deck' })
  })

  test('pointer cap: aiming at the floor under the deck elects and persists the floor', () => {
    const { wall, nodes } = makeDeckOverFloorFixture()

    const capped = spatialGridManager.getSlabSupportForWall(
      LEVEL_ID,
      wall.start,
      wall.end,
      0,
      wall.thickness,
      null,
      FLOOR_ELEVATION,
    )
    expect(capped.electedSlabId).toBe('slab_ground')
    expect(capped.elevation).toBeCloseTo(FLOOR_ELEVATION)

    expect(resolveWallSupportSlabPatch(wall, nodes, { maxElevation: FLOOR_ELEVATION })).toEqual({
      supportSlabId: 'slab_ground',
    })
    // Aiming at the deck top keeps the deck.
    expect(resolveWallSupportSlabPatch(wall, nodes, { maxElevation: DECK_ELEVATION })).toEqual({
      supportSlabId: 'slab_deck',
    })
  })
})

describe('deleteNodesAction strips supportSlabId references', () => {
  let stopSync = () => {}

  beforeEach(() => {
    nodeRegistry._reset()
    spatialGridManager.clear()
    registerFloorPlacedItem()

    const slabLow = makeSlab('slab_low', SQUARE, 0.2)
    const slabHigh = makeSlab('slab_high', SQUARE, 0.8)
    const item = makeFloorNode({ supportSlabId: 'slab_low' } as Partial<AnyNode>)
    const level = makeLevel(['slab_low', 'slab_high', item.id])

    useScene.setState({
      collections: {},
      dirtyNodes: new Set<AnyNodeId>(),
      nodes: nodesFor(level, slabLow as AnyNode, slabHigh as AnyNode, item),
      readOnly: false,
      rootNodeIds: [LEVEL_ID as AnyNodeId],
    } as never)
    clearSceneHistory()
    stopSync = initSpatialGridSync()
  })

  afterEach(() => {
    stopSync()
    stopSync = () => {}
  })

  function itemElevation(): number {
    const nodes = useScene.getState().nodes
    const item = nodes['item_test' as AnyNodeId]!
    return getFloorPlacedElevation({
      node: item,
      nodes,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    })
  }

  test('deleting the host slab clears the reference and re-elects; undo restores both', () => {
    expect(itemElevation()).toBeCloseTo(0.2)

    useScene.getState().deleteNodes(['slab_low' as AnyNodeId])

    const afterDelete = useScene.getState().nodes
    expect(afterDelete['slab_low' as AnyNodeId]).toBeUndefined()
    expect(
      (afterDelete['item_test' as AnyNodeId] as { supportSlabId?: string }).supportSlabId,
    ).toBeUndefined()
    expect(itemElevation()).toBeCloseTo(0.8)

    useScene.temporal.getState().undo()

    const afterUndo = useScene.getState().nodes
    expect(afterUndo['slab_low' as AnyNodeId]).toBeDefined()
    expect((afterUndo['item_test' as AnyNodeId] as { supportSlabId?: string }).supportSlabId).toBe(
      'slab_low',
    )
    expect(itemElevation()).toBeCloseTo(0.2)
  })

  test('deleting a non-host slab leaves the reference alone', () => {
    useScene.getState().deleteNodes(['slab_high' as AnyNodeId])

    expect(
      (useScene.getState().nodes['item_test' as AnyNodeId] as { supportSlabId?: string })
        .supportSlabId,
    ).toBe('slab_low')
    expect(itemElevation()).toBeCloseTo(0.2)
  })

  test('deleting the destination deck strips deckSlabId from stairs; undo restores it', () => {
    const stair = {
      id: 'stair_test',
      type: 'stair',
      object: 'node',
      parentId: LEVEL_ID,
      visible: true,
      metadata: {},
      children: [],
      position: [0, 0, 0],
      rotation: 0,
      deckSlabId: 'slab_low',
    } as unknown as AnyNode

    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        stair_test: stair,
        [LEVEL_ID]: {
          ...useScene.getState().nodes[LEVEL_ID as AnyNodeId]!,
          children: ['slab_low', 'slab_high', 'item_test', 'stair_test'],
        } as AnyNode,
      } as never,
    })
    clearSceneHistory()

    useScene.getState().deleteNodes(['slab_low' as AnyNodeId])

    const afterDelete = useScene.getState().nodes
    expect(
      (afterDelete['stair_test' as AnyNodeId] as { deckSlabId?: string }).deckSlabId,
    ).toBeUndefined()

    useScene.temporal.getState().undo()

    const afterUndo = useScene.getState().nodes
    expect(afterUndo['slab_low' as AnyNodeId]).toBeDefined()
    expect((afterUndo['stair_test' as AnyNodeId] as { deckSlabId?: string }).deckSlabId).toBe(
      'slab_low',
    )
  })

  test('deleting a slab that is not the destination deck leaves deckSlabId alone', () => {
    const stair = {
      id: 'stair_test',
      type: 'stair',
      object: 'node',
      parentId: LEVEL_ID,
      visible: true,
      metadata: {},
      children: [],
      position: [0, 0, 0],
      rotation: 0,
      deckSlabId: 'slab_low',
    } as unknown as AnyNode

    useScene.setState({
      nodes: { ...useScene.getState().nodes, stair_test: stair } as never,
    })

    useScene.getState().deleteNodes(['slab_high' as AnyNodeId])

    expect(
      (useScene.getState().nodes['stair_test' as AnyNodeId] as { deckSlabId?: string }).deckSlabId,
    ).toBe('slab_low')
  })
})
