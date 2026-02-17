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

/**
 * Load the scene when a project becomes active
 * Saves changes automatically with debouncing
 */
export function useProjectScene() {
  // Subscribe to project store
  const activeProject = useProjectStore((state) => state.activeProject)
  const isLoadingProject = useProjectStore((state) => state.isLoading)

  const lastProjectIdRef = useRef<string | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const isSavingRef = useRef(false)
  const currentProjectIdRef = useRef<string | null>(null)

  // Extract project ID for dependency tracking
  const projectId = activeProject?.id ?? null
  const projectName = activeProject?.name ?? null

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
      try {
        const result = await getProjectModel(projectId || '')

        if (result.success && result.data?.scene_graph) {
          // Load the scene graph into the store
          const { nodes, rootNodeIds } = result.data.scene_graph
          useScene.getState().setScene(nodes, rootNodeIds)
        } else {
          // No scene found - clear the scene
          useScene.getState().clearScene()
        }
      } catch (error) {
        // Fall back to clear scene
        useScene.getState().clearScene()
      }

      // Reset editor state after loading/clearing scene
      useEditor.getState().setPhase('site')
      useViewer.getState().setSelection({
        buildingId: null,
        levelId: null,
        selectedIds: [],
        zoneId: null,
      })
    }

    loadScene()
  }, [projectId, isLoadingProject])

  // Auto-save scene changes with debouncing
  useEffect(() => {
    if (!projectId) {
      currentProjectIdRef.current = null
      return
    }

    currentProjectIdRef.current = projectId

    // Subscribe to any scene changes
    // Use JSON stringification to detect any node changes, not just count
    let lastNodesSnapshot = JSON.stringify(useScene.getState().nodes)

    const unsubscribe = useScene.subscribe((state) => {
      const currentNodesSnapshot = JSON.stringify(state.nodes)

      // Only trigger save if nodes actually changed
      if (currentNodesSnapshot === lastNodesSnapshot) {
        return
      }

      lastNodesSnapshot = currentNodesSnapshot
      const nodes = state.nodes

      // Skip if currently saving
      if (isSavingRef.current) {
        return
      }

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // Debounce save by 2 seconds
      saveTimeoutRef.current = setTimeout(async () => {
        // Get the current project ID at save time (not the captured value)
        const currentProjectId = currentProjectIdRef.current
        if (!currentProjectId) {
          return
        }

        const rootNodeIds = useScene.getState().rootNodeIds
        const sceneGraph = { nodes, rootNodeIds }

        isSavingRef.current = true

        try {
          await saveProjectModel(currentProjectId, sceneGraph)
        } finally {
          isSavingRef.current = false
        }
      }, 2000)
    })

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      unsubscribe()
    }
  }, [projectId])
}
