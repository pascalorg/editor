'use client'

import { useScene } from '@pascal-app/core'
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react'
import { type SceneGraph, saveSceneToLocalStorage } from '../lib/scene'

/**
 * How long a change waits before it is written, once nothing is happening.
 *
 * It used to be a flat second, which meant a drag wrote once a second for its
 * whole length and every one of those writes was thrown away by the next. The
 * pacing is now driven by what the user is doing rather than by a clock:
 * nothing is written while a pointer is down, the gesture's end writes at once,
 * and an idle session settles at this interval.
 */
const IDLE_DEBOUNCE_MS = 5000
/** A finished gesture is the result the user is waiting on; do not sit on it. */
const GESTURE_END_DEBOUNCE_MS = 0
const STRUCTURAL_NODE_COUNT = 4

export function isSuspiciousNodeDrop(previousNodeCount: number, currentNodeCount: number) {
  return previousNodeCount > STRUCTURAL_NODE_COUNT && currentNodeCount <= STRUCTURAL_NODE_COUNT
}

/**
 * A node-less graph is never a document. `unloadScene()` produces one as a
 * transient state between scenes, and `clearScene()` immediately replaces it
 * with a site + building + level scaffold — so nothing the user can reach ever
 * has zero nodes.
 *
 * The drop guard cannot catch this on its own: its baseline is seeded from the
 * store at mount, which is empty during a load, so a 0 → 0 write reads as no
 * drop at all. This is the floor underneath it.
 */
export function isEmptyGraphWrite(nodeCount: number, rootNodeCount: number) {
  return nodeCount === 0 || rootNodeCount === 0
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

/** What just happened, as far as pacing is concerned. */
export type SavePacingEvent = 'change' | 'gesture-end' | 'became-visible'

export interface SavePacingState {
  /** A gesture is in progress. */
  pointerDown: boolean
  /** The tab is in the background. */
  hidden: boolean
}

/**
 * How long a write waits, or `null` for "not now".
 *
 * The two `null` cases are the point of the whole thing. Mid-gesture, every
 * write is superseded by the next one a frame later, so a drag used to spend
 * its whole length writing results nobody would ever read. Backgrounded, a tab
 * that keeps its timer alive is still writing to the database for a user who
 * left. Both are re-armed by the event that ends them — `gesture-end` and
 * `became-visible` — which is why neither can strand a change.
 */
export function saveDelayFor(
  event: SavePacingEvent,
  state: SavePacingState,
  idleMs: number,
): number | null {
  if (state.pointerDown || state.hidden) return null
  return event === 'change' ? idleMs : GESTURE_END_DEBOUNCE_MS
}

/**
 * Whether a tab on its way to the background should write before going quiet.
 *
 * It should: the alternative is a pending change sitting in a tab that may
 * never be looked at again, and `pagehide` is not guaranteed to arrive on
 * every platform that backgrounds one.
 */
export function shouldFlushBeforeHiding(isDirty: boolean, isSaving: boolean): boolean {
  return isDirty && !isSaving
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
    onSaveStatusChangeRef.current?.(status)
  }, [])

  // Stable subscription to scene changes
  useEffect(() => {
    // Reference, not `JSON.stringify`. This runs on *every* store update, and
    // serialising the whole node map there put a full pass over the scene on
    // the main thread between frames — the bigger the model, the worse the
    // drag. Zustand hands out a new `nodes` object exactly when something wrote
    // to it, so the pointer answers the same question for free. It is slightly
    // more eager: a write that stores an identical value now counts as a
    // change. The debounce is what absorbs that, and a save with nothing in it
    // is caught by the delta being empty.
    let lastNodesRef = useScene.getState().nodes
    const storedNodeCount = createStoredNodeCountTracker(
      Object.keys(useScene.getState().nodes).length,
    )
    // Collections + component definitions + scene materials are document-level state that persists with
    // the graph but lives outside `nodes`. Track them by reference (zustand
    // hands out a new object on every mutation) so a material edit or a
    // collection change still triggers a save.
    let lastCollectionsRef = useScene.getState().collections
    let lastSavedViewsRef = useScene.getState().savedViews
    // Comments are the one tracked bag that is *not* in the undo history, so
    // reference tracking here is the only thing that gets a new thread saved.
    let lastCommentsRef = useScene.getState().comments
    let lastDefinitionsRef = useScene.getState().definitions
    let lastMaterialsRef = useScene.getState().materials
    let lastInstalledPluginsRef = useScene.getState().installedPlugins

    async function executeSave() {
      if (isLoadingSceneRef.current || isVersionPreviewModeRef.current) {
        pendingSaveRef.current = true
        setSaveStatus('paused')
        return
      }

      const {
        nodes,
        rootNodeIds,
        collections,
        savedViews,
        comments,
        definitions,
        materials,
        installedPlugins,
      } = useScene.getState()
      const sceneGraph = {
        nodes,
        rootNodeIds,
        collections,
        savedViews,
        comments,
        definitions,
        materials,
        installedPlugins,
      } as SceneGraph

      const currentNodeCount = Object.keys(nodes).length
      if (isEmptyGraphWrite(currentNodeCount, rootNodeIds.length)) {
        console.warn('[autosave] Blocked: refusing to save an empty scene.')
        return
      }
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
          scheduleSave('change')
        }
      }
    }

    executeSaveRef.current = executeSave

    /**
     * A pointer being down is the one signal every gesture shares. Drafting
     * tools do not open an `InteractionScope` and each drag publishes to its
     * own live store, so there is no editor-level "a gesture is running" flag
     * to read — but there is no gesture without a pointer, and this needs no
     * tool to remember to announce itself.
     */
    let pointerIsDown = false

    function scheduleSave(event: SavePacingEvent) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = undefined
      const delay = saveDelayFor(
        event,
        {
          pointerDown: pointerIsDown,
          hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
        },
        IDLE_DEBOUNCE_MS,
      )
      if (delay === null) return
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = undefined
        executeSave()
      }, delay)
    }

    function handlePointerDown() {
      pointerIsDown = true
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = undefined
      }
    }

    function handlePointerUp() {
      if (!pointerIsDown) return
      pointerIsDown = false
      if (hasDirtyChangesRef.current) scheduleSave('gesture-end')
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        if (shouldFlushBeforeHiding(hasDirtyChangesRef.current, isSavingRef.current)) {
          void executeSave()
        }
        return
      }
      if (hasDirtyChangesRef.current) scheduleSave('became-visible')
    }

    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('pointerup', handlePointerUp, { capture: true })
    window.addEventListener('pointercancel', handlePointerUp, { capture: true })
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const unsubscribe = useScene.subscribe((state) => {
      if (isLoadingSceneRef.current) {
        lastNodesRef = state.nodes
        storedNodeCount.trackLoadedGraph(Object.keys(state.nodes).length)
        lastCollectionsRef = state.collections
        lastSavedViewsRef = state.savedViews
        lastCommentsRef = state.comments
        lastDefinitionsRef = state.definitions
        lastMaterialsRef = state.materials
        lastInstalledPluginsRef = state.installedPlugins
        return
      }

      if (isVersionPreviewModeRef.current) {
        setSaveStatus('paused')
        lastNodesRef = state.nodes
        lastCollectionsRef = state.collections
        lastSavedViewsRef = state.savedViews
        lastCommentsRef = state.comments
        lastDefinitionsRef = state.definitions
        lastMaterialsRef = state.materials
        lastInstalledPluginsRef = state.installedPlugins
        return
      }

      const changed =
        state.nodes !== lastNodesRef ||
        state.collections !== lastCollectionsRef ||
        state.savedViews !== lastSavedViewsRef ||
        state.comments !== lastCommentsRef ||
        state.definitions !== lastDefinitionsRef ||
        state.materials !== lastMaterialsRef ||
        state.installedPlugins !== lastInstalledPluginsRef
      if (!changed) return

      lastNodesRef = state.nodes
      lastCollectionsRef = state.collections
      lastSavedViewsRef = state.savedViews
      lastCommentsRef = state.comments
      lastDefinitionsRef = state.definitions
      lastMaterialsRef = state.materials
      lastInstalledPluginsRef = state.installedPlugins
      hasDirtyChangesRef.current = true
      onDirtyRef.current?.()
      setSaveStatus('pending')

      if (isSavingRef.current) {
        pendingSaveRef.current = true
        return
      }

      scheduleSave('change')
    })

    // Flush any unsaved change while the page is going away. The network
    // save MUST set `keepalive` — a normal fetch is cancelled by the browser
    // the moment the page unloads, so a quick refresh right after an edit
    // would otherwise drop the change entirely. `pagehide` fires in cases
    // (mobile Safari, bfcache) where `beforeunload` does not.
    function flushOnExit() {
      if (!hasDirtyChangesRef.current) return
      // The same gate `executeSave` applies, and the reason this function needs
      // it: the effect cleanup below calls `flushOnExit` too, so it fires on
      // every re-run of the effect — which in dev means React StrictMode's
      // mount → cleanup → mount, landing squarely inside the scene load. At
      // that moment the store sits between `unloadScene()` and the loaded
      // graph, and flushing it wrote an empty scene over the stored one. The
      // drop guard did not stop it: its baseline was seeded at mount, when the
      // store was already empty, so 0 → 0 read as no drop.
      if (isLoadingSceneRef.current || isVersionPreviewModeRef.current) return
      const {
        nodes,
        rootNodeIds,
        collections,
        savedViews,
        comments,
        definitions,
        materials,
        installedPlugins,
      } = useScene.getState()
      const currentNodeCount = Object.keys(nodes).length
      if (isEmptyGraphWrite(currentNodeCount, rootNodeIds.length)) {
        console.warn('[autosave] Blocked unload flush: refusing to save an empty scene.')
        return
      }
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
        savedViews,
        comments,
        definitions,
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
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('pointerup', handlePointerUp, { capture: true })
      window.removeEventListener('pointercancel', handlePointerUp, { capture: true })
      document.removeEventListener('visibilitychange', handleVisibilityChange)
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
        }, IDLE_DEBOUNCE_MS)
      }
      return
    }

    setSaveStatus('saved')
  }, [isVersionPreviewMode, setSaveStatus])

  return { isLoadingSceneRef }
}
