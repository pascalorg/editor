import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  acquireSceneReadOnlyLease,
  clearSceneHistory,
  emitter,
  LevelNode,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useDeleteConfirmation from '../store/use-delete-confirmation'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { acquireEditorInteractionLock } from './editor-interaction-lock'
import {
  getHistoryCommandState,
  installHistoryCommandDelegate,
  runRedo,
  runUndo,
  subscribeHistoryCommandState,
} from './history'

const originalRequestFrame = globalThis.requestAnimationFrame
const originalCancelFrame = globalThis.cancelAnimationFrame
const originalScene = useScene.getState()
const originalEditor = useEditor.getState()
const originalViewer = useViewer.getState()
const level = LevelNode.parse({ id: 'level_interaction_lock', name: 'Original' })
const cleanup: (() => void)[] = []

beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  useScene.setState({ nodes: { [level.id]: level }, rootNodeIds: [level.id], readOnly: false })
  clearSceneHistory()
})

afterEach(() => {
  for (const release of cleanup.splice(0).reverse()) release()
  useInteractionScope.getState().end()
  useDeleteConfirmation.getState().cancel()
  useLiveTransforms.getState().clearAll()
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(originalScene, true)
  useEditor.setState(originalEditor, true)
  useViewer.setState(originalViewer, true)
  clearSceneHistory()
  globalThis.requestAnimationFrame = originalRequestFrame
  globalThis.cancelAnimationFrame = originalCancelFrame
})

describe('editor interaction ownership', () => {
  test('cancels an active edit before locking, clears transient input, and resumes writing on release', () => {
    useScene.getState().updateNode(level.id, { name: 'During drag' })
    useEditor.getState().setMode('material-paint')
    useViewer.getState().setInputDragging(true)
    useLiveTransforms.getState().set(level.id, { position: [1, 0, 0], rotation: 0 })
    useLiveNodeOverrides.getState().set(level.id, { name: 'Preview' })
    useDeleteConfirmation.getState().requestConfirmation({ count: 1, onConfirm: () => {} })
    let cancelled = 0
    const cancel = () => {
      cancelled++
      useScene.getState().updateNode(level.id, { name: 'Original' })
    }
    emitter.on('tool:cancel', cancel)
    cleanup.push(() => emitter.off('tool:cancel', cancel))

    const release = acquireEditorInteractionLock()
    cleanup.push(release)
    expect(cancelled).toBe(1)
    expect(useScene.getState().nodes[level.id]?.name).toBe('Original')
    expect(useScene.getState().readOnly).toBe(true)
    expect(useEditor.getState().mode).toBe('select')
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(useDeleteConfirmation.getState().request).toBeNull()
    expect(useLiveTransforms.getState().transforms.size).toBe(0)
    expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)

    useScene.getState().updateNode(level.id, { name: 'Blocked edit' })
    expect(useScene.getState().nodes[level.id]?.name).toBe('Original')
    useViewer.getState().setCameraMode('orthographic')
    expect(useViewer.getState().cameraMode).toBe('orthographic')
    release()
    useScene.getState().updateNode(level.id, { name: 'Human edit' })
    expect(useScene.getState().nodes[level.id]?.name).toBe('Human edit')
  })

  test('does not release another owner’s read-only lease', () => {
    const releasePreview = acquireSceneReadOnlyLease()
    cleanup.push(releasePreview)
    const releaseActivity = acquireEditorInteractionLock()
    cleanup.push(releaseActivity)
    releaseActivity()
    releaseActivity()
    expect(useScene.getState().readOnly).toBe(true)
    releasePreview()
    expect(useScene.getState().readOnly).toBe(false)
  })

  test('accepts a host scene snapshot while local editing remains locked', () => {
    cleanup.push(acquireEditorInteractionLock())
    const remoteLevel = { ...level, name: 'Remote snapshot' }
    useScene.getState().setScene({ [level.id]: remoteLevel }, [level.id])
    expect(useScene.getState().nodes[level.id]?.name).toBe('Remote snapshot')
    expect(useScene.getState().readOnly).toBe(true)
    useScene.getState().deleteNode(level.id)
    expect(useScene.getState().nodes[level.id]?.name).toBe('Remote snapshot')
  })

  test('blocks undo and redo without consuming history and updates availability when released', () => {
    useScene.getState().updateNode(level.id, { name: 'Completed edit' })
    const observations: boolean[] = []
    cleanup.push(
      subscribeHistoryCommandState(() => observations.push(getHistoryCommandState().canUndo)),
    )
    const release = acquireSceneReadOnlyLease()
    cleanup.push(release)
    expect(getHistoryCommandState().canUndo).toBe(false)
    expect(getHistoryCommandState().status).toBe('unavailable')
    expect(runUndo()).toEqual({ kind: 'unavailable' })
    expect(useScene.getState().nodes[level.id]?.name).toBe('Completed edit')
    release()
    expect(observations).toEqual([false, true])
    expect(runUndo().kind).toBe('applied')
    expect(useScene.getState().nodes[level.id]?.name).toBe('Original')
    const releaseAgain = acquireSceneReadOnlyLease()
    cleanup.push(releaseAgain)
    expect(getHistoryCommandState().canRedo).toBe(false)
    expect(runRedo()).toEqual({ kind: 'unavailable' })
    expect(useScene.getState().nodes[level.id]?.name).toBe('Original')
    releaseAgain()
    expect(runRedo().kind).toBe('applied')
    expect(useScene.getState().nodes[level.id]?.name).toBe('Completed edit')
  })

  test('blocks delegated history before invoking a remote writer', () => {
    let calls = 0
    cleanup.push(
      installHistoryCommandDelegate({
        getState: () => ({ canRedo: true, canUndo: true, mode: 'collaborative', status: 'ready' }),
        subscribe: () => () => {},
        undo: () => {
          calls++
          return { kind: 'applied', persistence: 'queued' }
        },
        redo: () => {
          calls++
          return { kind: 'applied', persistence: 'queued' }
        },
      }),
    )
    cleanup.push(acquireSceneReadOnlyLease())
    expect(runUndo()).toEqual({ kind: 'unavailable' })
    expect(runRedo()).toEqual({ kind: 'unavailable' })
    expect(calls).toBe(0)
    expect(getHistoryCommandState()).toEqual({
      canRedo: false,
      canUndo: false,
      mode: 'collaborative',
      status: 'unavailable',
    })
  })
})
