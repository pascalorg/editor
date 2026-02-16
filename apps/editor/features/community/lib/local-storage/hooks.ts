'use client'

import { initSpatialGridSync, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import useEditor from '@/store/use-editor'
import { getLocalProperty, updateLocalPropertyScene } from './property-store'

/**
 * Hook for local property scene management (guest users)
 * Loads scene from localStorage and auto-saves changes
 */
export function useLocalPropertyScene(propertyId?: string) {
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const currentPropertyIdRef = useRef<string | null>(null)
  const lastPropertyIdRef = useRef<string | null>(null)

  // Load scene when property ID changes
  useEffect(() => {
    if (!propertyId || !propertyId.startsWith('local_')) {
      return
    }

    if (lastPropertyIdRef.current === propertyId) {
      return
    }

    lastPropertyIdRef.current = propertyId
    currentPropertyIdRef.current = propertyId

    const property = getLocalProperty(propertyId)

    if (property?.scene_graph) {
      const { nodes, rootNodeIds } = property.scene_graph
      useScene.getState().setScene(nodes, rootNodeIds)
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
  }, [propertyId])

  // Auto-save to localStorage with debouncing
  useEffect(() => {
    if (!propertyId || !propertyId.startsWith('local_')) {
      currentPropertyIdRef.current = null
      return
    }

    currentPropertyIdRef.current = propertyId
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
        const currentId = currentPropertyIdRef.current
        if (!currentId) return

        const rootNodeIds = useScene.getState().rootNodeIds
        const sceneGraph = { nodes, rootNodeIds }

        updateLocalPropertyScene(currentId, sceneGraph)
      }, 1000)
    })

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      unsubscribe()
    }
  }, [propertyId])
}
