/**
 * Hooks for property model (scene) loading and auto-saving
 */

'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import useEditor from '@/store/use-editor'
import { usePropertyStore } from '../properties/store'
import { getPropertyModel, savePropertyModel } from './actions'

/**
 * Load the scene when a property becomes active
 * Saves changes automatically with debouncing
 */
export function usePropertyScene() {
  // Subscribe to property store
  const activeProperty = usePropertyStore((state) => state.activeProperty)
  const isLoadingProperty = usePropertyStore((state) => state.isLoading)

  const lastPropertyIdRef = useRef<string | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const isSavingRef = useRef(false)
  const currentPropertyIdRef = useRef<string | null>(null)

  // Extract property ID for dependency tracking
  const propertyId = activeProperty?.id ?? null
  const propertyName = activeProperty?.name ?? null

  // Load scene when active property changes
  useEffect(() => {
    if (isLoadingProperty) {
      return
    }

    if (!propertyId) {
      return
    }

    // Skip if same property
    if (lastPropertyIdRef.current === propertyId) {
      return
    }

    lastPropertyIdRef.current = propertyId

    // Load the property's scene
    async function loadScene() {
      try {
        const result = await getPropertyModel(propertyId || '')

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
  }, [propertyId, isLoadingProperty])

  // Auto-save scene changes with debouncing
  useEffect(() => {
    if (!propertyId) {
      currentPropertyIdRef.current = null
      return
    }

    currentPropertyIdRef.current = propertyId

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
        // Get the current property ID at save time (not the captured value)
        const currentPropertyId = currentPropertyIdRef.current
        if (!currentPropertyId) {
          return
        }

        const rootNodeIds = useScene.getState().rootNodeIds
        const sceneGraph = { nodes, rootNodeIds }

        isSavingRef.current = true

        try {
          await savePropertyModel(currentPropertyId, sceneGraph)
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
  }, [propertyId])
}
