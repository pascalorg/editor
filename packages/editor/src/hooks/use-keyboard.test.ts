import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  clearSceneHistory,
  useScene,
} from '@pascal-app/core'
import { meshEditScope } from '../lib/interaction/scope'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import {
  canCycleSnappingModeShortcut,
  canRunGlobalRotationShortcut,
  isToolOwnedCanopyForm,
  isToolOwnedRotation,
  runHistoryShortcut,
} from './use-keyboard'

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
  useEditor.getState().armToolMode({ mode: 'select' })
  clearSceneHistory()
})

describe('rotation shortcut ownership', () => {
  test('leaves R and T to the active item placement tool', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'item' })

    expect(isToolOwnedRotation()).toBe(true)
  })

  test('leaves R and T to the active lean-to placement tool', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'lean-to-extension' })

    expect(isToolOwnedRotation()).toBe(true)
  })

  test('leaves R and T to a moving lean-to extension', () => {
    const leanTo = { id: 'lean_to_moving', type: 'lean-to-extension' } as unknown as AnyNode
    useInteractionScope.getState().begin({
      kind: 'moving',
      node: leanTo,
      nodeId: leanTo.id,
      nodeType: leanTo.type,
      view: '3d',
    })

    expect(isToolOwnedRotation()).toBe(true)
  })

  test('leaves F to the active lean-to placement tool', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'lean-to-extension' })

    expect(isToolOwnedCanopyForm()).toBe(true)
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
    expect(isToolOwnedCanopyForm()).toBe(false)
  })
})

describe('history shortcuts during block editing', () => {
  test('reserves global rotation shortcuts for the active mesh editor', () => {
    expect(canRunGlobalRotationShortcut()).toBe(true)
    useInteractionScope.getState().begin(meshEditScope(NODE_ID))
    expect(canRunGlobalRotationShortcut()).toBe(false)
  })

  test('keeps Shift available to cycle snapping while a mesh operation is active', () => {
    useInteractionScope.getState().begin(meshEditScope(NODE_ID))
    expect(canCycleSnappingModeShortcut(true)).toBe(true)

    useInteractionScope.getState().begin(meshEditScope(NODE_ID, 'operating', 'translate'))
    expect(canCycleSnappingModeShortcut(true)).toBe(true)
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
