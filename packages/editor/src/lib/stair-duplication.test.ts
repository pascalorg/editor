import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  StairNode,
  StairSegmentNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useInteractionScope, { getMovingNode } from '../store/use-interaction-scope'
import { duplicateStairSubtree } from './stair-duplication'

const LEVEL_ID = 'level_stair-duplicate' as AnyNodeId
const STAIR_ID = 'stair_original' as AnyNodeId
const SEGMENT_ID = 'sseg_original' as AnyNodeId

function seedStraightStair() {
  const level = LevelNode.parse({
    id: LEVEL_ID,
    type: 'level',
    children: [STAIR_ID],
  })
  const stair = StairNode.parse({
    id: STAIR_ID,
    type: 'stair',
    parentId: LEVEL_ID,
    children: [SEGMENT_ID],
    position: [2, 0, 3],
  })
  const segment = StairSegmentNode.parse({
    id: SEGMENT_ID,
    type: 'stair-segment',
    parentId: STAIR_ID,
  })
  useScene.setState({
    nodes: {
      [LEVEL_ID]: level as AnyNode,
      [STAIR_ID]: stair as AnyNode,
      [SEGMENT_ID]: segment as AnyNode,
    },
    rootNodeIds: [LEVEL_ID],
    collections: {},
    dirtyNodes: new Set(),
  } as never)
}

describe('duplicateStairSubtree', () => {
  beforeEach(() => {
    useInteractionScope.getState().end()
    useViewer.getState().setSelection({ selectedIds: [STAIR_ID] })
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    seedStraightStair()
  })

  afterEach(() => {
    useInteractionScope.getState().end()
    useScene.temporal.getState().resume()
    useViewer.getState().setSelection({ selectedIds: [] })
  })

  test('moves the exact fresh scene subtree and clears the original selection', () => {
    const result = duplicateStairSubtree(STAIR_ID, { mode: 'move' })
    const nodes = useScene.getState().nodes
    const draft = nodes[result.stair.id as AnyNodeId]

    expect(result.stair.id).not.toBe(STAIR_ID)
    expect(draft).toBe(result.stair)
    expect(getMovingNode()?.id).toBe(result.stair.id)
    expect(useViewer.getState().selection.selectedIds).toEqual([])
    expect((result.stair.metadata as Record<string, unknown>)?.isNew).toBe(true)
    expect(result.stair.position).toEqual([3, 0, 4])
    expect(result.segmentIds).toHaveLength(1)
    expect(result.segmentIds[0]).not.toBe(SEGMENT_ID)
    expect(nodes[result.segmentIds[0] as AnyNodeId]?.parentId).toBe(result.stair.id)
    expect(nodes[STAIR_ID]).toBeDefined()
    expect(nodes[SEGMENT_ID]).toBeDefined()
    expect(useScene.temporal.getState().isTracking).toBe(false)
  })

  test('keeps childless curved stairs on the same real draft path', () => {
    const curved = StairNode.parse({
      ...(useScene.getState().nodes[STAIR_ID] as AnyNode),
      children: [],
      stairType: 'curved',
    })
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [LEVEL_ID]: { ...state.nodes[LEVEL_ID], children: [STAIR_ID] } as AnyNode,
        [STAIR_ID]: curved as AnyNode,
      },
    }))

    const result = duplicateStairSubtree(STAIR_ID, { mode: 'move', offset: [0, 0, 0] })

    expect(result.segmentIds).toEqual([])
    expect(useScene.getState().nodes[result.stair.id as AnyNodeId]).toBe(result.stair)
    expect(getMovingNode()?.id).toBe(result.stair.id)
    expect((result.stair.metadata as Record<string, unknown>)?.isNew).toBe(true)
  })
})
