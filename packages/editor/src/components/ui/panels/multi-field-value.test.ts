import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  LevelNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import {
  buildMultiNodePatches,
  commitMultiNodeFields,
  fieldVisibleForAll,
  reduceFieldValue,
  reduceHeightBoundMode,
} from './multi-field-value'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const BUILDING_ID = 'building_multi_edit' as AnyNodeId
const LEVEL_ID = 'level_multi_edit' as AnyNodeId
const WALL_A = 'wall_multi_a' as AnyNodeId
const WALL_B = 'wall_multi_b' as AnyNodeId
const WALL_C = 'wall_multi_c' as AnyNodeId

function makeNode(id: string, type: string, fields: Record<string, unknown> = {}): AnyNode {
  return {
    object: 'node',
    id: id as AnyNodeId,
    type,
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    ...fields,
  } as unknown as AnyNode
}

describe('reduceFieldValue', () => {
  test('same values collapse to one', () => {
    const nodes = {
      a: makeNode('a', 'wall', { height: 2.4, thickness: 0.2 }),
      b: makeNode('b', 'wall', { height: 2.4, thickness: 0.15 }),
    }
    expect(reduceFieldValue(['a', 'b'], 'height', nodes)).toEqual({ kind: 'same', value: 2.4 })
    expect(reduceFieldValue(['a', 'b'], 'thickness', nodes)).toEqual({ kind: 'mixed' })
  })

  test('vec3 compares elementwise', () => {
    const nodes = {
      a: makeNode('a', 'item', { position: [1, 0, 2] }),
      b: makeNode('b', 'item', { position: [1, 0, 2] }),
      c: makeNode('c', 'item', { position: [1, 0, 3] }),
    }
    expect(reduceFieldValue(['a', 'b'], 'position', nodes)).toEqual({
      kind: 'same',
      value: [1, 0, 2],
    })
    expect(reduceFieldValue(['a', 'c'], 'position', nodes)).toEqual({ kind: 'mixed' })
  })
})

describe('reduceHeightBoundMode', () => {
  test('absent height is follows-level, present height is custom', () => {
    const nodes = {
      a: makeNode('a', 'wall'),
      b: makeNode('b', 'wall'),
      c: makeNode('c', 'wall', { height: 3 }),
    }
    expect(reduceHeightBoundMode(['a', 'b'], nodes)).toEqual({ kind: 'same', value: 'storey' })
    expect(reduceHeightBoundMode(['c'], nodes)).toEqual({ kind: 'same', value: 'custom' })
    expect(reduceHeightBoundMode(['a', 'c'], nodes)).toEqual({ kind: 'mixed' })
  })
})

describe('fieldVisibleForAll', () => {
  test('hides when any node would hide the field', () => {
    const nodes = {
      a: makeNode('a', 'slab', { recessed: false }),
      b: makeNode('b', 'slab', { recessed: true }),
    }
    const visibleIf = (n: AnyNode) => !(n as { recessed?: boolean }).recessed
    expect(fieldVisibleForAll(['a'], visibleIf, nodes)).toBe(true)
    expect(fieldVisibleForAll(['a', 'b'], visibleIf, nodes)).toBe(false)
  })
})

describe('buildMultiNodePatches', () => {
  test('a mixed field that is never edited produces no patch for it', () => {
    const nodes = {
      a: makeNode('a', 'wall', { height: 2.4, thickness: 0.2 }),
      b: makeNode('b', 'wall', { height: 3, thickness: 0.15 }),
    }
    const patches = buildMultiNodePatches(
      ['a' as AnyNodeId, 'b' as AnyNodeId],
      () => ({ thickness: 0.3 }),
      nodes,
    )
    expect(patches).toEqual([
      { id: 'a' as AnyNodeId, data: { thickness: 0.3 } },
      { id: 'b' as AnyNodeId, data: { thickness: 0.3 } },
    ])
    for (const patch of patches) {
      expect(patch.data).not.toHaveProperty('height')
    }
  })

  test('derive and reconcile fan out per node into one batch', () => {
    const nodes = {
      a: makeNode('a', 'wall', { height: 2 }),
      b: makeNode('b', 'wall', { height: 2 }),
    }
    const patches = buildMultiNodePatches(
      ['a' as AnyNodeId, 'b' as AnyNodeId],
      () => ({ height: 4 }),
      nodes,
      {
        derive: (next) => ({ thickness: (next as { height: number }).height / 10 }),
        reconcile: (prev) => [
          { id: `${prev.id}_follow` as AnyNodeId, data: { height: 4 } },
        ],
      },
    )
    expect(patches).toEqual([
      { id: 'a' as AnyNodeId, data: { height: 4, thickness: 0.4 } },
      { id: 'b' as AnyNodeId, data: { height: 4, thickness: 0.4 } },
      { id: 'a_follow' as AnyNodeId, data: { height: 4 } },
      { id: 'b_follow' as AnyNodeId, data: { height: 4 } },
    ])
  })
})

describe('commitMultiNodeFields', () => {
  beforeEach(() => {
    const wallA = WallNode.parse({
      id: WALL_A,
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
      height: 2.4,
    })
    const wallB = WallNode.parse({
      id: WALL_B,
      parentId: LEVEL_ID,
      start: [4, 0],
      end: [4, 3],
      height: 3,
    })
    const wallC = WallNode.parse({
      id: WALL_C,
      parentId: LEVEL_ID,
      start: [4, 3],
      end: [0, 3],
      height: 2.7,
    })
    const level = LevelNode.parse({
      id: LEVEL_ID,
      parentId: BUILDING_ID,
      children: [WALL_A, WALL_B, WALL_C],
      level: 0,
    })
    const building = BuildingNode.parse({
      id: BUILDING_ID,
      parentId: null,
      children: [LEVEL_ID],
    })
    useScene.setState({
      nodes: {
        [BUILDING_ID]: building,
        [LEVEL_ID]: level,
        [WALL_A]: wallA,
        [WALL_B]: wallB,
        [WALL_C]: wallC,
      },
      rootNodeIds: [BUILDING_ID],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
      materials: {},
      readOnly: false,
    } as never)
    clearSceneHistory()
    useLiveNodeOverrides.getState().clearAll()
  })

  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
  })

  test('dragging height onto three walls is one undo step', () => {
    commitMultiNodeFields([WALL_A, WALL_B, WALL_C], () => ({ height: 4 }))
    expect((useScene.getState().nodes[WALL_A] as { height?: number }).height).toBe(4)
    expect((useScene.getState().nodes[WALL_B] as { height?: number }).height).toBe(4)
    expect((useScene.getState().nodes[WALL_C] as { height?: number }).height).toBe(4)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect((useScene.getState().nodes[WALL_A] as { height?: number }).height).toBe(2.4)
    expect((useScene.getState().nodes[WALL_B] as { height?: number }).height).toBe(3)
    expect((useScene.getState().nodes[WALL_C] as { height?: number }).height).toBe(2.7)
  })
})
