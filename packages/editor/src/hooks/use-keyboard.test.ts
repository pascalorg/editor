import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  BlockNode,
  clearSceneHistory,
  DoorNode,
  ItemNode,
  nodeRegistry,
  registerNode,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { meshEditScope } from '../lib/interaction/scope'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import {
  bindKeyboardShortcuts,
  canCycleSnappingModeShortcut,
  canRunGlobalRotationShortcut,
  getRotatableSelectedReference,
  isToolOwnedCanopyForm,
  isToolOwnedRotation,
  rotateGroupSelection,
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

class MockHTMLElement {}
;(globalThis as any).HTMLInputElement ??= class extends MockHTMLElement {}
;(globalThis as any).HTMLTextAreaElement ??= class extends MockHTMLElement {}
;(globalThis as any).HTMLElement ??= MockHTMLElement

if (typeof globalThis.window === 'undefined') {
  const listeners: Record<string, Function[]> = {}
  ;(globalThis as any).window = {
    addEventListener: (type: string, fn: Function) => {
      listeners[type] = listeners[type] || []
      listeners[type].push(fn)
    },
    removeEventListener: (type: string, fn: Function) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((f) => f !== fn)
      }
    },
    dispatchEvent: (e: any) => {
      const fns = [...(listeners[e.type] || [])]
      for (const fn of fns) fn(e)
      return true
    },
  }
}

if (typeof (globalThis as any).KeyboardEvent === 'undefined') {
  ;(globalThis as any).KeyboardEvent = class KeyboardEvent {
    type: string
    key: string
    code: string
    repeat: boolean
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
    target: any
    defaultPrevented: boolean
    constructor(type: string, init?: any) {
      this.type = type
      this.key = init?.key ?? ''
      this.code = init?.code ?? ''
      this.repeat = init?.repeat ?? false
      this.metaKey = init?.metaKey ?? false
      this.ctrlKey = init?.ctrlKey ?? false
      this.shiftKey = init?.shiftKey ?? false
      this.altKey = init?.altKey ?? false
      this.target = init?.target ?? null
      this.defaultPrevented = false
    }
    preventDefault() {
      this.defaultPrevented = true
    }
    stopPropagation() {}
  }
}

const NODE_ID = 'block_history' as AnyNodeId

function def(kind: string, category: AnyNodeDefinition['category']): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: {} as never,
    category,
    defaults: () => ({}) as never,
    capabilities: {},
    presentation: {
      label: kind,
      icon: { kind: 'iconify', name: 'lucide:square' },
    },
  } as AnyNodeDefinition
}

beforeEach(() => {
  registerNode(def('item', 'furnish'))
  registerNode(def('door', 'structure'))
  registerNode(def('wall', 'structure'))
  registerNode(def('guide', 'site'))
  const node = BlockNode.parse({ id: NODE_ID, position: [0, 0, 0] })
  useScene.setState({
    nodes: { [NODE_ID]: node },
    rootNodeIds: [NODE_ID],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    readOnly: false,
  } as never)
  useViewer.setState({ sceneLocked: false, lockedCategories: new Set(), selection: { selectedIds: [], levelId: 'ground' } })
  clearSceneHistory()
  useScene.getState().updateNode(NODE_ID, { position: [1, 2, 3] } as Partial<AnyNode>)
})

afterEach(() => {
  useInteractionScope.getState().end()
  useEditor.getState().armToolMode({ mode: 'select' })
  useViewer.setState({ sceneLocked: false, lockedCategories: new Set(), selection: { selectedIds: [], levelId: 'ground' } })
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

import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import { sceneRegistry, useInteractive } from '@pascal-app/core'

describe('edit-lock gating on reference and group rotation', () => {
  test('getRotatableSelectedReference returns null when scene is locked', () => {
    const guideId = 'guide_1' as AnyNodeId
    useScene.setState({
      nodes: {
        [guideId]: { id: guideId, type: 'guide', rotation: [0, 0, 0] } as never,
      },
    } as never)
    useEditor.getState().setSelectedReferenceId(guideId)

    expect(getRotatableSelectedReference()).not.toBeNull()

    useViewer.getState().setSceneLocked(true)
    expect(getRotatableSelectedReference()).toBeNull()
  })

  test('getRotatableSelectedReference returns null when guide is UI locked', () => {
    const guideId = 'guide_2' as AnyNodeId
    useScene.setState({
      nodes: {
        [guideId]: { id: guideId, type: 'guide', rotation: [0, 0, 0] } as never,
      },
    } as never)
    useEditor.getState().setSelectedReferenceId(guideId)
    useEditor.setState({ guideUi: { [guideId]: { locked: true, opacity: 1, zIndex: 0 } } })

    expect(getRotatableSelectedReference()).toBeNull()
  })

  test('rotateGroupSelection ignores edit-locked nodes', () => {
    const level = { id: 'level_0', type: 'level', elevation: 0, height: 3 }
    const wall1 = WallNode.parse({ id: 'wall_1', parentId: 'level_0', start: [0, 0], end: [2, 0] })
    const wall2 = WallNode.parse({ id: 'wall_2', parentId: 'level_0', start: [2, 0], end: [2, 2] })
    useScene.setState({
      nodes: { level_0: level as never, wall_1: wall1, wall_2: wall2 },
      rootNodeIds: ['level_0', 'wall_1', 'wall_2'],
    } as never)

    const mesh1 = new Mesh(new BoxGeometry(2, 3, 0.2), new MeshBasicMaterial())
    const mesh2 = new Mesh(new BoxGeometry(2, 3, 0.2), new MeshBasicMaterial())
    mesh1.position.set(1, 1.5, 0)
    mesh2.position.set(2, 1.5, 1)
    sceneRegistry.nodes.set('wall_1' as AnyNodeId, mesh1)
    sceneRegistry.nodes.set('wall_2' as AnyNodeId, mesh2)

    useViewer.getState().setSelection({ selectedIds: ['wall_1', 'wall_2'], levelId: 'level_0' })

    // Unlocked -> rotates
    expect(rotateGroupSelection(1)).toBe(true)

    // Scene locked -> returns false
    useViewer.getState().setSceneLocked(true)
    expect(rotateGroupSelection(1)).toBe(false)

    // Category locked -> returns false
    useViewer.getState().setSceneLocked(false)
    useViewer.getState().setCategoryLocked('structure', true)
    expect(rotateGroupSelection(1)).toBe(false)

    sceneRegistry.nodes.delete('wall_1' as AnyNodeId)
    sceneRegistry.nodes.delete('wall_2' as AnyNodeId)
  })
})

describe('edit-lock gating in useKeyboard / bindKeyboardShortcuts', () => {
  test('R key is blocked when selected door is edit-locked', () => {
    const cleanup = bindKeyboardShortcuts()
    const door = DoorNode.parse({
      id: 'door_1',
      parentId: 'wall_1',
      wallId: 'wall_1',
      side: 'front',
      rotation: [0, 0, 0],
    })
    useScene.setState({
      nodes: { door_1: door },
      rootNodeIds: ['door_1'],
    } as never)
    useViewer.getState().setSelection({ selectedIds: ['door_1'], levelId: 'ground' })

    // Lock category
    useViewer.getState().setCategoryLocked('structure', true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    expect((useScene.getState().nodes['door_1'] as DoorNode).side).toBe('front')

    // Unlock category
    useViewer.getState().setCategoryLocked('structure', false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    expect((useScene.getState().nodes['door_1'] as DoorNode).side).toBe('back')

    cleanup()
  })

  test('E key is blocked when selected door is edit-locked', () => {
    const cleanup = bindKeyboardShortcuts()
    const door = DoorNode.parse({
      id: 'door_2',
      parentId: 'wall_1',
      wallId: 'wall_1',
      side: 'front',
      rotation: [0, 0, 0],
    })
    useScene.setState({
      nodes: { door_2: door },
      rootNodeIds: ['door_2'],
    } as never)
    useViewer.getState().setSelection({ selectedIds: ['door_2'], levelId: 'ground' })

    // Scene locked
    useViewer.getState().setSceneLocked(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }))
    expect(useInteractive.getState().doorAnimations['door_2']).toBeUndefined()

    // Unlocked
    useViewer.getState().setSceneLocked(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }))
    expect(useInteractive.getState().doorAnimations['door_2']).toBeDefined()

    cleanup()
  })

  test('T key is blocked when selected item is edit-locked', () => {
    const cleanup = bindKeyboardShortcuts()
    const item = ItemNode.parse({
      id: 'item_1',
      parentId: 'level_0',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      asset: {
        id: 'asset_1',
        name: 'Chair',
        category: 'furniture',
        thumbnail: '/thumb.png',
        src: '/chair.glb',
        dimensions: [1, 1, 1],
      },
    })
    useScene.setState({
      nodes: { item_1: item },
      rootNodeIds: ['item_1'],
    } as never)
    useViewer.getState().setSelection({ selectedIds: ['item_1'], levelId: 'ground' })

    // Lock furnish category
    useViewer.getState().setCategoryLocked('furnish', true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }))
    expect((useScene.getState().nodes['item_1'] as ItemNode).rotation).toEqual([0, 0, 0])

    // Unlock furnish category
    useViewer.getState().setCategoryLocked('furnish', false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }))
    expect((useScene.getState().nodes['item_1'] as ItemNode).rotation[1]).toBeCloseTo(-Math.PI / 4)

    cleanup()
  })
})
