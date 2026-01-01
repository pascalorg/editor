'use client'

import { Square } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { emitter, type GridEvent } from '@pascal/core/events'
import { useEditor } from '../../../hooks'
import { registerComponent } from '../../../registry'
import { SlabNode } from '@pascal/core/scenegraph/schema/nodes/slab'
import { SlabRenderer } from './slab-renderer'

// ============================================================================
// SLAB NODE EDITOR
// ============================================================================

/**
 * Slab node editor component
 * Uses useEditor hooks directly to manage slab creation via two-click area selection
 */
const EMPTY_LEVELS: any[] = []

export function SlabNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
    return building ? building.children : EMPTY_LEVELS
  })

  // Use ref to persist state across renders without triggering re-renders
  const slabStateRef = useRef<{
    startPoint: [number, number] | null
    previewSlabId: string | null
    lastEndPoint: [number, number] | null
  }>({
    startPoint: null,
    previewSlabId: null,
    lastEndPoint: null,
  })

  useEffect(() => {
    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position

      if (slabStateRef.current.startPoint === null) {
        // First click: set start corner and create preview slab
        slabStateRef.current.startPoint = [x, y]
        slabStateRef.current.lastEndPoint = null

        // Create preview slab at start position with zero size initially
        const previewSlabId = addNode(
          SlabNode.parse({
            name: 'Slab Preview',
            position: [x, y],
            rotation: 0,
            size: [0, 0], // Zero size initially
            editor: {
              preview: true,
            },
          }),
          selectedFloorId,
        )

        slabStateRef.current.previewSlabId = previewSlabId
      } else {
        // Second click: commit or delete the preview slab based on canPlace
        const previewSlabId = slabStateRef.current.previewSlabId

        if (previewSlabId) {
          // Get the slab node to check if it can be placed
          const currentLevel = levels.find((l) => l.id === selectedFloorId)
          const slabNode = currentLevel?.children.find((child: any) => child.id === previewSlabId)

          if (slabNode && 'canPlace' in slabNode && slabNode.canPlace === false) {
            // Slab is invalid (too small), delete it
            deleteNode(previewSlabId)
          } else {
            // Slab is valid, commit the preview by setting preview: false
            updateNode(previewSlabId, { editor: { preview: false } })
          }
        }

        // Reset state
        slabStateRef.current.startPoint = null
        slabStateRef.current.previewSlabId = null
        slabStateRef.current.lastEndPoint = null
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position
      const slabStartPoint = slabStateRef.current.startPoint
      const previewSlabId = slabStateRef.current.previewSlabId

      if (slabStartPoint !== null && previewSlabId) {
        const [x1, y1] = slabStartPoint
        const [x2, y2] = [x, y]

        // Only update if the end point has changed
        const lastEndPoint = slabStateRef.current.lastEndPoint
        if (!lastEndPoint || lastEndPoint[0] !== x2 || lastEndPoint[1] !== y2) {
          slabStateRef.current.lastEndPoint = [x2, y2]

          // Calculate slab position (bottom-left corner) and size
          const slabX = Math.min(x1, x2)
          const slabY = Math.min(y1, y2)
          const slabWidth = Math.abs(x2 - x1)
          const slabHeight = Math.abs(y2 - y1)

          // Slab can only be placed if both width and height are at least 1 grid unit
          let canPlace = slabWidth >= 1 && slabHeight >= 1

          // Check for overlap with existing slabs on the same level
          if (canPlace) {
            const currentLevel = levels.find((l) => l.id === selectedFloorId)
            if (currentLevel?.children) {
              const existingSlabs = currentLevel.children.filter(
                (child: any) => child.type === 'slab' && child.id !== previewSlabId,
              )

              // Check if new slab overlaps with any existing slab (interior overlap, not just edges)
              for (const existingSlab of existingSlabs) {
                const [ex, ey] = existingSlab.position
                const [ew, eh] = existingSlab.size

                // Two rectangles overlap if they share interior area
                // They don't overlap if one is completely to the left, right, above, or below the other
                const noOverlap =
                  slabX >= ex + ew || // new slab is to the right
                  slabX + slabWidth <= ex || // new slab is to the left
                  slabY >= ey + eh || // new slab is below
                  slabY + slabHeight <= ey // new slab is above

                if (!noOverlap) {
                  canPlace = false
                  break
                }
              }
            }
          }

          // Update slab with position and size
          updateNode(previewSlabId, {
            position: [slabX, slabY] as [number, number],
            size: [slabWidth, slabHeight] as [number, number],
            editor: { canPlace, preview: true },
          })
        }
      }
    }

    const handleToolCancel = () => {
      // Only cancel if we've started drawing (first click done)
      if (slabStateRef.current.startPoint !== null && slabStateRef.current.previewSlabId) {
        deleteNode(slabStateRef.current.previewSlabId)
        slabStateRef.current.startPoint = null
        slabStateRef.current.previewSlabId = null
        slabStateRef.current.lastEndPoint = null
      }
    }

    // Register event listeners
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)
    emitter.on('tool:cancel', handleToolCancel)

    // Cleanup event listeners
    return () => {
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)
      emitter.off('tool:cancel', handleToolCancel)
    }
  }, [addNode, updateNode, deleteNode, selectedFloorId, levels])

  return null
}

// ============================================================================
// REGISTER SLAB COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'slab',
  nodeName: 'Slab',
  editorMode: 'building',
  toolName: 'slab',
  toolIcon: Square,
  schema: SlabNode,
  nodeEditor: SlabNodeEditor,
  nodeRenderer: SlabRenderer,
})
