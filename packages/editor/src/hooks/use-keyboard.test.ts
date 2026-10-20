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
  registerNode,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useSidebarStore } from '../components/ui/primitives/sidebar'
import { runRedo, runUndo } from '../lib/history'
import { meshEditScope } from '../lib/interaction/scope'
import { setSidebarTabIds } from '../lib/sidebar-panel'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import {
  armPaintFromShortcut,
  armWallToolFromShortcut,
  blocksSnappingShortcut,
  canCycleSnappingModeShortcut,
  canRunGlobalRotationShortcut,
  hasSceneKeyboardFocus,
  isToolOwnedCanopyForm,
  isToolOwnedRotation,
  markToolCancelConsumed,
  openItemCatalogFromShortcut,
  runHistoryShortcut,
  runNodeInteraction,
  switchPhaseFromShortcut,
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
  test('document panes keep copy, delete and editing shortcuts away from the scene until it is focused', () => {
    useEditor.setState({ viewLayouts: {} })
    expect(hasSceneKeyboardFocus()).toBe(true)
    useEditor.getState().showView('document:plan', { beside: true })
    expect(hasSceneKeyboardFocus()).toBe(false)
    useEditor.getState().focusViewPane(0)
    expect(hasSceneKeyboardFocus()).toBe(true)
    useEditor
      .getState()
      .setViewLayout({ split: false, panes: ['document:plan', '3d'], ratio: 0.5, focus: 0 })
    expect(hasSceneKeyboardFocus()).toBe(false)
    useEditor.getState().closeView('document:plan')
  })
  test('allows snap mode and spacing shortcuts in the duct and pipe length field', () => {
    const field = {
      tagName: 'INPUT',
      isContentEditable: false,
      hasAttribute: (name: string) => name === 'data-run-length-input',
      closest: (): object => field,
    }
    expect(blocksSnappingShortcut(field)).toBe(false)
  })

  test('continues to protect ordinary text fields and editable content', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'DIV']) {
      const field = {
        tagName,
        isContentEditable: tagName === 'DIV',
        hasAttribute: () => false,
        closest: (): object => field,
      }
      expect(blocksSnappingShortcut(field)).toBe(true)
    }
    expect(blocksSnappingShortcut(null)).toBe(false)
  })

  test('honors closest-owned fields and dialogs without claiming ordinary canvas keys', () => {
    // Model the DOM closest result, not its selector spelling. Native descendant
    // propagation is checked by the protected browser fixture.
    for (const role of ['textbox', 'combobox', 'dialog', 'alertdialog']) {
      const owner = { role }
      const descendant = {
        tagName: 'SPAN',
        isContentEditable: false,
        hasAttribute: () => false,
        closest: () => owner,
      }
      expect(blocksSnappingShortcut(descendant)).toBe(true)
    }
    const canvas = {
      tagName: 'CANVAS',
      isContentEditable: false,
      hasAttribute: () => false,
      closest: () => null,
    }
    expect(blocksSnappingShortcut(canvas)).toBe(false)
    expect(blocksSnappingShortcut({ ...canvas, tagName: 'SPAN', isContentEditable: true })).toBe(
      true,
    )
  })

  test('reserves the run-length exception for its actual input, not another editable owner', () => {
    const textarea = {
      tagName: 'TEXTAREA',
      isContentEditable: false,
      hasAttribute: (name: string) => name === 'data-run-length-input',
      closest: (): object => textarea,
    }
    expect(blocksSnappingShortcut(textarea)).toBe(true)
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
  useEditor.setState({ selectedItem: null, viewLayouts: {} })
  clearSceneHistory()
})

describe('rotation shortcut ownership', () => {
  test('does not reserve R and T for an armed item tool without a placement item', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'item' })

    expect(isToolOwnedRotation()).toBe(false)
  })

  test('leaves R and T to the active item placement tool', () => {
    useEditor.getState().setSelectedItem({
      asset: { id: 'asset:test' },
    } as never)
    useEditor.getState().armToolMode({ mode: 'build', tool: 'item' })

    expect(isToolOwnedRotation()).toBe(true)
  })

  test('leaves R and T to the active lean-to placement tool', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'lean-to-extension' })

    expect(isToolOwnedRotation()).toBe(true)
  })

  test('does not reserve R for the wall tool: its shape is picked in the Build panel', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })

    expect(isToolOwnedRotation()).toBe(false)
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

describe('E on a single selected node', () => {
  function registerKind(overrides: Record<string, unknown>) {
    const kind = `test:e-${crypto.randomUUID()}`
    registerNode({
      kind,
      schemaVersion: 1,
      category: 'furnish',
      defaults: () => ({}),
      capabilities: {},
      ...overrides,
    } as never)
    return { object: 'node', id: `${kind}_1`, type: kind } as unknown as AnyNode
  }

  const switchMechanism = {
    has: () => true,
    isOn: (node: AnyNode, state: ReturnType<typeof useInteractive.getState>) =>
      Boolean(state.mechanisms[node.id]),
    set: (node: AnyNode, on: boolean) => useInteractive.getState().setMechanism(node.id, on),
  }

  test('runs the mechanism of a kind that declares only the capability', () => {
    const node = registerKind({ capabilities: { mechanism: switchMechanism } })
    try {
      expect(runNodeInteraction(node)).toBe(true)
      expect(useInteractive.getState().mechanisms[node.id]).toBe(true)
      expect(runNodeInteraction(node)).toBe(true)
      expect(useInteractive.getState().mechanisms[node.id]).toBe(false)
    } finally {
      useInteractive.getState().removeMechanism(node.id)
    }
  })

  test("prefers the kind's own E action over its mechanism", () => {
    let ran = 0
    const node = registerKind({
      capabilities: { mechanism: switchMechanism },
      keyboardActions: { e: { appliesTo: () => true, run: () => (ran += 1) } },
    })
    expect(runNodeInteraction(node)).toBe(true)
    expect(ran).toBe(1)
    expect(useInteractive.getState().mechanisms[node.id]).toBeUndefined()
  })

  test('leaves E to the door and window fallbacks when nothing applies', () => {
    const node = registerKind({
      capabilities: { mechanism: { ...switchMechanism, has: () => false } },
    })
    expect(runNodeInteraction(node)).toBe(false)
    expect(runNodeInteraction(registerKind({}))).toBe(false)
  })
})

describe('B and P open their panel', () => {
  afterEach(() => {
    setSidebarTabIds([])
    useSidebarStore.getState().setIsCollapsed(false)
    useEditor.getState().setContinuation('wall', 'room')
    useEditor.getState().armToolMode({ mode: 'select' })
  })

  test('1 goes to site and 2 into the building; 3 is no longer a shortcut', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
    expect(switchPhaseFromShortcut('1')).toBe(true)
    expect(useEditor.getState().phase).toBe('site')
    expect(useEditor.getState().mode).toBe('select')
    expect(switchPhaseFromShortcut('2')).toBe(true)
    expect(useEditor.getState().phase).toBe('building')
    expect(switchPhaseFromShortcut('3')).toBe(false)
    expect(useEditor.getState().phase).toBe('building')
  })

  test('F, B and P arm their tool and keep the building', () => {
    setSidebarTabIds(['site', 'build', 'paint', 'items'])
    useEditor.getState().setPhase('building')
    for (const [arm, mode, tool] of [
      [openItemCatalogFromShortcut, 'build', 'item'],
      [armWallToolFromShortcut, 'build', 'wall'],
      [armPaintFromShortcut, 'material-paint', null],
    ] as const) {
      arm()
      expect(useEditor.getState().phase).toBe('building')
      expect(useEditor.getState().mode).toBe(mode)
      expect(useEditor.getState().tool).toBe(tool)
    }
    openItemCatalogFromShortcut()
    expect(useEditor.getState().activeSidebarPanel).toBe('items')
  })

  test('F, B and P also keep Site when arming their tool', () => {
    setSidebarTabIds(['site', 'build', 'paint', 'items'])
    for (const arm of [
      openItemCatalogFromShortcut,
      armWallToolFromShortcut,
      armPaintFromShortcut,
    ]) {
      useEditor.getState().setPhase('site')
      useEditor.getState().armToolMode({ mode: 'select' })
      arm()
      expect(useEditor.getState().phase).toBe('site')
    }
  })

  test('F opens a collapsed catalog sidebar', () => {
    setSidebarTabIds(['site', 'build', 'items'])
    useSidebarStore.getState().setIsCollapsed(true)
    openItemCatalogFromShortcut()
    expect(useEditor.getState().activeSidebarPanel).toBe('items')
    expect(useSidebarStore.getState().isCollapsed).toBe(false)
  })

  test('B arms the wall tool on Rectangle and shows the Build panel', () => {
    setSidebarTabIds(['site', 'build', 'paint', 'items'])
    useEditor.getState().setActiveSidebarPanel('items')
    useSidebarStore.getState().setIsCollapsed(true)
    useEditor.getState().setContinuation('wall', 'single')

    armWallToolFromShortcut()

    const editor = useEditor.getState()
    expect(editor.mode).toBe('build')
    expect(editor.tool).toBe('wall')
    expect(editor.getContinuation('wall')).toBe('rectangle')
    expect(editor.activeSidebarPanel).toBe('build')
    expect(useSidebarStore.getState().isCollapsed).toBe(false)
  })

  // A host may drop the armed tool when the panel changes (the community does,
  // with any placement in flight), so B and F open their panel first.
  test('B and F keep their tool from another panel where the host disarms on a panel change', () => {
    setSidebarTabIds(['build', 'paint', 'items', 'ai'])
    const unsubscribe = useEditor.subscribe((state, prev) => {
      if (state.activeSidebarPanel !== prev.activeSidebarPanel) {
        useEditor.getState().armToolMode({ mode: 'select' })
      }
    })
    try {
      for (const [arm, from, panel, tool] of [
        [armWallToolFromShortcut, 'ai', 'build', 'wall'],
        [openItemCatalogFromShortcut, 'paint', 'items', 'item'],
      ] as const) {
        useEditor.getState().setActiveSidebarPanel(from)
        arm()
        const editor = useEditor.getState()
        expect(editor.activeSidebarPanel).toBe(panel)
        expect(editor.mode).toBe('build')
        expect(editor.tool).toBe(tool)
      }
    } finally {
      unsubscribe()
    }
  })

  test('P arms paint and shows the Paint panel, or Build where the host has none', () => {
    setSidebarTabIds(['build', 'paint', 'items'])
    useEditor.getState().setActiveSidebarPanel('items')
    armPaintFromShortcut()
    expect(useEditor.getState().mode).toBe('material-paint')
    expect(useEditor.getState().activeSidebarPanel).toBe('paint')

    setSidebarTabIds(['site', 'build', 'items'])
    useEditor.getState().setActiveSidebarPanel('items')
    armPaintFromShortcut()
    expect(useEditor.getState().activeSidebarPanel).toBe('build')
  })
})
