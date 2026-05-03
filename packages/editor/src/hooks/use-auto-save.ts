'use client'

import { useScene } from '@pascal-app/core'
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react'
import { SCENE_IMMEDIATE_SAVE_EVENT, type SceneGraph, saveSceneToLocalStorage } from '../lib/scene'

const AUTOSAVE_DEBOUNCE_MS = 1000

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'paused' | 'error'

interface UseAutoSaveOptions {
  onSave?: (scene: SceneGraph) => Promise<void>
  onDirty?: () => void
  onSaveStatusChange?: (status: SaveStatus) => void
  isVersionPreviewMode?: boolean
}

/**
 * Generic autosave hook. Subscribes to the scene store and debounces saves.
 * Falls back to localStorage when no `onSave` is provided.
 *
 * ⚠️  Mount in exactly ONE component (the Editor).
 */
export function useAutoSave({
  onSave,
  onDirty,
  onSaveStatusChange,
  isVersionPreviewMode = false,
}: UseAutoSaveOptions): { isLoadingSceneRef: MutableRefObject<boolean> } {
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const isSavingRef = useRef(false)
  const isLoadingSceneRef = useRef(true)
  const pendingSaveRef = useRef(false)
  const executeSaveRef = useRef<(() => Promise<void>) | null>(null)
  const hasDirtyChangesRef = useRef(false)

  // Keep latest callback/value refs so the stable subscription always uses current values
  const onSaveRef = useRef(onSave)
  const onDirtyRef = useRef(onDirty)
  const onSaveStatusChangeRef = useRef(onSaveStatusChange)
  const isVersionPreviewModeRef = useRef(isVersionPreviewMode)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])
  useEffect(() => {
    onDirtyRef.current = onDirty
  }, [onDirty])
  useEffect(() => {
    onSaveStatusChangeRef.current = onSaveStatusChange
  }, [onSaveStatusChange])
  useEffect(() => {
    isVersionPreviewModeRef.current = isVersionPreviewMode
  }, [isVersionPreviewMode])

  const setSaveStatus = useCallback((status: SaveStatus) => {
    onSaveStatusChangeRef.current?.(status)
  }, [])

  // Stable subscription to scene changes
  useEffect(() => {
    let lastSceneSnapshot = JSON.stringify({
      collections: useScene.getState().collections,
      nodes: useScene.getState().nodes,
    })

    function updateSnapshot(snapshot: {
      collections: SceneGraph['collections']
      nodes: SceneGraph['nodes']
    }) {
      const currentSceneSnapshot = JSON.stringify(snapshot)
      if (currentSceneSnapshot === lastSceneSnapshot) {
        return false
      }

      lastSceneSnapshot = currentSceneSnapshot
      return true
    }

    function scheduleSaveIfNeeded(snapshot: {
      collections: SceneGraph['collections']
      nodes: SceneGraph['nodes']
    }) {
      if (!updateSnapshot(snapshot)) {
        return
      }

      hasDirtyChangesRef.current = true
      onDirtyRef.current?.()
      setSaveStatus('pending')

      if (isSavingRef.current) {
        pendingSaveRef.current = true
        return
      }

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)

      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = undefined
        executeSave()
      }, AUTOSAVE_DEBOUNCE_MS)
    }

    function readSceneGraphFromEvent(event: Event): SceneGraph | null {
      if (!(event instanceof CustomEvent)) {
        return null
      }
      const scene = event.detail as Partial<SceneGraph> | null | undefined
      return scene?.nodes && scene.rootNodeIds ? (scene as SceneGraph) : null
    }

    async function executeSave(sceneOverride?: SceneGraph) {
      if (isLoadingSceneRef.current) {
        setSaveStatus('paused')
        return
      }

      if (isVersionPreviewModeRef.current) {
        pendingSaveRef.current = true
        setSaveStatus('paused')
        return
      }

      const sceneGraph =
        sceneOverride ??
        ({
          collections: useScene.getState().collections,
          nodes: useScene.getState().nodes,
          rootNodeIds: useScene.getState().rootNodeIds,
        } as SceneGraph)

      isSavingRef.current = true
      pendingSaveRef.current = false
      setSaveStatus('saving')

      try {
        if (onSaveRef.current) {
          await onSaveRef.current(sceneGraph)
        } else {
          saveSceneToLocalStorage(sceneGraph)
        }
        hasDirtyChangesRef.current = false
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
      } finally {
        isSavingRef.current = false

        if (pendingSaveRef.current) {
          pendingSaveRef.current = false
          setSaveStatus('pending')
          saveTimeoutRef.current = setTimeout(() => {
            saveTimeoutRef.current = undefined
            executeSave()
          }, AUTOSAVE_DEBOUNCE_MS)
        }
      }
    }

    executeSaveRef.current = executeSave

    function flushImmediately(event: Event) {
      const sceneOverride = readSceneGraphFromEvent(event) ?? undefined
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = undefined
      }
      if (isSavingRef.current) {
        pendingSaveRef.current = true
        return
      }
      void executeSave(sceneOverride)
    }

    const unsubscribe = useScene.subscribe((state) => {
      if (isLoadingSceneRef.current) {
        updateSnapshot({
          collections: state.collections,
          nodes: state.nodes,
        })
        return
      }

      if (isVersionPreviewModeRef.current) {
        setSaveStatus('paused')
        updateSnapshot({
          collections: state.collections,
          nodes: state.nodes,
        })
        return
      }

      scheduleSaveIfNeeded({
        collections: state.collections,
        nodes: state.nodes,
      })
    })

    function flushOnExit() {
      if (isLoadingSceneRef.current || isVersionPreviewModeRef.current) {
        return
      }
      if (!hasDirtyChangesRef.current) return
      const { collections, nodes, rootNodeIds } = useScene.getState()
      const sceneGraph = { collections, nodes, rootNodeIds } as SceneGraph
      if (onSaveRef.current) {
        onSaveRef.current(sceneGraph).catch(() => {})
      } else {
        saveSceneToLocalStorage(sceneGraph)
      }
      hasDirtyChangesRef.current = false
    }

    window.addEventListener('beforeunload', flushOnExit)
    window.addEventListener(SCENE_IMMEDIATE_SAVE_EVENT, flushImmediately)

    return () => {
      executeSaveRef.current = null
      window.removeEventListener('beforeunload', flushOnExit)
      window.removeEventListener(SCENE_IMMEDIATE_SAVE_EVENT, flushImmediately)
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      unsubscribe()
    }
  }, [setSaveStatus])

  // Handle version preview mode transitions
  useEffect(() => {
    if (isVersionPreviewMode) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = undefined
      }
      if (hasDirtyChangesRef.current) {
        pendingSaveRef.current = true
      }
      setSaveStatus('paused')
      return
    }

    if (isSavingRef.current) return

    if (hasDirtyChangesRef.current) {
      setSaveStatus('pending')
      if (!saveTimeoutRef.current) {
        saveTimeoutRef.current = setTimeout(() => {
          saveTimeoutRef.current = undefined
          executeSaveRef.current?.()
        }, AUTOSAVE_DEBOUNCE_MS)
      }
      return
    }

    setSaveStatus('saved')
  }, [isVersionPreviewMode, setSaveStatus])

  return { isLoadingSceneRef }
}
