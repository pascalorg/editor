'use client'

import { type AnyNodeId, initSpatialGridSync, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import useEditor from '@/store/use-editor'
import { getLocalProject, updateLocalProjectScene } from './project-store'

/**
 * Hook for local project scene management (guest users)
 * Loads scene from localStorage and auto-saves changes
 */
export function useLocalProjectScene(projectId?: string) {
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const currentProjectIdRef = useRef<string | null>(null)
  const lastProjectIdRef = useRef<string | null>(null)

  // Load scene when project ID changes
  useEffect(() => {
    if (!projectId || !projectId.startsWith('local_')) {
      return
    }

    if (lastProjectIdRef.current === projectId) {
      return
    }

    lastProjectIdRef.current = projectId
    currentProjectIdRef.current = projectId

    const project = getLocalProject(projectId)

    if (project?.scene_graph) {
      const { nodes, rootNodeIds } = project.scene_graph
      useScene.getState().setScene(nodes, rootNodeIds as AnyNodeId[])
      initSpatialGridSync()
    } else {
      useScene.getState().clearScene()
    }

    useEditor.getState().setPhase('site')
    useViewer.getState().setSelection({
      buildingId: null,
      levelId: null,
      selectedIds: [],
      zoneId: null,
    })
  }, [projectId])

  // Auto-save to localStorage with debouncing
  useEffect(() => {
    if (!projectId || !projectId.startsWith('local_')) {
      currentProjectIdRef.current = null
      return
    }

    currentProjectIdRef.current = projectId
    let lastNodesSnapshot = JSON.stringify(useScene.getState().nodes)

    const unsubscribe = useScene.subscribe((state) => {
      const currentNodesSnapshot = JSON.stringify(state.nodes)

      if (currentNodesSnapshot === lastNodesSnapshot) {
        return
      }

      lastNodesSnapshot = currentNodesSnapshot
      const nodes = state.nodes

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // Debounce save by 1 second (faster than cloud save)
      saveTimeoutRef.current = setTimeout(() => {
        const currentId = currentProjectIdRef.current
        if (!currentId) return

        const rootNodeIds = useScene.getState().rootNodeIds
        const sceneGraph = { nodes, rootNodeIds }

        updateLocalProjectScene(currentId, sceneGraph)
      }, 1000)
    })

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      unsubscribe()
    }
  }, [projectId])
}
