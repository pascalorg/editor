import { beforeEach, describe, expect, it } from 'bun:test'
import {
  planStairFlightHeightEdit,
  planStairRiseEdit,
  resolveStairArcLayout,
  useScene,
} from '@pascal-app/core'
import { z } from 'zod'
import {
  GROUND_SUPPORT_ID,
  getFloorPlacedElevation,
} from '../../hooks/spatial-grid/floor-placed-elevation'
import { spatialGridManager } from '../../hooks/spatial-grid/spatial-grid-manager'
import { nodeRegistry, registerNode } from '../../registry'
import type { AnyNodeDefinition } from '../../registry/types'
import type { AnyNode, StairNode as StairNodeType } from '../../schema'
import { BuildingNode, LevelNode, SlabNode, StairNode, StairSegmentNode } from '../../schema'
import { resolveStairTotalRise, syncStairRises } from './stair-rise'

// The deck branch elects the stair's floor-stack base through the node
// registry + spatial grid singletons — reset them so tests are hermetic
// (base elects 0 unless a test registers a stair footprint and slabs).
beforeEach(() => {
  nodeRegistry._reset()
  spatialGridManager.clear()
})

function buildScene(levelHeight: number | undefined, totalRise: number | undefined) {
  const stair = StairNode.parse({
    id: 'stair_1',
    type: 'stair',
    position: [0, 0, 0],
    ...(totalRise !== undefined ? { totalRise } : {}),
  })
  const level = LevelNode.parse({
    id: 'level_1',
    type: 'level',
    level: 0,
    children: ['stair_1'],
    ...(levelHeight !== undefined ? { height: levelHeight } : {}),
  })
  return { stair, nodes: { level_1: level, stair_1: stair } }
}

function makeDeck(elevation: number, polygon?: Array<[number, number]>) {
  return SlabNode.parse({
    id: 'slab_deck',
    type: 'slab',
    polygon: polygon ?? [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
    elevation,
    thickness: 0.05,
  })
}

function buildDeckScene(options: {
  deckElevation: number
  deckPolygon?: Array<[number, number]>
  totalRise?: number
  deckSlabId?: string
  segments?: Array<{ id: string; segmentType: 'stair' | 'landing'; height: number }>
}) {
  const deck = makeDeck(options.deckElevation, options.deckPolygon)
  const segments = (options.segments ?? []).map((segment) =>
    StairSegmentNode.parse({
      id: segment.id,
      type: 'stair-segment',
      segmentType: segment.segmentType,
      width: 1,
      length: 2,
      height: segment.height,
      stepCount: 8,
      parentId: 'stair_1',
    }),
  )
  const stair = StairNode.parse({
    id: 'stair_1',
    type: 'stair',
    position: [0, 0, 0],
    deckSlabId: options.deckSlabId ?? deck.id,
    children: segments.map((segment) => segment.id),
    ...(options.totalRise !== undefined ? { totalRise: options.totalRise } : {}),
  })
  const level = LevelNode.parse({
    id: 'level_1',
    type: 'level',
    level: 0,
    height: 2.5,
    children: ['stair_1', deck.id],
  })
  const nodes: Record<string, AnyNode> = {
    level_1: level,
    stair_1: stair,
    [deck.id]: deck,
  }
  for (const segment of segments) nodes[segment.id] = segment
  return { deck, stair, nodes }
}

function registerStairFootprint() {
  registerNode({
    kind: 'stair',
    schemaVersion: 1,
    schema: z.object({ type: z.literal('stair') }) as never,
    category: 'structure',
    defaults: () => ({}) as never,
    capabilities: {
      floorPlaced: {
        footprints: (node) => [
          {
            position: (node as StairNodeType).position,
            dimensions: [1, 1, 2] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
          },
        ],
      },
    },
  } as AnyNodeDefinition)
}

function buildLevelSceneWithSegments(options: {
  levelHeight: number
  totalRise?: number
  segments: Array<{ id: string; segmentType: 'stair' | 'landing'; height: number }>
}) {
  const segments = options.segments.map((segment) =>
    StairSegmentNode.parse({
      id: segment.id,
      type: 'stair-segment',
      segmentType: segment.segmentType,
      width: 1,
      length: 2,
      height: segment.height,
      stepCount: 8,
      parentId: 'stair_1',
    }),
  )
  const stair = StairNode.parse({
    id: 'stair_1',
    type: 'stair',
    position: [0, 0, 0],
    children: segments.map((segment) => segment.id),
    ...(options.totalRise !== undefined ? { totalRise: options.totalRise } : {}),
  })
  const level = LevelNode.parse({
    id: 'level_1',
    type: 'level',
    level: 0,
    height: options.levelHeight,
    children: ['stair_1'],
  })
  const nodes: Record<string, AnyNode> = { level_1: level, stair_1: stair }
  for (const segment of segments) nodes[segment.id] = segment
  return { level, stair, nodes }
}

describe('resolveStairTotalRise', () => {
  it('derives the rise from the containing level stored height when absent', () => {
    const { stair, nodes } = buildScene(3.2, undefined)
    expect(resolveStairTotalRise(stair, nodes)).toBe(3.2)
  })

  it('tracks a storey height change without any stair write', () => {
    const { stair, nodes } = buildScene(2.55, undefined)
    expect(resolveStairTotalRise(stair, nodes)).toBe(2.55)
    const level = nodes.level_1
    if (level.type !== 'level') throw new Error('expected level')
    const updated = { ...nodes, level_1: { ...level, height: 3.0 } }
    expect(resolveStairTotalRise(stair, updated)).toBe(3.0)
  })

  it('includes the next level base elevation in a following stair rise', () => {
    const { stair, nodes } = buildScene(2.5, undefined)
    const current = nodes.level_1
    if (current.type !== 'level') throw new Error('expected level')
    const building = BuildingNode.parse({
      id: 'building_1',
      children: ['level_1', 'level_2'],
    })
    const upper = LevelNode.parse({
      id: 'level_2',
      parentId: building.id,
      level: 1,
      baseElevation: 0.4,
      height: 2.5,
    })
    const stackedNodes = {
      ...nodes,
      [building.id]: building,
      level_1: { ...current, parentId: building.id },
      level_2: upper,
    } as Record<string, AnyNode>

    expect(resolveStairTotalRise(stair, stackedNodes)).toBeCloseTo(2.9)
    // A fresh record, not a mutation of `stackedNodes`: getLevelElevations
    // memoises on the identity of the nodes object, which holds because the
    // store always publishes a new record. Mutating in place would read the
    // cached elevations and silently assert nothing.
    const loweredNodes = {
      ...stackedNodes,
      level_2: { ...upper, baseElevation: -0.4 },
    } as Record<string, AnyNode>
    expect(resolveStairTotalRise(stair, loweredNodes)).toBeCloseTo(2.1)
  })

  it('prefers an explicit totalRise over the storey height', () => {
    const { stair, nodes } = buildScene(3.2, 2.5)
    expect(resolveStairTotalRise(stair, nodes)).toBe(2.5)
  })

  it('falls back to the default when the stair has no containing level', () => {
    const { stair } = buildScene(3.2, undefined)
    expect(resolveStairTotalRise(stair, {})).toBe(2.5)
  })

  it('derives the rise from the attached deck elevation', () => {
    const { stair, nodes } = buildDeckScene({ deckElevation: 1.25 })
    expect(resolveStairTotalRise(stair, nodes)).toBe(1.25)
  })

  it('tracks a deck elevation change without any stair write', () => {
    const { deck, stair, nodes } = buildDeckScene({ deckElevation: 1.25 })
    const updated = { ...nodes, [deck.id]: { ...deck, elevation: 1.6 } }
    expect(resolveStairTotalRise(stair, updated)).toBe(1.6)
  })

  it('prefers an explicit totalRise over the attached deck', () => {
    const { stair, nodes } = buildDeckScene({ deckElevation: 1.25, totalRise: 2.0 })
    expect(resolveStairTotalRise(stair, nodes)).toBe(2.0)
  })

  it('falls through a stale deckSlabId to the storey height silently', () => {
    const { stair, nodes } = buildDeckScene({ deckElevation: 1.25, deckSlabId: 'slab_gone' })
    expect(resolveStairTotalRise(stair, nodes)).toBe(2.5)
  })
})

describe('syncStairRises', () => {
  it('writes the deck elevation into a single flight segment', () => {
    const { nodes } = buildDeckScene({
      deckElevation: 1.6,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.25 }],
    })
    expect(syncStairRises(nodes)).toEqual([{ id: 'sseg_1' as never, data: { height: 1.6 } }])
  })

  it('is a no-op when the flights already match the deck elevation', () => {
    const { nodes } = buildDeckScene({
      deckElevation: 1.25,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.25 }],
    })
    expect(syncStairRises(nodes)).toEqual([])
  })

  it('scales multiple flights proportionally and leaves landings alone', () => {
    const { nodes } = buildDeckScene({
      deckElevation: 2.1,
      segments: [
        { id: 'sseg_1', segmentType: 'stair', height: 0.5 },
        { id: 'sseg_2', segmentType: 'landing', height: 0.1 },
        { id: 'sseg_3', segmentType: 'stair', height: 0.5 },
      ],
    })
    const updates = syncStairRises(nodes)
    expect(updates).toHaveLength(2)
    expect(updates[0]).toEqual({ id: 'sseg_1' as never, data: { height: 1.0 } })
    expect(updates[1]).toEqual({ id: 'sseg_3' as never, data: { height: 1.0 } })
  })

  it('distributes an explicit custom rise instead of the deck elevation', () => {
    const { nodes } = buildDeckScene({
      deckElevation: 1.25,
      totalRise: 2.0,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.25 }],
    })
    expect(syncStairRises(nodes)).toEqual([{ id: 'sseg_1' as never, data: { height: 2.0 } }])
  })

  it('falls a stale deckSlabId back to the storey height', () => {
    const { nodes } = buildDeckScene({
      deckElevation: 1.6,
      deckSlabId: 'slab_gone',
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.25 }],
    })
    expect(syncStairRises(nodes)).toEqual([{ id: 'sseg_1' as never, data: { height: 2.5 } }])
  })

  it('leaves a stale-deck stair with an explicit rise untouched', () => {
    const { nodes } = buildDeckScene({
      deckElevation: 1.6,
      deckSlabId: 'slab_gone',
      totalRise: 2.0,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.25 }],
    })
    expect(syncStairRises(nodes)).toEqual([])
  })

  it('converges a level-following straight stair to the storey height', () => {
    const { nodes } = buildLevelSceneWithSegments({
      levelHeight: 2.5,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.0 }],
    })
    expect(syncStairRises(nodes)).toEqual([{ id: 'sseg_1' as never, data: { height: 2.5 } }])
  })

  it('converges a level-following stair after a storey height change', () => {
    const scene = buildLevelSceneWithSegments({
      levelHeight: 2.5,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 2.5 }],
    })
    expect(syncStairRises(scene.nodes)).toEqual([])
    const nodes = { ...scene.nodes, level_1: { ...scene.level, height: 3.0 } as AnyNode }
    expect(syncStairRises(nodes)).toEqual([{ id: 'sseg_1' as never, data: { height: 3.0 } }])
  })

  it('rescales level-following flights proportionally, landings untouched', () => {
    const { nodes } = buildLevelSceneWithSegments({
      levelHeight: 2.1,
      segments: [
        { id: 'sseg_1', segmentType: 'stair', height: 0.5 },
        { id: 'sseg_2', segmentType: 'landing', height: 0.1 },
        { id: 'sseg_3', segmentType: 'stair', height: 0.5 },
      ],
    })
    const updates = syncStairRises(nodes)
    expect(updates).toHaveLength(2)
    expect(updates[0]).toEqual({ id: 'sseg_1' as never, data: { height: 1.0 } })
    expect(updates[1]).toEqual({ id: 'sseg_3' as never, data: { height: 1.0 } })
  })

  it('converges back to the storey height after a deck detach', () => {
    const scene = buildDeckScene({
      deckElevation: 1.25,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.25 }],
    })
    expect(syncStairRises(scene.nodes)).toEqual([])
    const { deckSlabId: _deckSlabId, ...detached } = scene.stair
    const nodes = { ...scene.nodes, stair_1: detached as AnyNode }
    expect(syncStairRises(nodes)).toEqual([{ id: 'sseg_1' as never, data: { height: 2.5 } }])
  })

  it('leaves a detached explicit-rise stair with hand-set segments untouched', () => {
    const { nodes } = buildLevelSceneWithSegments({
      levelHeight: 2.5,
      totalRise: 2.0,
      segments: [
        { id: 'sseg_1', segmentType: 'stair', height: 0.9 },
        { id: 'sseg_2', segmentType: 'stair', height: 0.6 },
      ],
    })
    expect(syncStairRises(nodes)).toEqual([])
  })
})

// The stair stands on a floor slab (the default 0.05 one, or whatever the
// floor-stack elects) — the deck-derived rise must be measured from that
// lifted base so the last step lands flush with the deck's walking surface.
describe('deck-attached rise with a floor-lifted base', () => {
  const FLOOR_POLYGON: Array<[number, number]> = [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ]
  // Away from the stair footprint at the origin so the base election never
  // sees the deck itself.
  const AWAY_DECK_POLYGON: Array<[number, number]> = [
    [8, 8],
    [10, 8],
    [10, 10],
    [8, 10],
  ]

  beforeEach(() => {
    registerStairFootprint()
  })

  function makeFloorSlab(elevation: number) {
    return SlabNode.parse({
      id: 'slab_floor',
      type: 'slab',
      polygon: FLOOR_POLYGON,
      elevation,
      thickness: 0.05,
    })
  }

  function buildLiftedDeckScene(options: {
    deckElevation: number
    floorElevation?: number
    totalRise?: number
    supportSlabId?: string
    segments?: Array<{ id: string; segmentType: 'stair' | 'landing'; height: number }>
  }) {
    const floor = makeFloorSlab(options.floorElevation ?? 0.05)
    const scene = buildDeckScene({
      deckElevation: options.deckElevation,
      deckPolygon: AWAY_DECK_POLYGON,
      totalRise: options.totalRise,
      segments: options.segments,
    })
    const stair = options.supportSlabId
      ? ({ ...scene.stair, supportSlabId: options.supportSlabId } as typeof scene.stair)
      : scene.stair
    const nodes: Record<string, AnyNode> = {
      ...scene.nodes,
      stair_1: stair,
      [floor.id]: floor,
    }
    spatialGridManager.handleNodeCreated(floor as AnyNode, 'level_1')
    spatialGridManager.handleNodeCreated(scene.deck as AnyNode, 'level_1')
    return { deck: scene.deck, floor, stair, nodes }
  }

  it('lands the last step flush: rise = deck elevation − elected base', () => {
    const { stair, nodes } = buildLiftedDeckScene({ deckElevation: 1.25 })
    const base = getFloorPlacedElevation({
      node: stair,
      nodes,
      position: stair.position,
      rotation: stair.rotation,
      levelId: 'level_1',
    })
    expect(base).toBeCloseTo(0.05)
    const rise = resolveStairTotalRise(stair, nodes)
    expect(rise).toBeCloseTo(1.2)
    // Top surface = visual base + rise = the deck's walking surface, not 1.30.
    expect(base + rise).toBeCloseTo(1.25)
  })

  it('rescales a flight converged under the old rule down to the flush rise', () => {
    const { nodes } = buildLiftedDeckScene({
      deckElevation: 1.25,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.25 }],
    })
    const updates = syncStairRises(nodes)
    expect(updates).toHaveLength(1)
    expect(updates[0]?.id).toBe('sseg_1' as never)
    expect((updates[0]?.data as { height?: number }).height).toBeCloseTo(1.2)
  })

  it('keeps the full deck elevation when the stair stands on bare ground', () => {
    const scene = buildDeckScene({ deckElevation: 1.25, deckPolygon: AWAY_DECK_POLYGON })
    spatialGridManager.handleNodeCreated(scene.deck as AnyNode, 'level_1')
    expect(resolveStairTotalRise(scene.stair, scene.nodes)).toBeCloseTo(1.25)
  })

  it('lets an explicit totalRise win over the base-adjusted deck rise', () => {
    const { stair, nodes } = buildLiftedDeckScene({ deckElevation: 1.25, totalRise: 2.0 })
    expect(resolveStairTotalRise(stair, nodes)).toBe(2.0)
  })

  it('re-converges to flush after a deck elevation change', () => {
    const scene = buildLiftedDeckScene({
      deckElevation: 1.25,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.2 }],
    })
    expect(syncStairRises(scene.nodes)).toEqual([])
    const movedDeck = { ...scene.deck, elevation: 1.6 }
    const nodes = { ...scene.nodes, [scene.deck.id]: movedDeck as AnyNode }
    spatialGridManager.handleNodeUpdated(movedDeck as AnyNode, 'level_1')
    const updates = syncStairRises(nodes)
    expect(updates).toHaveLength(1)
    expect((updates[0]?.data as { height?: number }).height).toBeCloseTo(1.55)
  })

  it('re-converges to flush after the base slab elevation changes', () => {
    const scene = buildLiftedDeckScene({
      deckElevation: 1.25,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.2 }],
    })
    const movedFloor = { ...scene.floor, elevation: 0.3 }
    const nodes = { ...scene.nodes, [scene.floor.id]: movedFloor as AnyNode }
    spatialGridManager.handleNodeUpdated(movedFloor as AnyNode, 'level_1')
    const updates = syncStairRises(nodes)
    expect(updates).toHaveLength(1)
    expect((updates[0]?.data as { height?: number }).height).toBeCloseTo(0.95)
  })

  it('rescales flights proportionally from the lifted base, landings untouched', () => {
    const { nodes } = buildLiftedDeckScene({
      deckElevation: 2.15,
      segments: [
        { id: 'sseg_1', segmentType: 'stair', height: 0.5 },
        { id: 'sseg_2', segmentType: 'landing', height: 0.1 },
        { id: 'sseg_3', segmentType: 'stair', height: 0.5 },
      ],
    })
    // Target flight rise = 2.15 − 0.05 (base) − 0.1 (landing) = 2.0 → 1.0 each.
    const updates = syncStairRises(nodes)
    expect(updates).toHaveLength(2)
    expect(updates[0]?.id).toBe('sseg_1' as never)
    expect((updates[0]?.data as { height?: number }).height).toBeCloseTo(1.0)
    expect(updates[1]?.id).toBe('sseg_3' as never)
    expect((updates[1]?.data as { height?: number }).height).toBeCloseTo(1.0)
  })

  it('honors a persisted ground host over the floor slab election', () => {
    const { stair, nodes } = buildLiftedDeckScene({
      deckElevation: 1.25,
      supportSlabId: GROUND_SUPPORT_ID,
    })
    expect(resolveStairTotalRise(stair, nodes)).toBeCloseTo(1.25)
  })
})

// A level-destination stair climbs to the storey plane above, which is an
// absolute level-local height — so a slab that lifts the stair's own base eats
// into the rise. Without the subtraction the last step overshoots the floor
// above by the slab's thickness (and a tall storey used to be missed entirely).
describe('level rise with a floor-lifted base', () => {
  const FLOOR_POLYGON: Array<[number, number]> = [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ]

  beforeEach(() => {
    registerStairFootprint()
  })

  function buildLiftedLevelScene(options: {
    levelHeight: number
    floorElevation?: number | null
    totalRise?: number
    segments?: Array<{ id: string; segmentType: 'stair' | 'landing'; height: number }>
  }) {
    const scene = buildLevelSceneWithSegments({
      levelHeight: options.levelHeight,
      totalRise: options.totalRise,
      segments: options.segments ?? [],
    })
    if (options.floorElevation == null) return { ...scene, floor: null }

    const floor = SlabNode.parse({
      id: 'slab_floor',
      type: 'slab',
      polygon: FLOOR_POLYGON,
      elevation: options.floorElevation,
      thickness: 0.05,
    })
    spatialGridManager.handleNodeCreated(floor as AnyNode, 'level_1')
    return {
      ...scene,
      floor,
      nodes: { ...scene.nodes, [floor.id]: floor } as Record<string, AnyNode>,
    }
  }

  it('lands the last step on the storey plane: rise = floor-to-floor − elected base', () => {
    const { stair, nodes } = buildLiftedLevelScene({ levelHeight: 5.3, floorElevation: 0.05 })
    const base = getFloorPlacedElevation({
      node: stair,
      nodes,
      position: stair.position,
      rotation: stair.rotation,
      levelId: 'level_1',
    })
    expect(base).toBeCloseTo(0.05)
    const rise = resolveStairTotalRise(stair, nodes)
    expect(rise).toBeCloseTo(5.25)
    expect(base + rise).toBeCloseTo(5.3)
  })

  it('keeps the full storey height when the stair stands on bare ground', () => {
    const { stair, nodes } = buildLiftedLevelScene({ levelHeight: 5.3, floorElevation: null })
    expect(resolveStairTotalRise(stair, nodes)).toBeCloseTo(5.3)
  })

  it('lets an explicit totalRise win over the base-adjusted storey rise', () => {
    const { stair, nodes } = buildLiftedLevelScene({
      levelHeight: 5.3,
      floorElevation: 0.05,
      totalRise: 2.7,
    })
    expect(resolveStairTotalRise(stair, nodes)).toBe(2.7)
  })

  it('converges a straight flight to the base-adjusted storey rise', () => {
    const { nodes } = buildLiftedLevelScene({
      levelHeight: 5.3,
      floorElevation: 0.05,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 2.5 }],
    })
    const updates = syncStairRises(nodes)
    expect(updates).toHaveLength(1)
    expect(updates[0]?.id).toBe('sseg_1' as never)
    expect((updates[0]?.data as { height?: number }).height).toBeCloseTo(5.25)
  })

  it('re-converges after the base slab elevation changes', () => {
    const scene = buildLiftedLevelScene({
      levelHeight: 2.5,
      floorElevation: 0.05,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 2.45 }],
    })
    expect(syncStairRises(scene.nodes)).toEqual([])
    const movedFloor = { ...scene.floor, elevation: 0.3 }
    const nodes = { ...scene.nodes, slab_floor: movedFloor as AnyNode }
    spatialGridManager.handleNodeUpdated(movedFloor as AnyNode, 'level_1')
    const updates = syncStairRises(nodes)
    expect(updates).toHaveLength(1)
    expect((updates[0]?.data as { height?: number }).height).toBeCloseTo(2.2)
  })
})

describe('arc stair walking elevations', () => {
  it('keeps thin and thick spiral treads on the same uniform rise and destination', () => {
    for (const thickness of [0.05, 0.25]) {
      const stair = StairNode.parse({ stairType: 'spiral', stepCount: 15, thickness })
      const layout = resolveStairArcLayout(stair, 3)
      expect(layout.steps[0]!.top).toBeCloseTo(0.2)
      expect(layout.steps.at(-1)!.top).toBeCloseTo(3)
      expect(layout.steps.at(-1)!.top - layout.steps.at(-1)!.bottom).toBeCloseTo(thickness)
    }
  })
  it('places an integrated landing at the destination for either winding direction', () => {
    for (const sweepAngle of [7, -7]) {
      const layout = resolveStairArcLayout(
        StairNode.parse({
          stairType: 'spiral',
          topLandingMode: 'integrated',
          sweepAngle,
          thickness: 0.05,
        }),
        3,
      )
      expect(layout.landing!.top).toBe(3)
      expect(layout.landing!.bottom).toBeCloseTo(2.95)
      expect(Math.sign(layout.landingSweep)).toBe(Math.sign(sweepAngle))
    }
  })
  it('keeps a filled curved stair on the riser schedule with thick finish parameters', () => {
    const layout = resolveStairArcLayout(
      StairNode.parse({ stairType: 'curved', stepCount: 10, thickness: 0.5 }),
      2,
    )
    expect(layout.steps[0]!.top).toBeCloseTo(0.2)
    expect(layout.steps[0]!.bottom).toBe(0)
  })
})

describe('stair rise editing', () => {
  it('edits parent rise and child heights atomically and restores all of them with undo', () => {
    const first = StairSegmentNode.parse({ height: 1, stepCount: 5 })
    const landing = StairSegmentNode.parse({ segmentType: 'landing', height: 0, stepCount: 0 })
    const second = StairSegmentNode.parse({ height: 2, stepCount: 10 })
    const stair = StairNode.parse({ totalRise: 3, children: [first.id, landing.id, second.id] })
    for (const segment of [first, landing, second]) segment.parentId = stair.id
    const previous = useScene.getState()
    const originalRaf = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = () => 1
    globalThis.cancelAnimationFrame = () => {}
    try {
      useScene.setState({
        nodes: Object.fromEntries([stair, first, landing, second].map((node) => [node.id, node])),
        rootNodeIds: [stair.id],
      })
      useScene.temporal.getState().clear()
      useScene.temporal.getState().resume()
      useScene.getState().updateNodes(planStairRiseEdit(stair, 6, useScene.getState().nodes))
      expect((useScene.getState().nodes[first.id] as StairSegmentNode).height).toBe(2)
      expect((useScene.getState().nodes[second.id] as StairSegmentNode).height).toBe(4)
      expect((useScene.getState().nodes[landing.id] as StairSegmentNode).height).toBe(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect((useScene.getState().nodes[stair.id] as StairNodeType).totalRise).toBe(3)
      expect((useScene.getState().nodes[first.id] as StairSegmentNode).height).toBe(1)
      expect((useScene.getState().nodes[second.id] as StairSegmentNode).height).toBe(2)
      useScene
        .getState()
        .updateNodes(planStairFlightHeightEdit(first, 1.5, useScene.getState().nodes))
      expect((useScene.getState().nodes[stair.id] as StairNodeType).totalRise).toBe(3.5)
    } finally {
      useScene.setState(previous)
      useScene.temporal.getState().clear()
      globalThis.requestAnimationFrame = originalRaf
      globalThis.cancelAnimationFrame = originalCancel
    }
  })
})

it('refuses a parent rise below positive landing elevations without mutating the scene', () => {
  const flight = StairSegmentNode.parse({ height: 1 })
  const landing = StairSegmentNode.parse({ segmentType: 'landing', height: 0.5 })
  const stair = StairNode.parse({ children: [flight.id, landing.id], totalRise: 1.5 })
  const nodes = Object.fromEntries([stair, flight, landing].map((node) => [node.id, node]))
  expect(() => planStairRiseEdit(stair, 0.5, nodes)).toThrow(RangeError)
  expect(nodes[flight.id]).toEqual(flight)
  expect(stair.totalRise).toBe(1.5)
})

it('sizes proposed stairs uniformly without redesigning measured chains until explicit repair', async () => {
  const { planStairSizing, planStairSizingEdit, measureStair } = await import('@pascal-app/core')
  expect(planStairSizing(3).stepCount).toBe(17)
  expect(planStairSizing(3).length).toBeCloseTo(4.76)
  const first = StairSegmentNode.parse({ height: 1, length: 2, stepCount: 4 })
  const second = StairSegmentNode.parse({ height: 2, length: 4, stepCount: 8 })
  const stair = StairNode.parse({ totalRise: 3, children: [first.id, second.id] })
  const nodes: Record<string, AnyNode> = {
    [stair.id]: stair,
    [first.id]: first,
    [second.id]: second,
  }
  expect(syncStairRises(nodes)).toEqual([])
  const patches = planStairSizingEdit(stair, nodes, true)
  for (const patch of patches) nodes[patch.id] = { ...nodes[patch.id], ...patch.data } as AnyNode
  const fitted = nodes[stair.id] as StairNodeType
  const measurement = measureStair(fitted, nodes)
  expect(measurement.riserCount).toBe(17)
  expect(measurement.uniformity).toBeCloseTo(0, 10)
  expect(measurement.flights.every((flight) => Math.abs(flight.going! - 0.28) < 1e-8)).toBe(true)
  expect(measurement.diagnostics.some((entry) => entry.code === 'riser-target')).toBe(false)
  nodes[stair.id] = { ...fitted, totalRise: 3.4 }
  const synced = syncStairRises(nodes)
  for (const patch of synced) nodes[patch.id] = { ...nodes[patch.id], ...patch.data } as AnyNode
  expect(measureStair(nodes[stair.id] as StairNodeType, nodes).uniformity).toBeCloseTo(0, 10)
  expect(
    measureStair(nodes[stair.id] as StairNodeType, nodes).flights.reduce(
      (sum, flight) => sum + flight.rise,
      0,
    ),
  ).toBeCloseTo(3.4)
  expect(() => planStairSizing(0)).toThrow(RangeError)
})

it('fits the minimum going for straight and signed arc stairs and refuses landing-only repair', async () => {
  const { planStairSizingEdit, measureStair, StairDesignTargets } = await import('@pascal-app/core')
  for (const stairType of ['straight', 'curved', 'spiral'] as const) {
    for (const sign of [-1, 1]) {
      const flight = StairSegmentNode.parse({ height: 3, length: 3, stepCount: 10 })
      const stair = StairNode.parse({
        stairType,
        totalRise: 3,
        children: [flight.id],
        sweepAngle: sign * Math.PI * 2,
        designTargets: StairDesignTargets.parse({ minimumGoing: 0.4, targetGoing: 0.28 }),
      })
      const nodes: Record<string, AnyNode> = { [stair.id]: stair, [flight.id]: flight }
      for (const patch of planStairSizingEdit(stair, nodes, true))
        nodes[patch.id] = { ...nodes[patch.id], ...patch.data } as AnyNode
      const fitted = nodes[stair.id] as StairNodeType
      expect(measureStair(fitted, nodes).flights[0]!.going).toBeCloseTo(0.4)
      expect(
        measureStair(fitted, nodes).diagnostics.some((entry) => entry.code === 'going-target'),
      ).toBe(false)
      if (stairType !== 'straight') expect(Math.sign(fitted.sweepAngle)).toBe(sign)
    }
  }
  const landing = StairSegmentNode.parse({ segmentType: 'landing', height: 0 })
  const stair = StairNode.parse({ totalRise: 3, children: [landing.id] })
  expect(() => planStairSizingEdit(stair, { [stair.id]: stair, [landing.id]: landing })).toThrow(
    RangeError,
  )
})

it('measures child flights and repairs huge stored arc counts without constructing treads', async () => {
  const { measureStair, planStairSizingEdit } = await import('@pascal-app/core')
  const flight = StairSegmentNode.parse({ height: 3, length: 4.76, stepCount: 17 })
  const stair = StairNode.parse({ totalRise: 3, stepCount: 4294967296, children: [flight.id] })
  expect(measureStair(stair, { [stair.id]: stair, [flight.id]: flight }).riserCount).toBe(17)
  const spiral = StairNode.parse({ stairType: 'spiral', totalRise: 3, stepCount: 4294967296 })
  expect(planStairSizingEdit(spiral, { [spiral.id]: spiral }, true)[0]!.data).toMatchObject({
    stepCount: 17,
  })
})

it('proposes connected straight, L and U chains with uniform risers and width-sized landings', async () => {
  const { planStairPreset, proposeStairLayouts, computeSegmentTransforms, measureStair } =
    await import('@pascal-app/core')
  const originalFlight = StairSegmentNode.parse({
    height: 3,
    slots: { tread: 'library:wood' },
    width: 1.2,
  })
  const stair = StairNode.parse({ totalRise: 3, width: 1.2, children: [originalFlight.id] })
  const nodes = { [stair.id]: stair, [originalFlight.id]: originalFlight }
  const before = JSON.stringify(nodes)
  for (const layout of ['straight', 'l', 'u'] as const) {
    for (const turn of ['left', 'right'] as const) {
      const plan = planStairPreset(stair, nodes, { layout, turn })
      expect(plan.segments[0]!.id).toBe(originalFlight.id)
      expect(plan.segments[0]!.slots).toEqual(originalFlight.slots)
      const proposed: Record<string, AnyNode> = { ...nodes, [stair.id]: plan.stair }
      for (const segment of plan.segments) proposed[segment.id] = segment
      const measured = measureStair(plan.stair, proposed)
      expect(measured.uniformity).toBeLessThan(1e-10)
      expect(measured.riserCount).toBe(17)
      expect(plan.segments.reduce((sum, s) => sum + s.height, 0)).toBeCloseTo(3)
      for (const landing of plan.segments.filter((s) => s.segmentType === 'landing')) {
        expect(landing.height).toBe(0)
        expect(landing.length).toBe(1.2)
      }
      const transforms = computeSegmentTransforms(plan.segments)
      const final = transforms.at(-1)!
      expect(final.rotation).toBeCloseTo(
        (turn === 'left' ? 1 : -1) * (layout === 'l' ? Math.PI / 2 : layout === 'u' ? Math.PI : 0),
      )
      if (layout === 'u') {
        expect(Math.abs(final.position[0])).toBeCloseTo(1.2)
        expect(final.position[2]).toBeCloseTo(plan.segments[0]!.length)
        expect(plan.footprint.width).toBeCloseTo(2.4)
      }
    }
  }
  const alternatives = proposeStairLayouts(stair, nodes, { width: 2.4, length: 4 })
  expect(alternatives).toHaveLength(5)
  expect(alternatives.find((option) => option.layout === 'u')!.fits).toBe(true)
  expect(alternatives.find((option) => option.layout === 'straight')!.fits).toBe(false)
  expect(JSON.stringify(nodes)).toBe(before)
  expect(() => planStairPreset(stair, nodes, { layout: 'l', landingDepth: 0.5 })).toThrow(
    RangeError,
  )
})

it('walking lines follow turning landings and preserve signed arc ascent and arrival', async () => {
  const { planStairPreset, resolveStairWalkingPaths, resolveStairArcDimensions } = await import(
    '@pascal-app/core'
  )
  const original = StairNode.parse({ totalRise: 3 })
  for (const layout of ['l', 'u'] as const) {
    const plan = planStairPreset(original, { [original.id]: original }, { layout })
    const paths = resolveStairWalkingPaths(plan.stair, plan.segments, 3)
    expect(paths).toHaveLength(1)
    expect(paths[0]![0]![1]).toBe(0)
    expect(paths[0]!.at(-1)![1]).toBeCloseTo(3)
    expect(
      paths[0]!.filter((point) => point[1] === plan.segments[0]!.height).length,
    ).toBeGreaterThan(2)
    const hidden = plan.segments.map((segment, index) =>
      index === 0 ? { ...segment, visible: false } : segment,
    )
    expect(resolveStairWalkingPaths(plan.stair, hidden, 3)[0]![0]![1]).toBeCloseTo(
      plan.segments[0]!.height,
    )
  }
  for (const sweepAngle of [4 * Math.PI, -4 * Math.PI]) {
    const stair = StairNode.parse({
      stairType: 'spiral',
      sweepAngle,
      totalRise: 3,
      topLandingMode: 'integrated',
    })
    const layout = resolveStairArcDimensions(stair, 3)
    const path = resolveStairWalkingPaths(stair, [], 3)[0]!
    expect(path[0]![1]).toBe(0)
    expect(path.at(-1)![1]).toBe(3)
    const angle = sweepAngle / 2 + layout.landingSweep
    expect(path.at(-1)![0]).toBeCloseTo(Math.cos(angle) * layout.walkingRadius)
    expect(path.at(-1)![2]).toBeCloseTo(Math.sin(angle) * layout.walkingRadius)
    for (const point of path)
      expect(Math.hypot(point[0], point[2])).toBeCloseTo(layout.walkingRadius)
  }
})

it('angular sweep edits grow across turns and hold the opposite stair edge fixed', async () => {
  const { createAngleAccumulator, planStairSweepEdit, resolveStairArcDimensions } = await import(
    '@pascal-app/core'
  )
  for (const sign of [-1, 1]) {
    for (const end of ['start', 'end'] as const) {
      const stair = StairNode.parse({
        stairType: 'spiral',
        sweepAngle: sign * 4 * Math.PI,
        rotation: 0.7,
        width: 0.1,
        innerRadius: 0.02,
        thickness: 0.005,
      })
      const accumulate = createAngleAccumulator(0)
      let delta = 0
      for (let index = 1; index <= 80; index++) {
        const angle = (sign * (end === 'end' ? 1 : -1) * index * Math.PI) / 10
        delta = accumulate(Math.atan2(Math.sin(angle), Math.cos(angle)))
      }
      const edit = planStairSweepEdit(stair, delta, end)
      expect(edit.sweepAngle).toBeCloseTo(sign * 12 * Math.PI)
      const fixedBefore = -stair.rotation + ((end === 'end' ? -1 : 1) * stair.sweepAngle) / 2
      const fixedAfter = -edit.rotation + ((end === 'end' ? -1 : 1) * edit.sweepAngle) / 2
      expect(fixedAfter).toBeCloseTo(fixedBefore)
      const dimensions = resolveStairArcDimensions(stair, 0.05)
      expect(dimensions.width).toBe(0.1)
      expect(dimensions.innerRadius).toBe(0.02)
      expect(dimensions.thickness).toBe(0.005)
      const crossed = planStairSweepEdit(stair, -sign * 20 * Math.PI, 'end')
      expect(Math.sign(crossed.sweepAngle)).toBe(sign)
      expect(Math.abs(crossed.sweepAngle)).toBe(0.0001)
    }
  }
})

it('preserves authored counts while refusing unbounded stair detail before allocation', async () => {
  const { measureStairDetail, resolveStairArcLayout, measureStair } = await import(
    '@pascal-app/core'
  )
  for (const stepCount of [10001, 4294967296]) {
    const stair = StairNode.parse({ stairType: 'spiral', stepCount, totalRise: 3 })
    const before = JSON.stringify(stair)
    expect(measureStairDetail(stair, []).status).toBe('unresolved')
    expect(() => resolveStairArcLayout(stair, 3)).toThrow('computation budget')
    const measurements = measureStair(stair, { [stair.id]: stair })
    expect(measurements.detail.status).toBe('unresolved')
    expect(measurements.headroom.status).toBe('unresolved')
    expect(
      measurements.diagnostics.some((diagnostic) => diagnostic.code === 'geometry-unresolved'),
    ).toBe(true)
    expect(JSON.stringify(stair)).toBe(before)
  }
  const segments = [
    StairSegmentNode.parse({ stepCount: 6000 }),
    StairSegmentNode.parse({ stepCount: 6000 }),
  ]
  expect(
    measureStairDetail(
      StairNode.parse({ children: segments.map((segment) => segment.id) }),
      segments,
    ).status,
  ).toBe('unresolved')
  for (const railingStyle of ['post-and-rail', 'boards', 'cable'] as const) {
    for (const dimension of ['length', 'railingHeight', 'railingTopReach'] as const) {
      const segment = StairSegmentNode.parse({ length: dimension === 'length' ? 1e9 : 3 })
      const stair = StairNode.parse({
        children: [segment.id],
        railingMode: 'both',
        railingStyle,
        ...(dimension !== 'length' ? { [dimension]: 1e9 } : {}),
      })
      expect(measureStairDetail(stair, [segment]).error).toContain('computation budget')
      expect(dimension === 'length' ? segment.length : stair[dimension]).toBe(1e9)
    }
  }
})

it('refuses dense original picketed and board guards before allocating detail', async () => {
  const { measureStairDetail } = await import('@pascal-app/core')
  const segment = StairSegmentNode.parse({ length: 2, stepCount: 10000 })
  for (const railingStyle of ['post-and-rail', 'boards'] as const) {
    const stair = StairNode.parse({
      children: [segment.id],
      railingMode: 'both',
      railingStyle,
    })
    expect(measureStairDetail(stair, [segment]).error).toContain('computation budget')
    expect(segment.stepCount).toBe(10000)
    expect(segment.length).toBe(2)
    const ordinary = StairSegmentNode.parse({ length: 3, stepCount: 14 })
    expect(measureStairDetail(stair, [ordinary]).status).toBe('evaluated')
  }
})

it('keeps finished walking heights while resolving explicit bodies, nosing and stringers', async () => {
  const {
    StairConstruction,
    resolveStraightStairConstruction,
    resolveStairWalkingSurfaces,
    measureStairHeadroom,
    measureStair,
  } = await import('@pascal-app/core')
  const segment = StairSegmentNode.parse({ width: 1, length: 3, height: 2, stepCount: 10 })
  expect(resolveStraightStairConstruction(segment)).toBeNull()
  for (const mode of ['solid', 'waist', 'open', 'side-stringers', 'center-stringer'] as const) {
    const stair = StairNode.parse({
      totalRise: 2,
      children: [segment.id],
      construction: StairConstruction.parse({
        mode,
        finishThickness: 0.03,
        closedRisers: true,
        nosing: 0.04,
      }),
    })
    segment.parentId = stair.id
    const nodes = { [stair.id]: stair, [segment.id]: segment }
    const pieces = resolveStraightStairConstruction(segment, 0, stair)!
    expect(Math.max(...pieces.map((piece) => piece.top))).toBeCloseTo(2)
    expect(Math.min(...pieces.map((piece) => piece.z0))).toBeCloseTo(-0.04)
    expect(
      pieces.every((piece) => piece.profile.every((point) => point.every(Number.isFinite))),
    ).toBe(true)
    const walking = resolveStairWalkingSurfaces(stair, nodes)
    expect(walking.map((surface) => surface.top)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i + 1) * 0.2),
    )
    expect(walking.every((surface) => surface.bodies && surface.bodies.length > 0)).toBe(true)
    expect(measureStair(stair, nodes).flights[0]!.construction?.mode).toBe(mode)
    expect(measureStairHeadroom(stair, nodes).obstructions).toHaveLength(0)
  }
  const lowerFlight = StairSegmentNode.parse({ width: 0.2, length: 3, height: 1, stepCount: 10 })
  const lower = StairNode.parse({ totalRise: 1, children: [lowerFlight.id] })
  lowerFlight.parentId = lower.id
  const upperFlight = StairSegmentNode.parse({ width: 1, length: 3, height: 1, stepCount: 10 })
  const headroom = (mode: 'open' | 'side-stringers' | 'center-stringer') => {
    const upper = StairNode.parse({
      position: [0, 3, 0],
      children: [upperFlight.id],
      totalRise: 1,
      construction: StairConstruction.parse({ mode, nosing: 0 }),
    })
    upperFlight.parentId = upper.id
    return measureStairHeadroom(lower, {
      [lower.id]: lower,
      [lowerFlight.id]: lowerFlight,
      [upper.id]: upper,
      [upperFlight.id]: upperFlight,
    }).minimum!
  }
  expect(headroom('side-stringers')).toBeCloseTo(headroom('open'))
  expect(headroom('center-stringer')).toBeLessThan(headroom('open'))
  const invalidFallback = StairNode.parse({
    width: 1,
    construction: { mode: 'side-stringers', stringerWidth: 0.8 },
  })
  const diagnostics = measureStair(invalidFallback, { [invalidFallback.id]: invalidFallback })
  expect(diagnostics.detail.status).toBe('unresolved')
  expect(diagnostics.headroom.status).toBe('unresolved')
  expect(diagnostics.diagnostics.some((issue) => issue.code === 'geometry-unresolved')).toBe(true)
  for (const mode of ['solid', 'waist'] as const) {
    const inherited = StairNode.parse({
      construction: { mode, closedRisers: true, riserThickness: 1e9 },
    })
    expect(resolveStraightStairConstruction(segment, 0, inherited)!.length).toBeGreaterThan(0)
  }
  const narrowLanding = StairSegmentNode.parse({ segmentType: 'landing', width: 0.1, height: 0 })
  const inherited = StairNode.parse({
    construction: { mode: 'side-stringers', stringerWidth: 0.3 },
  })
  expect(resolveStraightStairConstruction(narrowLanding, 2, inherited)!.length).toBe(1)
})

it('resolves explicit arc construction below the same signed multi-turn walking surfaces', async () => {
  const {
    resolveArcStairConstruction,
    resolveStairWalkingSurfaces,
    measureStairDetail,
    StairConstruction,
  } = await import('@pascal-app/core')
  expect(resolveArcStairConstruction(StairNode.parse({ stairType: 'spiral' }), 3)).toBeNull()
  for (const mode of ['solid', 'waist', 'open', 'side-stringers', 'center-stringer'] as const) {
    for (const sign of [-1, 1]) {
      const stair = StairNode.parse({
        stairType: 'spiral',
        stepCount: 28,
        totalRise: 4.2,
        sweepAngle: sign * 4 * Math.PI,
        innerRadius: 0.6,
        width: 1.2,
        topLandingMode: 'integrated',
        construction: StairConstruction.parse({
          mode,
          finishThickness: 0.03,
          closedRisers: true,
          nosing: 0.04,
        }),
        showCenterColumn: false,
        showStepSupports: false,
      })
      const pieces = resolveArcStairConstruction(stair, 4.2)!
      expect(pieces.length).toBeGreaterThan(28)
      expect(Math.max(...pieces.map((piece) => piece.top))).toBeCloseTo(4.2)
      expect(
        pieces.every((piece) => piece.top > Math.max(piece.bottomStart, piece.bottomEnd)),
      ).toBe(true)
      expect(pieces.every((piece) => Math.sign(piece.endAngle - piece.startAngle) === sign)).toBe(
        true,
      )
      expect(pieces.filter((piece) => piece.index === 28)).toHaveLength(2)
      const walking = resolveStairWalkingSurfaces(stair, { [stair.id]: stair })
      expect(walking).toHaveLength(29)
      expect(walking[0]!.top).toBeCloseTo(0.15)
      expect(walking.at(-1)!.top).toBeCloseTo(4.2)
      expect(walking.every((surface) => surface.bodies!.length > 0)).toBe(true)
      for (const surface of walking)
        for (const body of surface.bodies!) {
          const [a, b, c] = body.underside
          expect(
            body.region.outer.every(
              ([x, z]) => Number.isFinite(a * x + b * z + c) && a * x + b * z + c < body.top,
            ),
          ).toBe(true)
        }
      expect(measureStairDetail(stair, []).status).toBe('evaluated')
    }
  }
  const oversized = StairNode.parse({
    stairType: 'spiral',
    stepCount: 9999,
    construction: { mode: 'side-stringers' },
  })
  expect(measureStairDetail(oversized, []).status).toBe('unresolved')
  expect(() => resolveArcStairConstruction(oversized, 3)).toThrow('computation budget')
  const impossible = StairNode.parse({
    stairType: 'curved',
    stepCount: 2,
    sweepAngle: 5 * Math.PI,
    construction: { mode: 'waist' },
  })
  expect(measureStairDetail(impossible, []).error).toContain('One tread')
})

it('keeps continuous guards around turning landing edges and handrails independent of guards', async () => {
  const {
    planStairPreset,
    resolveStairRailPaths,
    resolveStairHandrailPaths,
    measureStairDetail,
    computeSegmentTransforms,
  } = await import('@pascal-app/core')
  for (const layout of ['straight', 'l', 'u'] as const)
    for (const turn of ['left', 'right'] as const) {
      const stair = StairNode.parse({
        totalRise: 3,
        railingMode: 'both',
        railingPath: 'continuous',
        handrail: { mode: 'left' },
      })
      const plan = planStairPreset(stair, { [stair.id]: stair }, { layout, turn })
      const nodes = Object.fromEntries(
        [plan.stair, ...plan.segments].map((node) => [node.id, node]),
      )
      const paths = resolveStairRailPaths(plan.stair, nodes)
      expect(paths).toHaveLength(2)
      expect(new Set(paths.map((path) => path.side))).toEqual(new Set(['left', 'right']))
      expect(
        paths.every((path) => path.points.every((point) => point.every(Number.isFinite))),
      ).toBe(true)
      const landingIds = plan.segments
        .filter((segment) => segment.segmentType === 'landing')
        .map((segment) => segment.id)
      for (const id of landingIds)
        expect(paths.some((path) => path.nodeIds.includes(id))).toBe(true)
      const handrails = resolveStairHandrailPaths({ ...plan.stair, railingMode: 'none' }, nodes)
      expect(handrails).toHaveLength(1)
      expect(handrails[0]!.side).toBe('left')
      const transforms = computeSegmentTransforms(plan.segments)
      const hidden = plan.segments[0]!
      const downstream = plan.segments.at(-1)!
      const hiddenNodes = { ...nodes, [hidden.id]: { ...hidden, visible: false } }
      const remaining = resolveStairRailPaths(plan.stair, hiddenNodes)
      if (layout !== 'straight')
        expect(
          remaining.some((path) =>
            path.points.some(
              (point) =>
                Math.abs(point[1] - transforms.at(-1)!.position[1] - downstream.height) < 0.0002,
            ),
          ),
        ).toBe(true)
    }
  for (const sign of [-1, 1]) {
    const stair = StairNode.parse({
      stairType: 'spiral',
      sweepAngle: sign * 4 * Math.PI,
      stepCount: 28,
      totalRise: 4.2,
      topLandingMode: 'integrated',
      railingMode: 'both',
      railingPath: 'continuous',
      handrail: { mode: 'both' },
    })
    const paths = resolveStairRailPaths(stair, { [stair.id]: stair })
    expect(paths).toHaveLength(2)
    expect(paths.every((path) => path.points.at(-1)![1] === 4.2)).toBe(true)
    expect(paths.every((path) => path.points.length > 145)).toBe(true)
    const handrails = resolveStairHandrailPaths(stair, { [stair.id]: stair })
    expect(Math.hypot(...[handrails[0]!.points[0]![0], handrails[0]!.points[0]![2]])).toBeCloseTo(
      sign > 0 ? stair.innerRadius + 0.06 : stair.innerRadius + stair.width - 0.06,
    )
  }
  const tooLarge = StairNode.parse({
    stairType: 'spiral',
    stepCount: 9999,
    sweepAngle: 1e9,
    railingMode: 'both',
    railingPath: 'continuous',
  })
  expect(measureStairDetail(tooLarge, []).status).toBe('unresolved')
  expect(() => resolveStairRailPaths(tooLarge, { [tooLarge.id]: tooLarge })).toThrow(
    'computation budget',
  )
})

it('accepted glass guard budgets stay accepted in path construction and inset landing loops remain closed', async () => {
  const { measureStairDetail, resolveStairRailPaths, resolveStairHandrailPaths, measureStair } =
    await import('@pascal-app/core')
  const flight = StairSegmentNode.parse({ length: 400, width: 1, stepCount: 10 })
  const stair = StairNode.parse({
    railingMode: 'both',
    railingPath: 'continuous',
    railingStyle: 'glass',
    children: [flight.id],
  })
  const nodes = { [stair.id]: stair, [flight.id]: flight }
  expect(measureStairDetail(stair, [flight]).status).toBe('evaluated')
  expect(resolveStairRailPaths(stair, nodes)).toHaveLength(2)
  expect(measureStair(stair, nodes).railings.paths).toHaveLength(2)
  const landing = StairSegmentNode.parse({ segmentType: 'landing', height: 0, width: 1, length: 1 })
  const loop = StairNode.parse({
    railingMode: 'both',
    railingPath: 'continuous',
    children: [landing.id],
    handrail: { mode: 'both' },
  })
  const paths = resolveStairHandrailPaths(loop, { [loop.id]: loop, [landing.id]: landing })
  expect(paths).toHaveLength(1)
  expect(paths[0]!.points[0]).toEqual(paths[0]!.points.at(-1)!)
  expect(
    paths[0]!.points.every(
      ([x, , z]) => Math.abs(x) <= 0.44 + 1e-8 && z >= 0.06 - 1e-8 && z <= 0.94 + 1e-8,
    ),
  ).toBe(true)
  const handrailOnly = StairNode.parse({
    handrail: { mode: 'both' },
    railingMode: 'none',
    railingStyle: 'cable',
    railingHeight: 1e9,
  })
  expect(measureStairDetail(handrailOnly, []).status).toBe('evaluated')
  expect(resolveStairHandrailPaths(handrailOnly, { [handrailOnly.id]: handrailOnly })).toHaveLength(
    2,
  )
})

it('bounds the metal guard by run before allocating detail, preserving authored dimensions', async () => {
  const { measureStairDetail } = await import('@pascal-app/core')
  const ordinary = StairSegmentNode.parse({ length: 3, stepCount: 14 })
  const stair = StairNode.parse({
    children: [ordinary.id],
    railingMode: 'both',
    railingStyle: 'metal',
  })
  expect(measureStairDetail(stair, [ordinary]).status).toBe('evaluated')
  // The infill pitches by run, so a pathological run refuses — unlike a huge
  // guard height, which does not multiply the metal guard's component count.
  for (const dimension of ['length', 'railingTopReach'] as const) {
    const huge = StairSegmentNode.parse({ length: dimension === 'length' ? 1e9 : 3 })
    const hugeStair = StairNode.parse({
      children: [huge.id],
      railingMode: 'both',
      railingStyle: 'metal',
      ...(dimension === 'railingTopReach' ? { railingTopReach: 1e9 } : {}),
    })
    expect(measureStairDetail(hugeStair, [huge]).error).toContain('computation budget')
    expect(dimension === 'length' ? huge.length : hugeStair.railingTopReach).toBe(1e9)
  }
})

it('extends independent handrails at ascent portals and returns to source and arrival floors', async () => {
  const { resolveStairHandrailPaths, planStairPreset } = await import('@pascal-app/core')
  expect(StairNode.parse({ handrail: {} }).handrail?.bottom).toBeUndefined()
  for (const layout of ['straight', 'l', 'u'] as const) {
    const stair = StairNode.parse({
      totalRise: 3,
      handrail: {
        mode: 'both',
        offset: 0,
        bottom: { extension: 0.3, return: 'floor' },
        top: { extension: 0.4, return: 'floor' },
      },
    })
    const plan = planStairPreset(stair, { [stair.id]: stair }, { layout, turn: 'left' })
    const nodes = Object.fromEntries([plan.stair, ...plan.segments].map((node) => [node.id, node]))
    const paths = resolveStairHandrailPaths(plan.stair, nodes)
    for (const path of paths) {
      const ends = [path.points[0]!, path.points.at(-1)!].sort((a, b) => a[1] - b[1])
      expect(ends[0]![1] + stair.handrail!.height).toBeCloseTo(0)
      expect(ends[1]![1] + stair.handrail!.height).toBeCloseTo(3)
      expect(path.points.every((point) => point.every(Number.isFinite))).toBe(true)
    }
  }
  for (const sweepAngle of [2, -2]) {
    const stair = StairNode.parse({
      stairType: 'curved',
      totalRise: 3,
      sweepAngle,
      handrail: {
        mode: 'left',
        offset: 0,
        bottom: { extension: 0.3 },
        top: { extension: 0.4, return: 'wall', returnLength: 0.2 },
      },
    })
    const path = resolveStairHandrailPaths(stair, { [stair.id]: stair })[0]!
    expect(path.points[0]![1]).toBeLessThan(path.points[1]![1])
    expect(path.points.at(-2)![1]).toBeCloseTo(3)
    expect(path.points.at(-1)![1]).toBeCloseTo(3)
    expect(
      Math.hypot(
        path.points.at(-1)![0] - path.points.at(-2)![0],
        path.points.at(-1)![2] - path.points.at(-2)![2],
      ),
    ).toBeCloseTo(0.2)
  }
})

it('keeps handrail ends off closed and hidden portals and refuses a floor-crossing extension', async () => {
  const { resolveStairHandrailPaths } = await import('@pascal-app/core')
  const landing = StairSegmentNode.parse({ segmentType: 'landing', height: 0 })
  const stair = StairNode.parse({
    children: [landing.id],
    handrail: { mode: 'both', bottom: { extension: 0.3 }, top: { extension: 0.3 } },
  })
  const nodes = { [stair.id]: stair, [landing.id]: landing }
  expect(resolveStairHandrailPaths(stair, nodes)).toEqual(
    resolveStairHandrailPaths(
      { ...stair, handrail: { ...stair.handrail!, bottom: undefined, top: undefined } },
      nodes,
    ),
  )
  const flight = StairSegmentNode.parse({ stepCount: 1, height: 1, length: 1 })
  const single = StairNode.parse({
    children: [flight.id],
    handrail: { mode: 'left', offset: 0, bottom: { extension: 0.2 }, top: { extension: 0.2 } },
  })
  const path = resolveStairHandrailPaths(single, { [single.id]: single, [flight.id]: flight })[0]!
  expect(Math.min(path.points[0]![1], path.points.at(-1)![1])).toBeCloseTo(0.8)
  expect(
    resolveStairHandrailPaths(single, {
      [single.id]: single,
      [flight.id]: { ...flight, visible: false },
    }),
  ).toEqual([])
  expect(() =>
    resolveStairHandrailPaths(
      {
        ...single,
        handrail: {
          ...single.handrail!,
          bottom: { extension: 10, return: 'none', returnLength: 0 },
        },
      },
      { [flight.id]: flight },
    ),
  ).toThrow('source floor')
})

it('rectangular winders divide square walking lines, preserve corner area and chain exact exits', async () => {
  const { resolveStairWinder, computeSegmentTransforms, planStairPreset, measureStair } =
    await import('@pascal-app/core')
  for (const turn of ['left', 'right'] as const) {
    const flight = StairSegmentNode.parse({
      width: 1.2,
      height: 0.9,
      stepCount: 5,
      winder: { turn, innerGap: 0.2, walkingLineOffset: 0.6 },
    })
    const layout = resolveStairWinder(flight)!
    const area = (polygon: [number, number][]) =>
      Math.abs(
        polygon.reduce((sum, a, i) => {
          const b = polygon[(i + 1) % polygon.length]!
          return sum + a[0] * b[1] - a[1] * b[0]
        }, 0) / 2,
      )
    expect(layout.treads.reduce((sum, tread) => sum + area(tread.polygon), 0)).toBeCloseTo(
      1.4 ** 2 - 0.2 ** 2,
      10,
    )
    expect(layout.footprint.length).toBe(6)
    for (const tread of layout.treads)
      expect(tread.endStation - tread.startStation).toBeCloseTo(1.6 / 5, 10)
    const straight = StairSegmentNode.parse({
      width: 1.2,
      length: 2,
      height: 1,
      attachmentSide: 'front',
    })
    const transforms = computeSegmentTransforms([flight, straight])
    expect(transforms[1]!.position).toEqual(layout.exit.position)
    expect(transforms[1]!.rotation).toBe(layout.exit.rotation)
    const stair = StairNode.parse({ totalRise: 3.1, width: 1.2, railingMode: 'none' })
    for (const shape of ['l', 'u'] as const) {
      const plan = planStairPreset(
        stair,
        { [stair.id]: stair },
        { layout: shape, turn, turningStrategy: 'winder' },
      )
      expect(plan.segments.filter((segment) => segment.winder).length).toBe(shape === 'u' ? 2 : 1)
      expect(plan.segments.reduce((sum, segment) => sum + segment.height, 0)).toBeCloseTo(3.1, 10)
      const risers = plan.segments.map((segment) => segment.height / segment.stepCount)
      expect(Math.max(...risers) - Math.min(...risers)).toBeLessThan(1e-10)
      const nodes = {
        [plan.stair.id]: plan.stair,
        ...Object.fromEntries(plan.segments.map((segment) => [segment.id, segment])),
      }
      expect(
        measureStair(plan.stair, nodes).diagnostics.some((d) => d.code === 'narrow-winder-end'),
      ).toBe(true)
    }
  }
})

it('winder construction keeps finished heights across all body modes and rejects invalid walking lines', async () => {
  const { resolveStairWinder, resolveWinderStairConstruction, StairConstruction } = await import(
    '@pascal-app/core'
  )
  for (const mode of ['solid', 'waist', 'open', 'side-stringers', 'center-stringer'] as const) {
    const flight = StairSegmentNode.parse({
      width: 1.2,
      height: 0.9,
      stepCount: 5,
      winder: { turn: 'left', innerGap: 0.1, walkingLineOffset: 0.6 },
      construction: StairConstruction.parse({ mode, finishThickness: 0.02, nosing: 0.03 }),
    })
    const pieces = resolveWinderStairConstruction(flight, 0.4)!
    for (let index = 0; index < 5; index++) {
      expect(Math.max(...pieces.filter((p) => p.index === index).map((p) => p.top))).toBeCloseTo(
        (index + 1) * 0.18,
        10,
      )
      for (const piece of pieces.filter((p) => p.index === index))
        expect(piece.bottom.every((bottom) => bottom < piece.top)).toBe(true)
    }
  }
  expect(() =>
    resolveStairWinder(
      StairSegmentNode.parse({ width: 0.5, winder: { turn: 'right', walkingLineOffset: 0.6 } }),
    ),
  ).toThrow('walking line')
  expect(resolveStairWinder(StairSegmentNode.parse({}))).toBeNull()
})

it('sizes winder risers from their current walking distance and preserves ignored straight length', async () => {
  const { planStairSizingEdit } = await import('@pascal-app/core')
  const winder = StairSegmentNode.parse({
    length: 999,
    width: 1,
    height: 1,
    stepCount: 3,
    winder: { turn: 'right', innerGap: 0.2, walkingLineOffset: 0.5 },
  })
  const straight = StairSegmentNode.parse({ length: 1.4, height: 2, stepCount: 7 })
  const stair = StairNode.parse({
    totalRise: 3,
    children: [winder.id, straight.id],
    railingMode: 'none',
  })
  const nodes = { [stair.id]: stair, [winder.id]: winder, [straight.id]: straight }
  const updates = planStairSizingEdit(stair, nodes, true)
  const winderUpdate = updates.find((update) => update.id === winder.id)!.data
  const straightUpdate = updates.find((update) => update.id === straight.id)!.data
  expect(
    Math.abs(
      (winderUpdate as StairSegmentNode).stepCount - (straightUpdate as StairSegmentNode).stepCount,
    ),
  ).toBeLessThanOrEqual(1)
  expect(winderUpdate.length).toBeUndefined()
  expect(straightUpdate.length).toBeGreaterThan(0)
})

it('keeps zero-gap L/U guards and inset handrails continuous and restores replacement winder visibility', async () => {
  const { planStairPreset, resolveStairRailPaths, resolveStairHandrailPaths } = await import(
    '@pascal-app/core'
  )
  for (const layout of ['l', 'u'] as const)
    for (const turn of ['left', 'right'] as const)
      for (const offset of [0, 0.06]) {
        const stair = StairNode.parse({
          totalRise: 3,
          width: 1.2,
          railingMode: 'both',
          handrail: { mode: 'both', offset },
        })
        const plan = planStairPreset(
          stair,
          { [stair.id]: stair },
          { layout, turn, turningStrategy: 'winder' },
        )
        const nodes = Object.fromEntries(
          [plan.stair, ...plan.segments].map((node) => [node.id, node]),
        )
        for (const paths of [
          resolveStairRailPaths(plan.stair, nodes),
          resolveStairHandrailPaths(plan.stair, nodes),
        ]) {
          expect(paths.length).toBe(2)
          for (const path of paths) {
            expect(path.nodeIds.length).toBe(plan.segments.length)
            expect(path.points[0]![1]).toBeCloseTo(3 / plan.stair.stepCount, 10)
            expect(path.points.at(-1)![1]).toBeCloseTo(3, 10)
            for (let i = 1; i < path.points.length; i++)
              expect(path.points[i]![1]).toBeGreaterThanOrEqual(path.points[i - 1]![1] - 1e-9)
          }
        }
        const old = plan.segments.find((segment) => segment.winder)!
        const hidden = { ...old, visible: false }
        const replacement = planStairPreset(
          plan.stair,
          { ...nodes, [old.id]: hidden },
          { layout, turn, turningStrategy: 'winder' },
        )
        expect(replacement.segments.find((segment) => segment.id === old.id)!.visible).toBe(true)
      }
})

it('joins inset handrails across a winder arrival landing without closing its portal', async () => {
  const { planStairPreset, resolveStairHandrailPaths } = await import('@pascal-app/core')
  for (const turn of ['left', 'right'] as const) {
    const stair = StairNode.parse({
      totalRise: 3,
      width: 1.2,
      railingMode: 'both',
      handrail: { mode: 'both', offset: 0.06 },
    })
    const plan = planStairPreset(
      stair,
      { [stair.id]: stair },
      { layout: 'l', turn, turningStrategy: 'winder' },
    )
    const landing = StairSegmentNode.parse({
      segmentType: 'landing',
      height: 0,
      width: 1.2,
      length: 1.2,
    })
    plan.segments.splice(2, 0, landing)
    plan.stair.children = plan.segments.map((segment) => segment.id)
    const nodes = Object.fromEntries([plan.stair, ...plan.segments].map((node) => [node.id, node]))
    const paths = resolveStairHandrailPaths(plan.stair, nodes)
    expect(paths.length).toBe(2)
    for (const path of paths) {
      expect(path.nodeIds.length).toBe(4)
      expect(path.points[0]![1]).toBeCloseTo(3 / plan.stair.stepCount, 10)
      expect(path.points.at(-1)![1]).toBeCloseTo(3, 10)
    }
  }
})

it('extends terminal zero-gap winder handrails from their entry and exit portals', async () => {
  const { resolveStairHandrailPaths, resolveStairWinder, rotateXZ } = await import(
    '@pascal-app/core'
  )
  for (const turn of ['left', 'right'] as const)
    for (const offset of [0, 0.06])
      for (const returnType of ['floor', 'wall'] as const) {
        const flight = StairSegmentNode.parse({
          width: 1.2,
          height: 0.9,
          stepCount: 4,
          winder: { turn, innerGap: 0, walkingLineOffset: 0.6 },
        })
        const extension = offset ? 0.05 : 0.2
        const stair = StairNode.parse({
          totalRise: 0.9,
          children: [flight.id],
          railingMode: 'both',
          handrail: {
            mode: 'both',
            offset,
            bottom: { extension, return: returnType, returnLength: 0.1 },
            top: { extension, return: returnType, returnLength: 0.1 },
          },
        })
        const paths = resolveStairHandrailPaths(stair, { [stair.id]: stair, [flight.id]: flight })
        const exit = resolveStairWinder(flight)!.exit
        expect(paths.length).toBe(2)
        for (const path of paths) {
          expect(path.points.length).toBeGreaterThanOrEqual(6)
          const bottomReturn = path.points[0]!,
            bottomExtended = path.points[1]!,
            topExtended = path.points.at(-2)!,
            topReturn = path.points.at(-1)!
          expect(bottomExtended[2]).toBeCloseTo(-extension, 10)
          const [dx, dz] = rotateXZ(
            topExtended[0] - exit.position[0],
            topExtended[2] - exit.position[2],
            -exit.rotation,
          )
          expect(dz).toBeCloseTo(extension, 10)
          expect(Number.isFinite(dx)).toBe(true)
          if (returnType === 'floor') {
            expect(bottomReturn[1] + stair.handrail!.height).toBeCloseTo(0, 10)
            expect(topReturn[1] + stair.handrail!.height).toBeCloseTo(0.9, 10)
          } else {
            expect(
              Math.hypot(bottomReturn[0] - bottomExtended[0], bottomReturn[2] - bottomExtended[2]),
            ).toBeCloseTo(0.1, 10)
            expect(
              Math.hypot(topReturn[0] - topExtended[0], topReturn[2] - topExtended[2]),
            ).toBeCloseTo(0.1, 10)
          }
        }
      }
})
