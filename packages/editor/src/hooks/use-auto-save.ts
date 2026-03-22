'use client'

import { useScene } from '@vesper/core'
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'
import { type SceneGraph, saveSceneToLocalStorage } from '../lib/scene'

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
}: UseAutoSaveOptions): { saveStatus: SaveStatus; isLoadingSceneRef: MutableRefObject<boolean> } {
  const [saveStatus, _setSaveStatus] = useState<SaveStatus>('idle')

  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const isSavingRef = useRef(false)
  const isLoadingSceneRef = useRef(false)
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
    _setSaveStatus(status)
    onSaveStatusChangeRef.current?.(status)
  }, [])

  // Stable subscription to scene changes
  useEffect(() => {
    let lastNodesSnapshot = JSON.stringify(useScene.getState().nodes)

    async function executeSave() {
      if (isLoadingSceneRef.current || isVersionPreviewModeRef.current) {
        pendingSaveRef.current = true
        setSaveStatus('paused')
        return
      }

      const { nodes, rootNodeIds } = useScene.getState()
      const sceneGraph = { nodes, rootNodeIds } as SceneGraph

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

    const unsubscribe = useScene.subscribe((state) => {
      if (isLoadingSceneRef.current) {
        lastNodesSnapshot = JSON.stringify(state.nodes)
        return
      }

      if (isVersionPreviewModeRef.current) {
        setSaveStatus('paused')
        lastNodesSnapshot = JSON.stringify(state.nodes)
        return
      }

      const currentNodesSnapshot = JSON.stringify(state.nodes)
      if (currentNodesSnapshot === lastNodesSnapshot) return

      lastNodesSnapshot = currentNodesSnapshot
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
    })

    function flushOnExit() {
      if (!hasDirtyChangesRef.current) return
      const { nodes, rootNodeIds } = useScene.getState()
      const sceneGraph = { nodes, rootNodeIds } as SceneGraph
      if (onSaveRef.current) {
        onSaveRef.current(sceneGraph).catch(() => {})
      } else {
        saveSceneToLocalStorage(sceneGraph)
      }
      hasDirtyChangesRef.current = false
    }

    window.addEventListener('beforeunload', flushOnExit)

    return () => {
      executeSaveRef.current = null
      window.removeEventListener('beforeunload', flushOnExit)
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      flushOnExit()
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

  return { saveStatus, isLoadingSceneRef }
}
