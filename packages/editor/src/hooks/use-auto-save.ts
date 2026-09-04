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

export type ExitFlushDecision = 'skip-clean' | 'skip-loading' | 'blocked-suspicious' | 'flush'

/**
 * Decides what the unload/unmount flush may do with the store's current
 * content. Pure so the wipe scenarios stay unit-testable.
 *
 * `skip-loading` is the load-bearing branch: while a scene load is in flight
 * the store passes through an intermediate `unloadScene()` state — zero nodes,
 * zero roots — that is NOT user data. A flush fired in that window (StrictMode
 * simulated unmount in dev, a quick tab close or navigation in prod) used to
 * serialize that empty store and PUT it over the server copy, wiping the scene
 * at v2. The dirty flag alone cannot protect here: document-level writes that
 * land before hydration (e.g. the host-panel default `installedPlugins` sync)
 * mark the session dirty without any user edit.
 */
export function decideExitFlush(opts: {
  isLoadingScene: boolean
  hasDirtyChanges: boolean
  storedNodeCount: number
  currentNodeCount: number
}): ExitFlushDecision {
  if (!opts.hasDirtyChanges) return 'skip-clean'
  if (opts.isLoadingScene) return 'skip-loading'
  if (isSuspiciousNodeDrop(opts.storedNodeCount, opts.currentNodeCount)) {
    return 'blocked-suspicious'
  }
  return 'flush'
}

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'paused' | 'error'

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
  // Starts TRUE: the scene is "loading" from mount until the Editor's load
  // effect completes its first hydration. The Editor's load effect runs
  // several hooks AFTER this one (hook order), so store writes in that gap —
  // e.g. `useHostPanels` syncing default `installedPlugins` on mount — must
  // not mark the session dirty or arm a save: the store still holds the empty
  // pre-hydration state, and flushing it wipes the scene server-side.
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
    let lastNodesRef = useScene.getState().nodes
    let lastRootNodeIdsRef = useScene.getState().rootNodeIds
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
        lastNodesRef = state.nodes
        lastRootNodeIdsRef = state.rootNodeIds
        storedNodeCount.trackLoadedGraph(Object.keys(state.nodes).length)
        lastCollectionsRef = state.collections
        lastMaterialsRef = state.materials
        lastInstalledPluginsRef = state.installedPlugins
        return
      }

      if (isVersionPreviewModeRef.current) {
        setSaveStatus('paused')
        lastNodesRef = state.nodes
        lastRootNodeIdsRef = state.rootNodeIds
        lastCollectionsRef = state.collections
        lastMaterialsRef = state.materials
        lastInstalledPluginsRef = state.installedPlugins
        return
      }

      // $O(1) dirty checking across all persisted scene graph slices
      const changed =
        state.nodes !== lastNodesRef ||
        state.rootNodeIds !== lastRootNodeIdsRef ||
        state.collections !== lastCollectionsRef ||
        state.materials !== lastMaterialsRef ||
        state.installedPlugins !== lastInstalledPluginsRef
      if (!changed) return

      lastNodesRef = state.nodes
      lastRootNodeIdsRef = state.rootNodeIds
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
      const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
      const currentNodeCount = Object.keys(nodes).length
      const previousNodeCount = storedNodeCount.count
      const decision = decideExitFlush({
        isLoadingScene: isLoadingSceneRef.current,
        hasDirtyChanges: hasDirtyChangesRef.current,
        storedNodeCount: previousNodeCount,
        currentNodeCount,
      })
      if (decision === 'skip-clean') return
      if (decision === 'skip-loading') {
        console.warn(
          '[autosave] Skipped unload flush: a scene load is in flight, the store content is transient. Nothing user-authored is lost.',
        )
        return
      }
      if (decision === 'blocked-suspicious') {
        console.warn(
          `[autosave] Blocked unload flush: scene dropped from ${previousNodeCount} to ${currentNodeCount} nodes. Likely accidental deletion.`,
        )
        setSaveStatus('error')
        return
      }
      // 'flush' — adopt the write as the new stored baseline.
      storedNodeCount.allowWrite(currentNodeCount)

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
