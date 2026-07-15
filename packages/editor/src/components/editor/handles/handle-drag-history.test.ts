import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { commitHandleDragPatch } from './handle-drag-history'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const NODE_ID = 'shelf_handle-drag-history' as AnyNodeId

function shelf(depth: number): AnyNode {
  return {
    id: NODE_ID,
    type: 'shelf',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    width: 1,
    depth,
    thickness: 0.04,
    height: 0.9,
    style: 'wall-shelf',
    rows: 1,
    columns: 1,
    withBack: false,
    withSides: true,
    withBottom: false,
    bracketStyle: 'minimal',
  } as AnyNode
}

describe('commitHandleDragPatch', () => {
  beforeEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  test('records the final patch as one undo step after preview history is resumed', () => {
    useScene.getState().createNode(shelf(0.3))
    const pastCount = useScene.temporal.getState().pastStates.length
    useScene.temporal.getState().pause()

    commitHandleDragPatch({
      patch: { depth: 0.7 },
      resumeHistory: () => useScene.temporal.getState().resume(),
      commit: (patch) => useScene.getState().updateNode(NODE_ID, patch),
    })

    expect(useScene.temporal.getState().pastStates).toHaveLength(pastCount + 1)
    expect((useScene.getState().nodes[NODE_ID] as { depth: number }).depth).toBe(0.7)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[NODE_ID]).toBeDefined()
    expect((useScene.getState().nodes[NODE_ID] as { depth: number }).depth).toBe(0.3)
  })
})
