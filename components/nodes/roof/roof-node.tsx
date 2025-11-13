'use client'

import { Triangle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { RoofRenderer } from '@/components/nodes/roof/roof-renderer'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'

const TILE_SIZE = 0.5 // 50cm grid spacing
const MIN_WALL_LENGTH = 0.5 // 50cm minimum wall length

// ============================================================================
// ROOF RENDERER PROPS SCHEMA
// ============================================================================

/**
 * Zod schema for roof renderer props
 * These are renderer-specific properties, not the full node structure
 */
export const RoofRendererPropsSchema = z
  .object({
    // Optional renderer configuration
    height: z.number().optional(),
    leftWidth: z.number().optional(),
    rightWidth: z.number().optional(),
  })
  .optional()

export type RoofRendererProps = z.infer<typeof RoofRendererPropsSchema>

// ============================================================================
// ROOF NODE EDITOR
// ============================================================================

/**
 * Roof node editor component
 * Uses useEditor hooks directly to manage roof creation via two-click area selection
 */
export function RoofNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  // Use ref to persist values across renders without triggering re-renders
  const roofStateRef = useRef<{
    startCorner: [number, number] | null
    previewRoofId: string | null
    lastEndCorner: [number, number] | null
  }>({
    startCorner: null,
    previewRoofId: null,
    lastEndCorner: null,
  })

  useEffect(() => {
    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position
      if (roofStateRef.current.startCorner === null) {
        // First click: set start corner and create preview node
        roofStateRef.current.startCorner = [x, y]
        roofStateRef.current.lastEndCorner = null // Reset last end corner

        // Create preview roof node (zero size initially)
        const previewRoofId = addNode(
          {
            type: 'roof',
            name: 'Roof Preview',
            position: [x, y] as [number, number],
            rotation: 0,
            size: [0, 0] as [number, number], // Zero size initially
            height: 2.5,
            leftWidth: 0,
            rightWidth: 0,
            visible: true,
            opacity: 100,
            preview: true, // Mark as preview
            children: [],
          } as any,
          selectedFloorId,
        )

        roofStateRef.current.previewRoofId = previewRoofId
      } else {
        // Second click: commit the preview roof
        const previewRoofId = roofStateRef.current.previewRoofId

        if (previewRoofId) {
          // Update the roof to remove preview flag
          updateNode(previewRoofId, {
            preview: false as any,
            name: 'Roof',
          })
        }

        // Reset state
        roofStateRef.current.startCorner = null
        roofStateRef.current.previewRoofId = null
        roofStateRef.current.lastEndCorner = null
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position
      const startCorner = roofStateRef.current.startCorner
      const previewRoofId = roofStateRef.current.previewRoofId

      if (startCorner !== null && previewRoofId) {
        const [x1, y1] = startCorner
        const [x2, y2] = [x, y]

        // Only update if the end corner has changed
        const lastEndCorner = roofStateRef.current.lastEndCorner
        if (!lastEndCorner || lastEndCorner[0] !== x2 || lastEndCorner[1] !== y2) {
          roofStateRef.current.lastEndCorner = [x2, y2]

          // Calculate base dimensions (rectangle footprint)
          const width = Math.abs(x2 - x1)
          const depth = Math.abs(y2 - y1)

          // Ensure roof base is at least MIN_WALL_LENGTH
          if (width * TILE_SIZE >= MIN_WALL_LENGTH && depth * TILE_SIZE >= MIN_WALL_LENGTH) {
            // Calculate ridge line along the longer axis
            // Ridge runs parallel to the longer side, centered in the rectangle
            const minX = Math.min(x1, x2)
            const maxX = Math.max(x1, x2)
            const minY = Math.min(y1, y2)
            const maxY = Math.max(y1, y2)
            const centerX = (minX + maxX) / 2
            const centerY = (minY + maxY) / 2

            let ridgeStart: [number, number]
            let ridgeEnd: [number, number]
            let roofWidth: number // Distance from ridge to each edge in grid units

            if (width >= depth) {
              // Ridge runs along X axis (longer side)
              ridgeStart = [minX, centerY]
              ridgeEnd = [maxX, centerY]
              roofWidth = depth / 2
            } else {
              // Ridge runs along Y axis (longer side)
              ridgeStart = [centerX, minY]
              ridgeEnd = [centerX, maxY]
              roofWidth = width / 2
            }

            // Calculate ridge line properties
            const dx = ridgeEnd[0] - ridgeStart[0]
            const dy = ridgeEnd[1] - ridgeStart[1]
            const length = Math.sqrt(dx * dx + dy * dy)
            const rotation = Math.atan2(-dy, dx) // Negate dy to match 3D z-axis direction

            // Convert roofWidth from grid units to meters
            const leftWidth = roofWidth * TILE_SIZE
            const rightWidth = roofWidth * TILE_SIZE

            // Update preview roof with ridge line and widths
            updateNode(previewRoofId, {
              position: ridgeStart as [number, number],
              rotation,
              size: [length, leftWidth + rightWidth] as [number, number], // [ridge length, total width]
              leftWidth,
              rightWidth,
            })
          } else {
            // Too small, reset to zero size
            updateNode(previewRoofId, {
              position: startCorner,
              rotation: 0,
              size: [0, 0] as [number, number],
              leftWidth: 0,
              rightWidth: 0,
            })
          }
        }
      }
    }

    // Register event listeners
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)

    // Cleanup event listeners
    return () => {
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)
    }
  }, [addNode, updateNode, selectedFloorId])

  return null
}

// ============================================================================
// REGISTER ROOF COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'roof',
  nodeName: 'Roof',
  editorMode: 'building',
  toolName: 'roof',
  toolIcon: Triangle,
  rendererPropsSchema: RoofRendererPropsSchema,
  nodeEditor: RoofNodeEditor,
  nodeRenderer: RoofRenderer,
})
