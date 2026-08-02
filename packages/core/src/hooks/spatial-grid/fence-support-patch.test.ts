import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, SlabNode } from '../../schema'
import useScene from '../../store/use-scene'
import { spatialGridManager } from './spatial-grid-manager'
import { type FenceSupportInput, resolveFenceSupportSlabPatch } from './support-host-patch'

const LEVEL_ID = 'level_test'

/** Deck footprint in plan: x/z ∈ [0, 4] × [0, 3]. */
const DECK_POLYGON: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

/** Ground floor slab under (and far beyond) the deck. */
const GROUND_POLYGON: Array<[number, number]> = [
  [-6, -6],
  [6, -6],
  [6, 6],
  [-6, 6],
]

const DECK_ELEVATION = 0.9
const FLOOR_ELEVATION = 0.05

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

/** Straight fence fully over the deck footprint. */
function fenceOnDeck(overrides: Partial<FenceSupportInput> = {}): FenceSupportInput {
  return {
    start: [0.5, 1.5],
    end: [3.5, 1.5],
    thickness: 0.08,
    parentId: LEVEL_ID,
    ...overrides,
  }
}

function nodesFor(...nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

function sceneWith(...slabs: SlabNode[]): Record<string, AnyNode> {
  const nodes = nodesFor(makeLevel(), ...(slabs as AnyNode[]))
  useScene.setState({ nodes })
  for (const slab of slabs) addSlab(slab)
  return nodes
}

beforeEach(() => {
  spatialGridManager.clear()
  useScene.setState({ nodes: {} })
})

describe('resolveFenceSupportSlabPatch', () => {
  test('a fence drawn over a deck stacked on the floor persists the deck (uncapped max election)', () => {
    const nodes = sceneWith(
      makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION),
      makeSlab('slab_ground', GROUND_POLYGON, FLOOR_ELEVATION),
    )
    expect(resolveFenceSupportSlabPatch(fenceOnDeck(), nodes)).toEqual({
      supportSlabId: 'slab_deck',
    })
  })

  test('the pointer cap decides between stacked surfaces', () => {
    const nodes = sceneWith(
      makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION),
      makeSlab('slab_ground', GROUND_POLYGON, FLOOR_ELEVATION),
    )
    // Aiming at the floor under the deck elects (and persists) the floor.
    expect(
      resolveFenceSupportSlabPatch(fenceOnDeck(), nodes, { maxElevation: FLOOR_ELEVATION }),
    ).toEqual({ supportSlabId: 'slab_ground' })
    // Aiming at the deck top keeps the deck.
    expect(
      resolveFenceSupportSlabPatch(fenceOnDeck(), nodes, { maxElevation: DECK_ELEVATION }),
    ).toEqual({ supportSlabId: 'slab_deck' })
  })

  test('a lone elevated deck (balcony, nothing underneath) still persists its host', () => {
    // Unambiguous single candidate — but fences resolve an absent host to
    // the level floor, so an elevated winner must be written or the fence
    // renders buried under the deck.
    const nodes = sceneWith(makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION))
    expect(resolveFenceSupportSlabPatch(fenceOnDeck(), nodes)).toEqual({
      supportSlabId: 'slab_deck',
    })
  })

  test('a plain default ground slab stays unpersisted (fence keeps sitting at the level base)', () => {
    const nodes = sceneWith(makeSlab('slab_ground', GROUND_POLYGON, FLOOR_ELEVATION))
    expect(resolveFenceSupportSlabPatch(fenceOnDeck(), nodes)).toEqual({
      supportSlabId: undefined,
    })
  })

  test('capped at bare ground under a deck-only overlap resolves to the floor default', () => {
    const nodes = sceneWith(makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION))
    expect(resolveFenceSupportSlabPatch(fenceOnDeck(), nodes, { maxElevation: 0 })).toEqual({
      supportSlabId: undefined,
    })
  })

  test('no slabs / off-slab fence persists nothing', () => {
    const nodes = sceneWith()
    expect(resolveFenceSupportSlabPatch(fenceOnDeck(), nodes)).toEqual({
      supportSlabId: undefined,
    })

    const withDeck = sceneWith(makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION))
    expect(
      resolveFenceSupportSlabPatch(fenceOnDeck({ start: [10, 10], end: [13, 10] }), withDeck),
    ).toEqual({ supportSlabId: undefined })
  })

  test('a spline fence elects through its path band segments', () => {
    const nodes = sceneWith(
      makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION),
      makeSlab('slab_ground', GROUND_POLYGON, FLOOR_ELEVATION),
    )
    const spline = fenceOnDeck({
      start: [0.5, 0.5],
      end: [3.5, 2.5],
      path: [
        [0.5, 0.5],
        [2, 1.5],
        [3.5, 2.5],
      ],
    })
    expect(resolveFenceSupportSlabPatch(spline, nodes)).toEqual({ supportSlabId: 'slab_deck' })
  })

  test('a fence not parented to a level persists nothing', () => {
    const nodes = sceneWith(makeSlab('slab_deck', DECK_POLYGON, DECK_ELEVATION))
    expect(resolveFenceSupportSlabPatch(fenceOnDeck({ parentId: 'not_a_level' }), nodes)).toEqual({
      supportSlabId: undefined,
    })
  })
})
