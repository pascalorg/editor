import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type SlabNode,
  type StairNode,
  type StairSegmentNode,
  useScene,
} from '@pascal-app/core'
import { commitDeck } from './deck-commit'

const LEVEL_ID = 'level_test'

const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

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
    height: 2.5,
  } as AnyNode
}

function sceneNodes() {
  return useScene.getState().nodes as Record<string, AnyNode>
}

function findByType<T extends AnyNode>(type: T['type']): T | undefined {
  return Object.values(sceneNodes()).find((node) => node.type === type) as T | undefined
}

describe('commitDeck', () => {
  beforeEach(() => {
    useScene.setState({
      collections: {},
      dirtyNodes: new Set<AnyNodeId>(),
      nodes: { [LEVEL_ID]: makeLevel() },
      readOnly: false,
      rootNodeIds: [LEVEL_ID] as AnyNodeId[],
    } as never)
  })

  test('mezzanine stair attaches to the deck instead of carrying an explicit rise', () => {
    commitDeck({
      levelId: LEVEL_ID as never,
      points: SQUARE,
      elevation: 1.25,
      withStair: true,
      namePrefix: 'Mezzanine',
    })

    const deck = findByType<SlabNode>('slab')
    const stair = findByType<StairNode>('stair')
    expect(deck).toBeDefined()
    expect(stair).toBeDefined()
    expect(deck?.elevation).toBe(1.25)
    expect(stair?.deckSlabId).toBe(deck?.id)
    // The derivation owns the rise — an explicit totalRise would go stale
    // the moment the deck moves.
    expect('totalRise' in (stair as StairNode)).toBe(false)

    const segmentId = stair?.children?.[0]
    const segment = segmentId
      ? (sceneNodes()[segmentId] as StairSegmentNode | undefined)
      : undefined
    expect(segment?.type).toBe('stair-segment')
    expect(segment?.height).toBe(1.25)
  })

  test('a deck without a stair creates no stair attachment', () => {
    commitDeck({
      levelId: LEVEL_ID as never,
      points: SQUARE,
      elevation: 0.05,
      withStair: false,
      namePrefix: 'Balcony',
    })

    expect(findByType<SlabNode>('slab')).toBeDefined()
    expect(findByType<StairNode>('stair')).toBeUndefined()
  })
})
