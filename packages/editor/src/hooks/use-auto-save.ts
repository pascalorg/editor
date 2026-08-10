'use client'

import { useScene } from '@pascal-app/core'
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react'
import { type SceneGraph, saveSceneToLocalStorage } from '../lib/scene'

const AUTOSAVE_DEBOUNCE_MS = 1000
const STRUCTURAL_NODE_COUNT = 4

export function isSuspiciousNodeDrop(previousNodeCount: number, currentNodeCount: number) {
  return previousNodeCount > STRUCTURAL_NODE_COUNT && currentNodeCount <= STRUCTURAL_NODE_COUNT
}

/**
 * Tracks the node count of the graph we believe is stored, which is what the
 * accidental-wipe guard measures every write against.
 *
 * The distinction that matters: a graph that came from storage is authoritative
 * and has to become the new baseline, while an edited or previewed graph must
 * not. Seeding the baseline once at mount is not enough — the hook mounts
 * before the scene has loaded, so it would sit at ~0 for the whole session and
 * `isSuspiciousNodeDrop` could never fire.
 */
export function createStoredNodeCountTracker(initialNodeCount: number) {
  let count = initialNodeCount

  return {
    get count() {
      return count
    },
    /** A graph read from storage — it defines what "populated" means from here. */
    trackLoadedGraph(nodeCount: number) {
      count = nodeCount
    },
    /**
     * `false` when the write would drop a populated scene to a bare scaffold,
     * which is an accidental full deletion far more often than an intent. The
     * caller reports the block; on `true` the write becomes the new baseline.
     */
    allowWrite(nodeCount: number) {
      if (isSuspiciousNodeDrop(count, nodeCount)) return false
      count = nodeCount
      return true
    },
  }
}

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'paused' | 'error'

export function shouldFlushOnExit({
  hasDirtyChanges,
  isLoadingScene,
  isVersionPreviewMode,
}: {
  hasDirtyChanges: boolean
  isLoadingScene: boolean
  isVersionPreviewMode: boolean
}) {
  return hasDirtyChanges && !isLoadingScene && !isVersionPreviewMode
}

interface UseAutoSaveOptions {
  onSave?: (scene: SceneGraph, options?: { keepalive?: boolean }) => Promise<void>
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
    let lastNodesSnapshot = JSON.stringify(useScene.getState().nodes)
    const storedNodeCount = createStoredNodeCountTracker(
      Object.keys(useScene.getState().nodes).length,
    )
    // Collections + scene materials are document-level state that persists with
    // the graph but lives outside `nodes`. Track them by reference (zustand
    // hands out a new object on every mutation) so a material edit or a
    // collection change still triggers a save.
    let lastCollectionsRef = useScene.getState().collections
    let lastMaterialsRef = useScene.getState().materials
    let lastInstalledPluginsRef = useScene.getState().installedPlugins

    async function executeSave() {
      if (isLoadingSceneRef.current || isVersionPreviewModeRef.current) {
        pendingSaveRef.current = true
        setSaveStatus('paused')
        return
      }

      const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
      const sceneGraph = {
        nodes,
        rootNodeIds,
        collections,
        materials,
        installedPlugins,
      } as SceneGraph

      const currentNodeCount = Object.keys(nodes).length
      const previousNodeCount = storedNodeCount.count
      if (!storedNodeCount.allowWrite(currentNodeCount)) {
        console.warn(
          `[autosave] Blocked: scene dropped from ${previousNodeCount} to ${currentNodeCount} nodes. Likely accidental deletion.`,
        )
        setSaveStatus('error')
        return
      }

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
        storedNodeCount.trackLoadedGraph(Object.keys(state.nodes).length)
        lastCollectionsRef = state.collections
        lastMaterialsRef = state.materials
        lastInstalledPluginsRef = state.installedPlugins
        return
      }

      if (isVersionPreviewModeRef.current) {
        setSaveStatus('paused')
        lastNodesSnapshot = JSON.stringify(state.nodes)
        lastCollectionsRef = state.collections
        lastMaterialsRef = state.materials
        lastInstalledPluginsRef = state.installedPlugins
        return
      }

      const currentNodesSnapshot = JSON.stringify(state.nodes)
      const changed =
        currentNodesSnapshot !== lastNodesSnapshot ||
        state.collections !== lastCollectionsRef ||
        state.materials !== lastMaterialsRef ||
        state.installedPlugins !== lastInstalledPluginsRef
      if (!changed) return

      lastNodesSnapshot = currentNodesSnapshot
      lastCollectionsRef = state.collections
      lastMaterialsRef = state.materials
      lastInstalledPluginsRef = state.installedPlugins
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

    // Flush any unsaved change while the page is going away. The network
    // save MUST set `keepalive` — a normal fetch is cancelled by the browser
    // the moment the page unloads, so a quick refresh right after an edit
    // would otherwise drop the change entirely. `pagehide` fires in cases
    // (mobile Safari, bfcache) where `beforeunload` does not.
    function flushOnExit() {
      if (
        !shouldFlushOnExit({
          hasDirtyChanges: hasDirtyChangesRef.current,
          isLoadingScene: isLoadingSceneRef.current,
          isVersionPreviewMode: isVersionPreviewModeRef.current,
        })
      ) {
        return
      }
      const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
      const currentNodeCount = Object.keys(nodes).length
      const previousNodeCount = storedNodeCount.count
      if (!storedNodeCount.allowWrite(currentNodeCount)) {
        console.warn(
          `[autosave] Blocked unload flush: scene dropped from ${previousNodeCount} to ${currentNodeCount} nodes. Likely accidental deletion.`,
        )
        setSaveStatus('error')
        return
      }

      hasDirtyChangesRef.current = false
      const sceneGraph = {
        nodes,
        rootNodeIds,
        collections,
        materials,
        installedPlugins,
      } as SceneGraph
      if (onSaveRef.current) {
        onSaveRef.current(sceneGraph, { keepalive: true }).catch(() => {})
      } else {
        saveSceneToLocalStorage(sceneGraph)
      }
    }

    window.addEventListener('beforeunload', flushOnExit)
    window.addEventListener('pagehide', flushOnExit)

    return () => {
      executeSaveRef.current = null
      window.removeEventListener('beforeunload', flushOnExit)
      window.removeEventListener('pagehide', flushOnExit)
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

  return { isLoadingSceneRef }
}
