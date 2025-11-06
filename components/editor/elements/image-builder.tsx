'use client'

import { useEffect, useRef } from 'react'
import { emitter, type ImageManipulationEvent, type ImageUpdateEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'

export function ImageBuilder() {
  const updateNode = useEditor((state) => state.updateNode)
  const setIsManipulatingImage = useEditor((state) => state.setIsManipulatingImage)

  // Track undo state changes for batch updates during manipulation
  const undoStateRef = useRef<{
    [nodeId: string]: {
      position?: [number, number]
      rotation?: number
      scale?: number
    }
  }>({})

  useEffect(() => {
    const handleImageUpdate = (event: ImageUpdateEvent) => {
      const { nodeId, updates, pushToUndo } = event

      // Update the node in the store
      updateNode(nodeId, updates)

      // If pushing to undo, clear the accumulated state for this node
      if (pushToUndo) {
        delete undoStateRef.current[nodeId]
      } else {
        // Accumulate updates during drag
        if (!undoStateRef.current[nodeId]) {
          undoStateRef.current[nodeId] = {}
        }
        Object.assign(undoStateRef.current[nodeId], updates)
      }
    }

    const handleManipulationStart = (event: ImageManipulationEvent) => {
      const { nodeId } = event
      // Initialize accumulated state
      undoStateRef.current[nodeId] = {}
      setIsManipulatingImage(true)
    }

    const handleManipulationEnd = (event: ImageManipulationEvent) => {
      setIsManipulatingImage(false)
    }

    // Register event listeners
    emitter.on('image:update', handleImageUpdate)
    emitter.on('image:manipulation-start', handleManipulationStart)
    emitter.on('image:manipulation-end', handleManipulationEnd)

    // Cleanup event listeners
    return () => {
      emitter.off('image:update', handleImageUpdate)
      emitter.off('image:manipulation-start', handleManipulationStart)
      emitter.off('image:manipulation-end', handleManipulationEnd)
    }
  }, [updateNode, setIsManipulatingImage])

  return <></>
}
