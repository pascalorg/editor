import { describe, expect, it } from 'bun:test'
import type { AnyNode } from '../../schema'
import { LevelNode, SlabNode, StairNode, StairSegmentNode } from '../../schema'
import { resolveStairTotalRise, syncDeckAttachedStairRises } from './stair-rise'

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

function makeDeck(elevation: number) {
  return SlabNode.parse({
    id: 'slab_deck',
    type: 'slab',
    polygon: [
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
  totalRise?: number
  deckSlabId?: string
  segments?: Array<{ id: string; segmentType: 'stair' | 'landing'; height: number }>
}) {
  const deck = makeDeck(options.deckElevation)
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

describe('syncDeckAttachedStairRises', () => {
  it('writes the deck elevation into a single flight segment', () => {
    const { nodes } = buildDeckScene({
      deckElevation: 1.6,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.25 }],
    })
    expect(syncDeckAttachedStairRises(nodes)).toEqual([
      { id: 'sseg_1' as never, data: { height: 1.6 } },
    ])
  })

  it('is a no-op when the flights already match the deck elevation', () => {
    const { nodes } = buildDeckScene({
      deckElevation: 1.25,
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.25 }],
    })
    expect(syncDeckAttachedStairRises(nodes)).toEqual([])
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
    const updates = syncDeckAttachedStairRises(nodes)
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
    expect(syncDeckAttachedStairRises(nodes)).toEqual([
      { id: 'sseg_1' as never, data: { height: 2.0 } },
    ])
  })

  it('leaves stairs with a stale deckSlabId untouched', () => {
    const { nodes } = buildDeckScene({
      deckElevation: 1.6,
      deckSlabId: 'slab_gone',
      segments: [{ id: 'sseg_1', segmentType: 'stair', height: 1.25 }],
    })
    expect(syncDeckAttachedStairRises(nodes)).toEqual([])
  })

  it('ignores unattached stairs', () => {
    const stair = StairNode.parse({
      id: 'stair_1',
      type: 'stair',
      position: [0, 0, 0],
      children: ['sseg_1'],
    })
    const segment = StairSegmentNode.parse({
      id: 'sseg_1',
      type: 'stair-segment',
      segmentType: 'stair',
      width: 1,
      length: 2,
      height: 1.0,
      stepCount: 8,
      parentId: 'stair_1',
    })
    const level = LevelNode.parse({
      id: 'level_1',
      type: 'level',
      level: 0,
      height: 2.5,
      children: ['stair_1'],
    })
    expect(syncDeckAttachedStairRises({ level_1: level, stair_1: stair, sseg_1: segment })).toEqual(
      [],
    )
  })
})
