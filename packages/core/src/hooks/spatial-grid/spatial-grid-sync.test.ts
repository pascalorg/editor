import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { encodeTerrainField } from '../../lib/terrain-codec'
import { applyHeightPatch, createTerrainField, flattenPatch } from '../../lib/terrain-field'
import { nodeRegistry, registerNode } from '../../registry'
import type { AnyNodeDefinition } from '../../registry/types'
import type { AnyNode, AnyNodeId } from '../../schema'
import useLiveTerrain from '../../store/use-live-terrain'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import { spatialGridManager } from './spatial-grid-manager'
import {
  initSpatialGridSync,
  markCoveringDependentsBelow,
  markLevelHeightDependents,
  markSlabChangeDependents,
  markTerrainSupportDependents,
} from './spatial-grid-sync'
import { GROUND_SUPPORT_ID } from './support-host-id'

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

  test('markSlabChangeDependents covers top, deck, and underside consumers', () => {
    const previous = makeSlab('slab_a', 'level_1', { elevation: 0.2, thickness: 0.2 })
    const next = { ...previous, elevation: 0.4, thickness: 0.4 } as AnyNode
    const sameLevelWall = makeChild('wall_same', 'wall', 'level_1')
    const attachedStair = {
      ...makeChild('stair_a', 'stair', 'level_1'),
      deckSlabId: 'slab_a',
    } as AnyNode
    const belowWall = makeChild('wall_below', 'wall', 'level_0')
    const belowCeiling = makeChild('ceiling_below', 'ceiling', 'level_0')
    const nodes = nodesFor(
      makeLevel('level_0', 0, 2.5, ['wall_below', 'ceiling_below']),
      makeLevel('level_1', 1, 2.5, ['slab_a', 'wall_same', 'stair_a']),
      next,
      sameLevelWall,
      attachedStair,
      belowWall,
      belowCeiling,
    )

    const { marked, markDirty } = collect()
    markSlabChangeDependents(previous as never, next as never, nodes, markDirty)

    expect([...new Set(marked)].sort()).toEqual([
      'ceiling_below',
      'stair_a',
      'wall_below',
      'wall_same',
    ])
  })
})

// The sculpt-desync rule. Nothing else in this file gates on a *node's* support
// being terrain, so these are the tests that keep a stroke from silently leaving
// the scene standing at the height the ground used to be.
describe('spatial-grid sync dirty rules (terrain support)', () => {
  const PLATEAU_HEIGHT = 2.5

  /** Ground that is a 2.5 m plateau over x,z ∈ [2,5] and flat at the datum elsewhere. */
  function terrainData() {
    const base = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
    const patch = flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, PLATEAU_HEIGHT)
    return encodeTerrainField(applyHeightPatch(base, patch as never))
  }

  function makeSite(overrides: Record<string, unknown> = {}): AnyNode {
    return {
      id: 'site_test',
      type: 'site',
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
      ...overrides,
    } as unknown as AnyNode
  }

  function makeFloorNode(id: string, parentId: string, position: [number, number, number]) {
    return {
      id,
      type: 'column',
      object: 'node',
      parentId,
      visible: true,
      metadata: {},
      children: [],
      position,
      rotation: [0, 0, 0],
    } as unknown as AnyNode
  }

  function registerFloorPlaced(kind: string) {
    registerNode({
      kind,
      schemaVersion: 1,
      schema: z.object({ type: z.literal(kind) }) as never,
      category: 'structure',
      defaults: () => ({}) as never,
      capabilities: { floorPlaced: { footprint: () => ({ dimensions: [0.3, 2.5, 0.3] }) } },
    } as unknown as AnyNodeDefinition)
  }

  let stopSync = () => {}

  function startWith(nodes: Record<AnyNodeId, AnyNode>, rootNodeIds: string[]) {
    spatialGridManager.clear()
    useScene.setState({
      collections: {},
      dirtyNodes: new Set<AnyNodeId>(),
      nodes,
      readOnly: false,
      rootNodeIds: rootNodeIds as AnyNodeId[],
    } as never)
    clearSceneHistory()
    stopSync = initSpatialGridSync()
    useScene.setState({ dirtyNodes: new Set<AnyNodeId>() })
  }

  beforeEach(() => {
    nodeRegistry._reset()
    registerFloorPlaced('column')
    useLiveTerrain.getState().endAll()
  })

  afterEach(() => {
    stopSync()
    stopSync = () => {}
    useLiveTerrain.getState().endAll()
    nodeRegistry._reset()
  })

  test('a sculpt stroke marks the nodes standing on the ground it moved', () => {
    const level = makeLevel('level_0', 0, 2.5, ['column_a'])
    const column = makeFloorNode('column_a', 'level_0', [3, 0, 3])
    const site = makeSite()
    startWith(nodesFor(level, column, site), ['level_0', 'site_test'])

    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        site_test: makeSite({ terrain: terrainData() }),
      } as never,
    })

    expect(useScene.getState().dirtyNodes.has('column_a' as AnyNodeId)).toBe(true)
  })

  test('live dabs re-elevate dependents without writing the scene graph', () => {
    const level = makeLevel('level_0', 0, 2.5, ['column_a'])
    const column = makeFloorNode('column_a', 'level_0', [3, 0, 3])
    const site = makeSite()
    startWith(nodesFor(level, column, site), ['level_0', 'site_test'])
    const nodesBeforeStroke = useScene.getState().nodes

    const base = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
    const patch = flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, PLATEAU_HEIGHT)
    const live = applyHeightPatch(base, patch as never)
    useLiveTerrain.getState().begin(site.id, base)
    useScene.setState({ dirtyNodes: new Set<AnyNodeId>() })

    useLiveTerrain.getState().advance(site.id, live, patch as never)

    expect(useScene.getState().nodes).toBe(nodesBeforeStroke)
    expect(dirtyIds()).toEqual(['column_a'])

    useScene.setState({ dirtyNodes: new Set<AnyNodeId>() })
    useLiveTerrain.getState().end(site.id)
    expect(dirtyIds()).toEqual(['column_a'])
  })

  test('clearing the terrain marks them too, so they come back down with the ground', () => {
    const level = makeLevel('level_0', 0, 2.5, ['column_a'])
    const column = makeFloorNode('column_a', 'level_0', [3, 0, 3])
    startWith(nodesFor(level, column, makeSite({ terrain: terrainData() })), [
      'level_0',
      'site_test',
    ])

    useScene.setState({
      nodes: { ...useScene.getState().nodes, site_test: makeSite() } as never,
    })

    expect(useScene.getState().dirtyNodes.has('column_a' as AnyNodeId)).toBe(true)
  })

  test('a site edit that leaves the terrain object alone marks nothing', () => {
    const level = makeLevel('level_0', 0, 2.5, ['column_a'])
    const column = makeFloorNode('column_a', 'level_0', [3, 0, 3])
    const terrain = terrainData()
    startWith(nodesFor(level, column, makeSite({ terrain })), ['level_0', 'site_test'])

    // Same `terrain` object, different polygon — renaming a lot or reshaping its
    // boundary must not re-elevate the whole scene every keystroke.
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        site_test: makeSite({ terrain, polygon: { points: SQUARE } }),
      } as never,
    })

    expect(dirtyIds()).toEqual([])
  })

  test('only storeys at grade follow the ground', () => {
    // level_1 sits a storey up on level_0, so its floor is not the datum: its
    // contents have a real slab under them and must not be draped.
    const ground = makeLevel('level_0', 0, 2.5, ['column_ground'])
    const upper = makeLevel('level_1', 1, 2.5, ['column_upper'])
    const building = {
      id: 'building_a',
      type: 'building',
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['level_0', 'level_1'],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    } as unknown as AnyNode
    const groundColumn = makeFloorNode('column_ground', 'level_0', [3, 0, 3])
    const upperColumn = makeFloorNode('column_upper', 'level_1', [3, 0, 3])
    startWith(
      nodesFor(
        building,
        { ...ground, parentId: 'building_a' } as AnyNode,
        { ...upper, parentId: 'building_a' } as AnyNode,
        groundColumn,
        upperColumn,
        makeSite(),
      ),
      ['building_a', 'site_test'],
    )

    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        site_test: makeSite({ terrain: terrainData() }),
      } as never,
    })

    expect(dirtyIds()).toEqual(['column_ground'])
  })

  test('markTerrainSupportDependents skips nodes hosted on another node', () => {
    // A column parented to another column inherits Y from that group; lifting it
    // here would double-count the ground under its host.
    const level = makeLevel('level_0', 0, 2.5, ['column_host'])
    const host = makeFloorNode('column_host', 'level_0', [3, 0, 3])
    const hosted = makeFloorNode('column_hosted', 'column_host', [0, 0, 0])
    const nodes = nodesFor(level, host, hosted)

    const marked: string[] = []
    markTerrainSupportDependents(nodes, (id) => marked.push(id))

    expect(marked).toEqual(['column_host'])
  })

  test('markTerrainSupportDependents includes ground-hosted and terrain-fill structures', () => {
    const level = makeLevel('level_0', 0, 2.5, [
      'wall_ground',
      'wall_fill',
      'wall_other',
      'slab_fill',
      'slab_other',
      'column_a',
    ])
    const nodes = nodesFor(
      level,
      {
        ...makeChild('wall_ground', 'wall', 'level_0'),
        supportSlabId: GROUND_SUPPORT_ID,
      } as AnyNode,
      {
        ...makeChild('wall_fill', 'wall', 'level_0'),
        fillToTerrain: true,
      } as AnyNode,
      makeChild('wall_other', 'wall', 'level_0'),
      makeSlab('slab_fill', 'level_0', { fillToTerrain: true } as Partial<AnyNode>),
      makeSlab('slab_other', 'level_0'),
      makeFloorNode('column_a', 'level_0', [3, 0, 3]),
    )

    const marked: string[] = []
    markTerrainSupportDependents(nodes, (id) => marked.push(id))

    expect(marked).toEqual(['wall_ground', 'wall_fill', 'slab_fill', 'column_a'])
  })
})
