import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../../schema'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import { spatialGridManager } from './spatial-grid-manager'
import {
  initSpatialGridSync,
  markCoveringDependentsBelow,
  markLevelHeightDependents,
} from './spatial-grid-sync'

const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

function makeLevel(id: string, ordinal: number, height: number, children: string[]): AnyNode {
  return {
    id,
    type: 'level',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children,
    level: ordinal,
    height,
  } as AnyNode
}

function makeChild(id: string, type: string, parentId: string): AnyNode {
  return {
    id,
    type,
    object: 'node',
    parentId,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 1],
    end: [4, 1],
    thickness: 0.1,
    polygon: SQUARE,
    holes: [],
  } as unknown as AnyNode
}

function makeSlab(id: string, parentId: string, overrides: Partial<AnyNode> = {}): AnyNode {
  return {
    id,
    type: 'slab',
    object: 'node',
    parentId,
    visible: true,
    metadata: {},
    children: [],
    polygon: SQUARE,
    holes: [],
    holeMetadata: [],
    elevation: 0.05,
    thickness: 0.05,
    autoFromWalls: false,
    ...overrides,
  } as AnyNode
}

function nodesFor(...nodes: AnyNode[]): Record<AnyNodeId, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

function dirtyIds(): string[] {
  return [...useScene.getState().dirtyNodes].sort()
}

describe('spatial-grid sync dirty rules (vertical model)', () => {
  let stopSync = () => {}

  // Two orphan levels sharing the legacy stack: level_0 (below) carries a
  // wall, ceiling, stair, fence, and zone; level_1 (above) carries a slab.
  const wall = makeChild('wall_a', 'wall', 'level_0')
  const ceiling = makeChild('ceiling_a', 'ceiling', 'level_0')
  const stair = makeChild('stair_a', 'stair', 'level_0')
  const fence = makeChild('fence_a', 'fence', 'level_0')
  const zone = makeChild('zone_a', 'zone', 'level_0')
  const upperSlab = makeSlab('slab_up', 'level_1', { elevation: 0, thickness: 0.3 })
  const level0 = makeLevel('level_0', 0, 2.5, [
    'wall_a',
    'ceiling_a',
    'stair_a',
    'fence_a',
    'zone_a',
  ])
  const level1 = makeLevel('level_1', 1, 2.5, ['slab_up'])

  function setScene(nodes: Record<AnyNodeId, AnyNode>) {
    useScene.setState({
      collections: {},
      dirtyNodes: new Set<AnyNodeId>(),
      nodes,
      readOnly: false,
      rootNodeIds: ['level_0', 'level_1'] as AnyNodeId[],
    } as never)
    clearSceneHistory()
  }

  beforeEach(() => {
    spatialGridManager.clear()
    setScene(nodesFor(level0, level1, wall, ceiling, stair, fence, zone, upperSlab))
    stopSync = initSpatialGridSync()
    useScene.setState({ dirtyNodes: new Set<AnyNodeId>() })
  })

  afterEach(() => {
    stopSync()
    stopSync = () => {}
  })

  test('changing a level height marks its wall/stair/ceiling/fence children dirty', () => {
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        level_0: { ...level0, height: 3 } as AnyNode,
      } as never,
    })

    expect(dirtyIds()).toEqual(['ceiling_a', 'fence_a', 'stair_a', 'wall_a'])
  })

  test('a slab thickness change marks the walls and ceilings of the level below', () => {
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        slab_up: { ...upperSlab, thickness: 0.5 } as AnyNode,
      } as never,
    })

    expect(dirtyIds()).toEqual(['ceiling_a', 'wall_a'])
  })

  test('a slab recessed toggle marks the walls and ceilings of the level below', () => {
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        slab_up: { ...upperSlab, recessed: true } as AnyNode,
      } as never,
    })

    expect(dirtyIds()).toEqual(['ceiling_a', 'wall_a'])
  })

  test('creating a slab on the level above marks the level below, deleting it too', () => {
    const added = makeSlab('slab_new', 'level_1', { elevation: 0, thickness: 0.2 })
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        slab_new: added,
        level_1: { ...level1, children: ['slab_up', 'slab_new'] } as AnyNode,
      } as never,
    })
    expect(useScene.getState().dirtyNodes.has('wall_a' as AnyNodeId)).toBe(true)
    expect(useScene.getState().dirtyNodes.has('ceiling_a' as AnyNodeId)).toBe(true)

    useScene.setState({ dirtyNodes: new Set<AnyNodeId>() })
    const { slab_new: _gone, ...rest } = useScene.getState().nodes as Record<string, AnyNode>
    useScene.setState({
      nodes: { ...rest, level_1: { ...level1, children: ['slab_up'] } as AnyNode } as never,
    })
    expect(useScene.getState().dirtyNodes.has('wall_a' as AnyNodeId)).toBe(true)
    expect(useScene.getState().dirtyNodes.has('ceiling_a' as AnyNodeId)).toBe(true)
  })
})

describe('spatial-grid sync dirty rules (deck-attached stairs)', () => {
  let stopSync = () => {}

  const deck = makeSlab('slab_deck', 'level_0', { elevation: 1.25, thickness: 0.05 })
  const attachedStair = {
    ...makeChild('stair_deck', 'stair', 'level_0'),
    deckSlabId: 'slab_deck',
  } as AnyNode
  const otherStair = makeChild('stair_other', 'stair', 'level_0')
  const deckLevel = makeLevel('level_0', 0, 2.5, ['slab_deck', 'stair_deck', 'stair_other'])

  beforeEach(() => {
    spatialGridManager.clear()
    useScene.setState({
      collections: {},
      dirtyNodes: new Set<AnyNodeId>(),
      nodes: nodesFor(deckLevel, deck, attachedStair, otherStair),
      readOnly: false,
      rootNodeIds: ['level_0'] as AnyNodeId[],
    } as never)
    clearSceneHistory()
    stopSync = initSpatialGridSync()
    useScene.setState({ dirtyNodes: new Set<AnyNodeId>() })
  })

  afterEach(() => {
    stopSync()
    stopSync = () => {}
  })

  test('changing a deck elevation marks its attached stair dirty, not other stairs', () => {
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        slab_deck: { ...deck, elevation: 1.6 } as AnyNode,
      } as never,
    })

    expect(useScene.getState().dirtyNodes.has('stair_deck' as AnyNodeId)).toBe(true)
    expect(useScene.getState().dirtyNodes.has('stair_other' as AnyNodeId)).toBe(false)
  })

  test('a deck polygon-only change leaves the attached stair alone', () => {
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        slab_deck: {
          ...deck,
          polygon: [
            [0, 0],
            [5, 0],
            [5, 5],
            [0, 5],
          ],
        } as AnyNode,
      } as never,
    })

    expect(useScene.getState().dirtyNodes.has('stair_deck' as AnyNodeId)).toBe(false)
  })
})

describe('sync dirty helpers (pure)', () => {
  const collect = () => {
    const marked: string[] = []
    return { marked, markDirty: (id: AnyNodeId) => marked.push(id) }
  }

  test('markLevelHeightDependents marks only wall/stair/ceiling/fence children', () => {
    const level = makeLevel('level_0', 0, 2.5, [
      'wall_a',
      'stair_a',
      'ceiling_a',
      'fence_a',
      'zone_a',
      'missing',
    ])
    const nodes = nodesFor(
      level,
      makeChild('wall_a', 'wall', 'level_0'),
      makeChild('stair_a', 'stair', 'level_0'),
      makeChild('ceiling_a', 'ceiling', 'level_0'),
      makeChild('fence_a', 'fence', 'level_0'),
      makeChild('zone_a', 'zone', 'level_0'),
    )

    const { marked, markDirty } = collect()
    markLevelHeightDependents(level as never, nodes, markDirty)
    expect(marked.sort()).toEqual(['ceiling_a', 'fence_a', 'stair_a', 'wall_a'])
  })

  test('markCoveringDependentsBelow marks walls and ceilings of the level below only', () => {
    const nodes = nodesFor(
      makeLevel('level_0', 0, 2.5, ['wall_a', 'ceiling_a', 'zone_a']),
      makeLevel('level_1', 1, 2.5, []),
      makeChild('wall_a', 'wall', 'level_0'),
      makeChild('ceiling_a', 'ceiling', 'level_0'),
      makeChild('zone_a', 'zone', 'level_0'),
    )

    const { marked, markDirty } = collect()
    markCoveringDependentsBelow('level_1', nodes, markDirty)
    expect(marked.sort()).toEqual(['ceiling_a', 'wall_a'])
  })

  test('markCoveringDependentsBelow is a no-op for the lowest level', () => {
    const nodes = nodesFor(
      makeLevel('level_0', 0, 2.5, ['wall_a']),
      makeChild('wall_a', 'wall', 'level_0'),
    )

    const { marked, markDirty } = collect()
    markCoveringDependentsBelow('level_0', nodes, markDirty)
    expect(marked).toEqual([])
  })
})
