/**
 * Hooks for project model (scene) loading and auto-saving
 */

'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import useEditor from '@/store/use-editor'
import { useProjectStore } from '../projects/store'
import { getProjectModel, saveProjectModel } from './actions'

/** Debounce interval for cloud auto-save (ms). */
const AUTOSAVE_DEBOUNCE_MS = 10_000

/**
 * Load the scene when a project becomes active.
 * Saves changes automatically with debouncing.
 *
 * ⚠️  This hook must be mounted in exactly ONE component (the Editor).
 *     Mounting it in multiple components causes duplicate save calls.
 */
export function useProjectScene() {
  // Subscribe to project store
  const activeProject = useProjectStore((state) => state.activeProject)
  const isLoadingProject = useProjectStore((state) => state.isLoading)

  const lastProjectIdRef = useRef<string | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const isSavingRef = useRef(false)
  const currentProjectIdRef = useRef<string | null>(null)
  // Track whether the scene was just loaded from the server so we can skip
  // the first store update (which is the load itself, not a user edit).
  const isLoadingSceneRef = useRef(false)
  // Track whether there are pending changes that arrived while a save was
  // in-flight so we can coalesce them into one follow-up save.
  const pendingSaveRef = useRef(false)

  // Extract project ID for dependency tracking
  const projectId = activeProject?.id ?? null

  // Load scene when active project changes
  useEffect(() => {
    if (isLoadingProject) {
      return
    }

    if (!projectId) {
      return
    }

    // Skip if same project
    if (lastProjectIdRef.current === projectId) {
      return
    }

    lastProjectIdRef.current = projectId

    // Load the project's scene
    async function loadScene() {
      // Suppress auto-save for the store update caused by setScene/clearScene
      isLoadingSceneRef.current = true
      
      useProjectStore.getState().setIsSceneLoading(true)

      try {
        useScene.getState().clearScene()
        
        const result = await getProjectModel(projectId || '')

        if (result.success && result.data?.scene_graph) {
          // Load the scene graph into the store
          const { nodes, rootNodeIds } = result.data.scene_graph
          useScene.getState().setScene(nodes, rootNodeIds)
        } else {
          // No scene found - clear the scene
          useScene.getState().clearScene()
        }

        // Auto-select the first building + level after store is updated
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
      } catch (error) {
        // Fall back to clear scene
        useScene.getState().clearScene()
        
        // Auto-select the first building + level from the cleared scene
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
      } finally {
        useProjectStore.getState().setIsSceneLoading(false)
      }

      // Allow auto-save again after a tick (let the store update propagate)
      requestAnimationFrame(() => {
        isLoadingSceneRef.current = false
      })
    }

    loadScene()
  }, [projectId, isLoadingProject])

  // Track whether there are unsaved changes (dirty flag for flush-on-exit).
  const hasDirtyChangesRef = useRef(false)

  // Auto-save scene changes with debouncing
  useEffect(() => {
    if (!projectId) {
      currentProjectIdRef.current = null
      return
    }

    currentProjectIdRef.current = projectId

    // Use JSON stringification to detect node changes, not just count
    let lastNodesSnapshot = JSON.stringify(useScene.getState().nodes)

    const unsubscribe = useScene.subscribe((state) => {
      // Skip saves triggered by loading a scene from the server
      if (isLoadingSceneRef.current) {
        // Update the snapshot so the next real edit is compared correctly
        lastNodesSnapshot = JSON.stringify(state.nodes)
        return
      }

      const currentNodesSnapshot = JSON.stringify(state.nodes)

      // Only trigger save if nodes actually changed
      if (currentNodesSnapshot === lastNodesSnapshot) {
        return
      }

      lastNodesSnapshot = currentNodesSnapshot
      hasDirtyChangesRef.current = true

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
        executeSave()
      }, AUTOSAVE_DEBOUNCE_MS)
    })

    async function executeSave() {
      const currentProjectId = currentProjectIdRef.current
      if (!currentProjectId) return

      const { nodes, rootNodeIds } = useScene.getState()
      const sceneGraph = { nodes, rootNodeIds }

      isSavingRef.current = true
      pendingSaveRef.current = false

      try {
        await saveProjectModel(currentProjectId, sceneGraph)
        hasDirtyChangesRef.current = false
      } finally {
        isSavingRef.current = false

        // If changes arrived while we were saving, schedule one more save
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false
          saveTimeoutRef.current = setTimeout(() => {
            executeSave()
          }, AUTOSAVE_DEBOUNCE_MS)
        }
      }
    }

    // Flush unsaved changes when the user leaves the page / closes the tab.
    // Uses sendBeacon via keepalive fetch so the request survives page unload.
    function flushOnExit() {
      if (!hasDirtyChangesRef.current || !currentProjectIdRef.current) return

      const { nodes, rootNodeIds } = useScene.getState()
      const sceneGraph = { nodes, rootNodeIds }

      // Best-effort fire-and-forget save. We use the server action directly
      // (it's just a POST to a Next.js endpoint). If the browser kills it,
      // localStorage still has the data and will sync on next load.
      saveProjectModel(currentProjectIdRef.current, sceneGraph).catch(() => {
        // Swallow — nothing we can do during unload
      })
      hasDirtyChangesRef.current = false
    }

    window.addEventListener('beforeunload', flushOnExit)

    return () => {
      window.removeEventListener('beforeunload', flushOnExit)

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // Flush on unmount (e.g. navigating away within the SPA)
      flushOnExit()

      unsubscribe()
    }
  }, [projectId])
}
