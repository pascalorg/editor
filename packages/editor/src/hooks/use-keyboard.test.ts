import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  clearSceneHistory,
  useScene,
} from '@pascal-app/core'
import { meshEditScope } from '../lib/interaction/scope'
import useInteractionScope from '../store/use-interaction-scope'
import { canRunGlobalRotationShortcut, runHistoryShortcut } from './use-keyboard'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (
  callback,
) => {
  callback(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const NODE_ID = 'block_history' as AnyNodeId

beforeEach(() => {
  const node = BlockNode.parse({ id: NODE_ID, position: [0, 0, 0] })
  useScene.setState({
    nodes: { [NODE_ID]: node },
    rootNodeIds: [NODE_ID],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
  useScene.getState().updateNode(NODE_ID, { position: [1, 2, 3] } as Partial<AnyNode>)
})

afterEach(() => {
  useInteractionScope.getState().end()
  clearSceneHistory()
})

describe('history shortcuts during block editing', () => {
  test('reserves R for the active mesh editor', () => {
    expect(canRunGlobalRotationShortcut()).toBe(true)
    useInteractionScope.getState().begin(meshEditScope(NODE_ID))
    expect(canRunGlobalRotationShortcut()).toBe(false)
  })

  test('undoes and redoes mesh changes without leaving component selection mode', () => {
    useInteractionScope.getState().begin(meshEditScope(NODE_ID))

    expect(runHistoryShortcut('undo')).toBe(true)
    expect((useScene.getState().nodes[NODE_ID] as BlockNode).position).toEqual([0, 0, 0])
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'mesh-editing',
      nodeId: NODE_ID,
      phase: 'selecting',
    })

    expect(runHistoryShortcut('redo')).toBe(true)
    expect((useScene.getState().nodes[NODE_ID] as BlockNode).position).toEqual([1, 2, 3])
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'mesh-editing',
      nodeId: NODE_ID,
      phase: 'selecting',
    })
  })
})
