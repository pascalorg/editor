/**
 * Hooks for project model (scene) loading and auto-saving
 */

'use client'

import { clearSceneHistory, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import useEditor from '@/store/use-editor'
import { useProjectStore } from '../projects/store'
import { getProjectModel, saveProjectModel, type SceneGraph } from './actions'

/** Debounce interval for cloud auto-save (ms). */
const AUTOSAVE_DEBOUNCE_MS = 1_000

function hasUsableSceneGraph(sceneGraph?: SceneGraph | null): sceneGraph is SceneGraph {
  return !!sceneGraph && Object.keys(sceneGraph.nodes ?? {}).length > 0 && (sceneGraph.rootNodeIds?.length ?? 0) > 0
}

function syncEditorSelectionFromCurrentScene() {
  const sceneNodes = useScene.getState().nodes as Record<string, any>
  const sceneRootIds = useScene.getState().rootNodeIds
  const siteNode = sceneRootIds[0] ? sceneNodes[sceneRootIds[0]] : null
  const resolve = (child: any) =>
    typeof child === 'string' ? sceneNodes[child] : child
  const firstBuilding = siteNode?.children?.map(resolve).find((n: any) => n?.type === 'building')
  const firstLevel = firstBuilding?.children?.map(resolve).find((n: any) => n?.type === 'level')

  if (firstBuilding && firstLevel) {
    useViewer.getState().setSelection({
      buildingId: firstBuilding.id,
      levelId: firstLevel.id,
      selectedIds: [],
      zoneId: null,
    })
    useEditor.getState().setPhase('structure')
    useEditor.getState().setStructureLayer('elements')

    // Auto-select the wall tool if the level is empty (e.g., brand new project)
    if (!firstLevel.children || firstLevel.children.length === 0) {
      useEditor.getState().setMode('build')
      useEditor.getState().setTool('wall')
    }
  } else {
    useEditor.getState().setPhase('site')
    useViewer.getState().setSelection({
      buildingId: null,
      levelId: null,
      selectedIds: [],
      zoneId: null,
    })
  }
}

function resetEditorInteractionState() {
  useViewer.getState().setHoveredId(null)
  useViewer.getState().resetSelection()
  // Clear outliner arrays synchronously so stale Object3D refs from the old
  // scene don't leak into the post-processing pipeline's outline passes.
  const outliner = useViewer.getState().outliner
  outliner.selectedObjects.length = 0
  outliner.hoveredObjects.length = 0
  sceneRegistry.clear()
  useEditor.setState({
    phase: 'site',
    mode: 'select',
    tool: null,
    structureLayer: 'elements',
    catalogCategory: null,
    selectedItem: null,
    movingNode: null,
    selectedReferenceId: null,
    spaces: {},
    editingHole: null,
    isPreviewMode: false,
  })
}

export function applySceneGraphToEditor(sceneGraph?: SceneGraph | null) {
  if (hasUsableSceneGraph(sceneGraph)) {
    const { nodes, rootNodeIds } = sceneGraph
    useScene.getState().setScene(nodes, rootNodeIds)
  } else {
    useScene.getState().clearScene()
  }

  syncEditorSelectionFromCurrentScene()
}

/**
 * Load the scene when a project becomes active.
 * Saves changes automatically with debouncing.
 *
 * ⚠️  This hook must be mounted in exactly ONE component (the Editor).
 *     Mounting it in multiple components causes duplicate save calls.
 */
export function useProjectScene(projectId?: string | null) {
  const isVersionPreviewMode = useProjectStore((state) => state.isVersionPreviewMode)
  const setAutosaveStatus = useProjectStore((state) => state.setAutosaveStatus)

  const loadRequestIdRef = useRef(0)
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const isSavingRef = useRef(false)
  const currentProjectIdRef = useRef<string | null>(null)
  // Track whether the scene was just loaded from the server so we can skip
  // the first store update (which is the load itself, not a user edit).
  const isLoadingSceneRef = useRef(false)
  // Track whether there are pending changes that arrived while a save was
  // in-flight so we can coalesce them into one follow-up save.
  const pendingSaveRef = useRef(false)
  const executeSaveRef = useRef<(() => Promise<void>) | null>(null)

  // Load scene when active project changes
  useEffect(() => {
    if (!projectId) {
      currentProjectIdRef.current = null
      isLoadingSceneRef.current = false
      useScene.temporal.getState().pause()
      clearSceneHistory()
      useScene.getState().unloadScene()
      useScene.temporal.getState().resume()
      resetEditorInteractionState()
      useProjectStore.getState().setIsVersionPreviewMode(false)
      useProjectStore.getState().setIsSceneLoading(false)
      setAutosaveStatus('idle')
      return
    }

    const requestId = ++loadRequestIdRef.current
    const targetProjectId = projectId
    let cancelled = false

    // Suppress auto-save for the store update caused by setScene/clearScene.
    isLoadingSceneRef.current = true
    currentProjectIdRef.current = projectId
    useProjectStore.getState().setIsVersionPreviewMode(false)
    useProjectStore.getState().setIsSceneLoading(true)
    setAutosaveStatus('idle')

    // Scene replacement is a project boundary, not an undoable edit.
    useScene.temporal.getState().pause()
    clearSceneHistory()
    useScene.getState().unloadScene()
    resetEditorInteractionState()

    async function loadScene() {
      try {
        const result = await getProjectModel(targetProjectId)

        if (cancelled || loadRequestIdRef.current !== requestId) return

        applySceneGraphToEditor(result.success ? result.data?.model?.scene_graph ?? null : null)
      } catch (error) {
        if (cancelled || loadRequestIdRef.current !== requestId) return

        // Fall back to an empty scene while preserving editor selection sync.
        applySceneGraphToEditor(null)
      } finally {
        if (cancelled || loadRequestIdRef.current !== requestId) return

        // Allow auto-save again after a tick so the new scene has fully propagated.
        requestAnimationFrame(() => {
          if (cancelled || loadRequestIdRef.current !== requestId) return

          clearSceneHistory()
          useScene.temporal.getState().resume()
          isLoadingSceneRef.current = false
          useProjectStore.getState().setIsSceneLoading(false)
          setAutosaveStatus('saved')
        })
      }
    }

    void loadScene()

    return () => {
      cancelled = true
    }
  }, [projectId, setAutosaveStatus])

  // Track whether there are unsaved changes (dirty flag for flush-on-exit).
  const hasDirtyChangesRef = useRef(false)

  // Auto-save scene changes with debouncing
  useEffect(() => {
    if (!projectId) {
      currentProjectIdRef.current = null
      executeSaveRef.current = null
      setAutosaveStatus('idle')
      return
    }

    currentProjectIdRef.current = projectId

    // Track the nodes object reference. Zustand creates a new reference on
    // every mutation so reference equality is a cheap way to detect changes
    // without expensive JSON serialization on every store update.
    let lastNodesRef = useScene.getState().nodes

    const unsubscribe = useScene.subscribe((state) => {
      // Skip saves triggered by loading a scene from the server
      if (isLoadingSceneRef.current) {
        lastNodesRef = state.nodes
        return
      }

      if (useProjectStore.getState().isVersionPreviewMode) {
        setAutosaveStatus('paused')
        lastNodesRef = state.nodes
        return
      }

      // Only trigger save if nodes reference changed (new object from set())
      if (state.nodes === lastNodesRef) {
        return
      }

      lastNodesRef = state.nodes
      hasDirtyChangesRef.current = true
      setAutosaveStatus('pending')

      // If a save is in-flight, mark pending so we do one follow-up save
      // instead of queuing unlimited concurrent saves.
      if (isSavingRef.current) {
        pendingSaveRef.current = true
        return
      }

      // Clear existing timeout (debounce reset)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // Debounce save
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = undefined
        executeSave()
      }, AUTOSAVE_DEBOUNCE_MS)
    })

    async function executeSave() {
      const currentProjectId = currentProjectIdRef.current
      if (!currentProjectId) return

      if (isLoadingSceneRef.current || useProjectStore.getState().isVersionPreviewMode) {
        // Save is paused while previewing older versions.
        pendingSaveRef.current = true
        setAutosaveStatus('paused')
        return
      }

      const { nodes, rootNodeIds } = useScene.getState()
      const sceneGraph = { nodes, rootNodeIds }
      if (!hasUsableSceneGraph(sceneGraph)) return

      isSavingRef.current = true
      pendingSaveRef.current = false
      setAutosaveStatus('saving')

      try {
        await saveProjectModel(currentProjectId, sceneGraph)
        hasDirtyChangesRef.current = false
        setAutosaveStatus('saved')
      } finally {
        isSavingRef.current = false

        // If changes arrived while we were saving, schedule one more save
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false
          setAutosaveStatus('pending')
          saveTimeoutRef.current = setTimeout(() => {
            saveTimeoutRef.current = undefined
            executeSave()
          }, AUTOSAVE_DEBOUNCE_MS)
        }
      }
    }
    executeSaveRef.current = executeSave

    // Flush unsaved changes when the user leaves the page / closes the tab.
    // Uses sendBeacon via keepalive fetch so the request survives page unload.
    function flushOnExit() {
      if (!hasDirtyChangesRef.current || !currentProjectIdRef.current) return

      const { nodes, rootNodeIds } = useScene.getState()
      const sceneGraph = { nodes, rootNodeIds }
      if (!hasUsableSceneGraph(sceneGraph)) return

      // Best-effort fire-and-forget save. If the browser kills it, the last
      // debounced autosave may still be the latest committed version.
      saveProjectModel(currentProjectIdRef.current, sceneGraph).catch(() => {
        // Swallow — nothing we can do during unload
      })
      hasDirtyChangesRef.current = false
    }

    window.addEventListener('beforeunload', flushOnExit)

    return () => {
      executeSaveRef.current = null
      window.removeEventListener('beforeunload', flushOnExit)

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = undefined
      }

      unsubscribe()

      // Flush on unmount (e.g. navigating away within the SPA)
      flushOnExit()
      useScene.temporal.getState().pause()
      clearSceneHistory()
      useScene.getState().unloadScene()
      useScene.temporal.getState().resume()
      currentProjectIdRef.current = null
      hasDirtyChangesRef.current = false
      resetEditorInteractionState()
    }
  }, [projectId, setAutosaveStatus])

  useEffect(() => {
    if (!projectId) return

    if (isVersionPreviewMode) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = undefined
      }
      if (hasDirtyChangesRef.current) {
        pendingSaveRef.current = true
      }
      setAutosaveStatus('paused')
      return
    }

    if (isSavingRef.current) {
      return
    }

    if (hasDirtyChangesRef.current) {
      setAutosaveStatus('pending')
      if (!saveTimeoutRef.current) {
        saveTimeoutRef.current = setTimeout(() => {
          saveTimeoutRef.current = undefined
          executeSaveRef.current?.()
        }, AUTOSAVE_DEBOUNCE_MS)
      }
      return
    }

    setAutosaveStatus('saved')
  }, [isVersionPreviewMode, projectId, setAutosaveStatus])
}
