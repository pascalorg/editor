import { expect, test } from 'bun:test'
import {
  type DragAction,
  emitter,
  type GridEvent,
  ItemNode,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { _roots, act, createRoot } from '@react-three/fiber'
import type { ReactNode } from 'react'
import { PerspectiveCamera, Vector3, type WebGLRenderer } from 'three'
import { type DraftNodeHandle, useDraftNode } from '../components/tools/item/use-draft-node'
import { useDragAction } from '../hooks/use-drag-action'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import usePlacementPreview from '../store/use-placement-preview'
import { acquireEditorInteractionLock } from './editor-interaction-lock'

const level = LevelNode.parse({ id: 'level_ownership_hooks', name: 'Original' })
const asset = {
  id: 'ownership-chair',
  category: 'furniture',
  name: 'Chair',
  thumbnail: '/chair.png',
  src: '/chair.glb',
  dimensions: [1, 1, 1] as [number, number, number],
}

async function withMountedHook(content: ReactNode, verify: () => void) {
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  const previousEditor = useEditor.getState()
  const previousScope = useInteractionScope.getState()
  const previousPreview = usePlacementPreview.getState()
  const previousRaf = globalThis.requestAnimationFrame
  const previousCancelRaf = globalThis.cancelAnimationFrame
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  }) as unknown as HTMLCanvasElement
  const root = createRoot(canvas)
  try {
    useScene.setState({ nodes: { [level.id]: level }, rootNodeIds: [level.id], readOnly: false })
    useScene.temporal.getState().clear()
    useViewer.setState({
      selection: { buildingId: null, levelId: level.id, zoneId: null, selectedIds: [] },
    })
    await root.configure({
      gl: {
        domElement: canvas,
        render() {},
        setSize() {},
        setPixelRatio() {},
      } as unknown as WebGLRenderer,
      camera: new PerspectiveCamera(),
      frameloop: 'never',
      dpr: 1,
      size: { width: 100, height: 100, top: 0, left: 0 },
    })
    await act(async () => root.render(content))
    await act(async () => verify())
  } finally {
    await act(async () => root.render(null))
    _roots.delete(canvas)
    useScene.setState(previousScene, true)
    useViewer.setState(previousViewer, true)
    useEditor.setState(previousEditor, true)
    useInteractionScope.setState(previousScope, true)
    usePlacementPreview.setState(previousPreview, true)
    useScene.temporal.getState().resume()
    useScene.temporal.getState().clear()
    globalThis.requestAnimationFrame = previousRaf
    globalThis.cancelAnimationFrame = previousCancelRaf
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
}

test('taking ownership removes a mounted placement draft before the read-only lease', async () => {
  let draft!: DraftNodeHandle
  function Placement() {
    draft = useDraftNode()
    return null
  }
  await withMountedHook(<Placement />, () => {
    useScene.temporal.getState().pause()
    const transient = draft.create(new Vector3(1, 0, 2), asset)!
    expect(useScene.getState().nodes[transient.id]).toBeDefined()
    const release = acquireEditorInteractionLock()
    try {
      expect(useScene.getState().readOnly).toBe(true)
      expect(useScene.getState().nodes[transient.id]).toBeUndefined()
      expect((useScene.getState().nodes[level.id] as LevelNode).children).not.toContain(
        transient.id,
      )
      expect(draft.current).toBeNull()
      expect(usePlacementPreview.getState().node).toBeNull()
      draft.destroy()
      expect(useScene.getState().nodes[transient.id]).toBeUndefined()
    } finally {
      release()
    }
  })
})

test('taking ownership restores an adopted item before locking and discards the pending move', async () => {
  let draft!: DraftNodeHandle
  function Placement() {
    draft = useDraftNode()
    return null
  }
  await withMountedHook(<Placement />, () => {
    const item = ItemNode.parse({ asset, parentId: level.id, position: [1, 0, 2] })
    useScene.getState().createNode(item, level.id)
    useScene.temporal.getState().pause()
    draft.adopt(item)
    draft.updateSurface({ position: [4, 0, 5], rotation: [0, 1, 0] }, null)
    expect(useScene.getState().nodes[item.id]).toMatchObject({ position: [4, 0, 5] })
    const release = acquireEditorInteractionLock()
    try {
      expect(useScene.getState().readOnly).toBe(true)
      expect(useScene.getState().nodes[item.id]).toMatchObject({
        position: [1, 0, 2],
        rotation: [0, 0, 0],
        metadata: item.metadata,
      })
      expect(draft.current).toBeNull()
    } finally {
      release()
    }
    expect(draft.commit({ position: [9, 0, 9] })).toBeNull()
    expect(useScene.getState().nodes[item.id]).toMatchObject({ position: [1, 0, 2] })
  })
})

test('taking ownership cancels a registered drag before locking and ignores later move and commit events', async () => {
  let cancellations = 0
  let commits = 0
  const action: DragAction<{ levelId: string }, string> = {
    begin: () => ({ levelId: level.id }),
    preview: () => 'During drag',
    apply: (name, _context, scene) => {
      scene.update(level.id, { name })
      return [level.id]
    },
    cancel: () => {
      cancellations++
    },
    commit: () => {
      commits++
      return true
    },
  }
  function Drag() {
    useDragAction({
      active: true,
      action,
      initial: { node: level, point: [0, 0] },
      activationGraceMs: 0,
    })
    return null
  }
  await withMountedHook(<Drag />, () => {
    const event = { localPosition: [1, 0, 2] } as GridEvent
    emitter.emit('grid:move', event)
    expect(useScene.getState().nodes[level.id]?.name).toBe('During drag')
    const release = acquireEditorInteractionLock()
    try {
      expect(useScene.getState().readOnly).toBe(true)
      expect(useScene.getState().nodes[level.id]?.name).toBe('Original')
      expect(cancellations).toBe(1)
      emitter.emit('grid:move', event)
      emitter.emit('grid:click', event)
      expect(commits).toBe(0)
    } finally {
      release()
    }
    emitter.emit('grid:move', event)
    emitter.emit('grid:click', event)
    expect(useScene.getState().nodes[level.id]?.name).toBe('Original')
    expect(cancellations).toBe(1)
    expect(commits).toBe(0)
  })
})
