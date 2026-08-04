import { beforeEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  GROUND_SUPPORT_ID,
  getFloorPlacedElevation,
} from '../../hooks/spatial-grid/floor-placed-elevation'
import { spatialGridManager } from '../../hooks/spatial-grid/spatial-grid-manager'
import { nodeRegistry, registerNode } from '../../registry'
import type { AnyNodeDefinition } from '../../registry/types'
import type { AnyNode, StairNode as StairNodeType } from '../../schema'
import { LevelNode, SlabNode, StairNode, StairSegmentNode } from '../../schema'
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
