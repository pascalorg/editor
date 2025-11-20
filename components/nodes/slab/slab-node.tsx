'use client'

import { Square } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import { SlabRenderer } from './slab-renderer'

// ============================================================================
// SLAB RENDERER PROPS SCHEMA
// ============================================================================

/**
 * Zod schema for slab renderer props
 * These are renderer-specific properties, not the full node structure
 */
export const SlabRendererPropsSchema = z
  .object({
    // Optional renderer configuration
    thickness: z.number().optional(),
  })
  .optional()

export type SlabRendererProps = z.infer<typeof SlabRendererPropsSchema>

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
    const building = state.scene.root.children?.[0]?.children.find(c => c.type === 'building')
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
          {
            type: 'slab' as const,
            name: 'Slab Preview',
            position: [x, y] as [number, number],
            rotation: 0,
            size: [0, 0] as [number, number], // Zero size initially
            visible: true,
            opacity: 100,
            preview: true,
            children: [] as [],
          } as any,
          selectedFloorId,
        )

        slabStateRef.current.previewSlabId = previewSlabId
      } else {
        // Second click: commit or delete the preview slab based on canPlace
        const previewSlabId = slabStateRef.current.previewSlabId

        if (previewSlabId) {
          // Get the slab node to check if it can be placed
          const currentLevel = levels.find((l) => l.id === selectedFloorId)
          const slabNode = currentLevel?.children.find((child) => child.id === previewSlabId)

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
          const canPlace = slabWidth >= 1 && slabHeight >= 1

          // Update slab with position and size
          updateNode(previewSlabId, {
            position: [slabX, slabY] as [number, number],
            size: [slabWidth, slabHeight] as [number, number],
            editor: { canPlace },
          })
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
  rendererPropsSchema: SlabRendererPropsSchema,
  nodeEditor: SlabNodeEditor,
  nodeRenderer: SlabRenderer,
})
