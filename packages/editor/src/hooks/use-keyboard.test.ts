import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  clearSceneHistory,
  DuctFittingNode,
  DuctSegmentNode,
  emitter,
  nodeRegistry,
  PipeFittingNode,
  PipeSegmentNode,
  useScene,
} from '@pascal-app/core'
import { runRedo, runUndo } from '../lib/history'
import { meshEditScope } from '../lib/interaction/scope'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import {
  blocksSnappingShortcut,
  canCycleSnappingModeShortcut,
  canRunGlobalRotationShortcut,
  isToolOwnedCanopyForm,
  isToolOwnedRotation,
  markToolCancelConsumed,
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

describe('snapping shortcuts while entering a run length', () => {
  test('allows snap mode and spacing shortcuts in the duct and pipe length field', () => {
    expect(
      blocksSnappingShortcut({
        tagName: 'INPUT',
        isContentEditable: false,
        hasAttribute: (name) => name === 'data-run-length-input',
      }),
    ).toBe(false)
  })

  test('continues to protect ordinary text fields and editable content', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'DIV']) {
      expect(
        blocksSnappingShortcut({
          tagName,
          isContentEditable: tagName === 'DIV',
          hasAttribute: () => false,
        }),
      ).toBe(true)
    }
    expect(blocksSnappingShortcut(null)).toBe(false)
  })
})

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

describe('history while drawing distribution runs', () => {
  let restoreRegistry = () => {}

  beforeEach(() => {
    restoreRegistry = nodeRegistry._snapshot()
    nodeRegistry._reset()
    for (const kind of ['duct-segment', 'pipe-segment']) {
      nodeRegistry._register({
        kind,
        schemaVersion: 1,
        drafting: { cancelOnHistoryJump: true },
      } as never)
    }
  })

  afterEach(() => {
    restoreRegistry()
    restoreRegistry = () => {}
  })

  for (const [kind, schema, fittingSchema] of [
    ['duct', DuctSegmentNode, DuctFittingNode],
    ['pipe', PipeSegmentNode, PipeFittingNode],
  ] as const) {
    test(`undoes and redoes individual ${kind} commits while drafting`, () => {
      clearSceneHistory()
      const first = schema.parse({
        path: [
          [0, 1, 0],
          [1, 1, 0],
        ],
      })
      const second = schema.parse({
        path: [
          [1, 1, 0],
          [2, 1, 0],
        ],
      })
      useScene.getState().applyNodeChanges({ create: [{ node: first }] })
      const fitting = fittingSchema.parse({ position: [1, 1, 0] })
      const trimmedPath: [number, number, number][] = [
        [0, 1, 0],
        [0.8, 1, 0],
      ]
      useScene.getState().applyNodeChanges({
        create: [{ node: second }, { node: fitting }],
        update: [{ id: first.id, data: { path: trimmedPath } }],
      })
      expect(useScene.temporal.getState().pastStates).toHaveLength(2)
      useInteractionScope.getState().begin({ kind: 'drafting', tool: first.type })
      let cancellations = 0
      const cancel = () => {
        cancellations += 1
        markToolCancelConsumed()
      }
      emitter.on('tool:cancel', cancel)
      try {
        expect(runHistoryShortcut('undo')).toBe(true)
        expect(useScene.getState().nodes[second.id]).toBeUndefined()
        expect(useScene.getState().nodes[fitting.id]).toBeUndefined()
        expect(useScene.getState().nodes[first.id]).toMatchObject({ path: first.path })
        expect(runUndo().kind).toBe('applied')
        expect(useScene.getState().nodes[first.id]).toBeUndefined()
        expect(runRedo().kind).toBe('applied')
        expect(useScene.getState().nodes[first.id]).toBeDefined()
        expect(useScene.getState().nodes[second.id]).toBeUndefined()
        expect(runHistoryShortcut('redo')).toBe(true)
        expect(useScene.getState().nodes[second.id]).toBeDefined()
        expect(useScene.getState().nodes[fitting.id]).toBeDefined()
        expect(useScene.getState().nodes[first.id]).toMatchObject({ path: trimmedPath })
        expect(cancellations).toBe(4)
        expect(useInteractionScope.getState().scope).toEqual({ kind: 'drafting', tool: first.type })
      } finally {
        emitter.off('tool:cancel', cancel)
      }
    })
  }
})
