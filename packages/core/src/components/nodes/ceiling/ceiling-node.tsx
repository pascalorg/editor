'use client'

import { Square } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { emitter, type GridEvent } from '@pascal/core/events'
import { useEditor } from '../../../hooks'
import { registerComponent } from '../../../registry'
import { CeilingNode } from '@pascal/core/scenegraph/schema/nodes/ceiling'
import { CeilingRenderer } from './ceiling-renderer'

// ============================================================================
// CEILING NODE EDITOR
// ============================================================================

/**
 * Ceiling node editor component
 * Uses useEditor hooks directly to manage ceiling creation via two-click area selection
 */
const EMPTY_LEVELS: any[] = []

export function CeilingNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
    return building ? building.children : EMPTY_LEVELS
  })

  // Use ref to persist state across renders without triggering re-renders
  const ceilingStateRef = useRef<{
    startPoint: [number, number] | null
    previewCeilingId: string | null
    lastEndPoint: [number, number] | null
  }>({
    startPoint: null,
    previewCeilingId: null,
    lastEndPoint: null,
  })

  useEffect(() => {
    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position

      if (ceilingStateRef.current.startPoint === null) {
        // First click: set start corner and create preview ceiling
        ceilingStateRef.current.startPoint = [x, y]
        ceilingStateRef.current.lastEndPoint = null

        // Create preview ceiling at start position with zero size initially
        // Elevation will be calculated by vertical-stacking-processor
        const previewCeilingId = addNode(
          CeilingNode.parse({
            name: 'Ceiling Preview',
            position: [x, y],
            rotation: 0,
            size: [0, 0], // Zero size initially
            editor: {
              preview: true,
            },
          }),
          selectedFloorId,
        )

        ceilingStateRef.current.previewCeilingId = previewCeilingId
      } else {
        // Second click: commit or delete the preview ceiling based on canPlace
        const previewCeilingId = ceilingStateRef.current.previewCeilingId

        if (previewCeilingId) {
          // Get the ceiling node to check if it can be placed
          const currentLevel = levels.find((l) => l.id === selectedFloorId)
          const ceilingNode = currentLevel?.children.find(
            (child: any) => child.id === previewCeilingId,
          )

          if (ceilingNode && 'canPlace' in ceilingNode && ceilingNode.canPlace === false) {
            // Ceiling is invalid (too small), delete it
            deleteNode(previewCeilingId)
          } else {
            // Ceiling is valid, commit the preview by setting preview: false
            updateNode(previewCeilingId, { editor: { preview: false } })
          }
        }

        // Reset state
        ceilingStateRef.current.startPoint = null
        ceilingStateRef.current.previewCeilingId = null
        ceilingStateRef.current.lastEndPoint = null
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position
      const ceilingStartPoint = ceilingStateRef.current.startPoint
      const previewCeilingId = ceilingStateRef.current.previewCeilingId

      if (ceilingStartPoint !== null && previewCeilingId) {
        const [x1, y1] = ceilingStartPoint
        const [x2, y2] = [x, y]

        // Only update if the end point has changed
        const lastEndPoint = ceilingStateRef.current.lastEndPoint
        if (!lastEndPoint || lastEndPoint[0] !== x2 || lastEndPoint[1] !== y2) {
          ceilingStateRef.current.lastEndPoint = [x2, y2]

          // Calculate ceiling position (bottom-left corner) and size
          const ceilingX = Math.min(x1, x2)
          const ceilingY = Math.min(y1, y2)
          const ceilingWidth = Math.abs(x2 - x1)
          const ceilingHeight = Math.abs(y2 - y1)

          // Ceiling can only be placed if both width and height are at least 1 grid unit
          let canPlace = ceilingWidth >= 1 && ceilingHeight >= 1

          // Check for overlap with existing ceilings on the same level
          if (canPlace) {
            const currentLevel = levels.find((l) => l.id === selectedFloorId)
            if (currentLevel?.children) {
              const existingCeilings = currentLevel.children.filter(
                (child: any) => child.type === 'ceiling' && child.id !== previewCeilingId,
              )

              // Check if new ceiling overlaps with any existing ceiling (interior overlap, not just edges)
              for (const existingCeiling of existingCeilings) {
                const [ex, ey] = existingCeiling.position
                const [ew, eh] = existingCeiling.size

                // Two rectangles overlap if they share interior area
                // They don't overlap if one is completely to the left, right, above, or below the other
                const noOverlap =
                  ceilingX >= ex + ew || // new ceiling is to the right
                  ceilingX + ceilingWidth <= ex || // new ceiling is to the left
                  ceilingY >= ey + eh || // new ceiling is below
                  ceilingY + ceilingHeight <= ey // new ceiling is above

                if (!noOverlap) {
                  canPlace = false
                  break
                }
              }
            }
          }

          // Update ceiling with position and size
          updateNode(previewCeilingId, {
            position: [ceilingX, ceilingY] as [number, number],
            size: [ceilingWidth, ceilingHeight] as [number, number],
            editor: { canPlace, preview: true },
          })
        }
      }
    }

    const handleToolCancel = () => {
      // Only cancel if we've started drawing (first click done)
      if (ceilingStateRef.current.startPoint !== null && ceilingStateRef.current.previewCeilingId) {
        deleteNode(ceilingStateRef.current.previewCeilingId)
        ceilingStateRef.current.startPoint = null
        ceilingStateRef.current.previewCeilingId = null
        ceilingStateRef.current.lastEndPoint = null
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
// REGISTER CEILING COMPONENT
// ============================================================================

// Icon will be provided via building menu
registerComponent({
  nodeType: 'ceiling',
  nodeName: 'Ceiling',
  editorMode: 'building',
  toolName: 'ceiling',
  toolIcon: Square,
  schema: CeilingNode,
  nodeEditor: CeilingNodeEditor,
  nodeRenderer: CeilingRenderer,
})
