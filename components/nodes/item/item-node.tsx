'use client'

import { Package } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { ItemRenderer } from '@/components/nodes/item/item-renderer'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'

// ============================================================================
// ITEM RENDERER PROPS SCHEMA
// ============================================================================

/**
 * Zod schema for item renderer props
 * These are renderer-specific properties, not the full node structure
 */
export const ItemRendererPropsSchema = z.object({
  modelUrl: z.string().optional(),
  category: z
    .enum(['furniture', 'appliance', 'decoration', 'lighting', 'plumbing', 'electric'])
    .optional(),
})

export type ItemRendererProps = z.infer<typeof ItemRendererPropsSchema>

// ============================================================================
// ITEM BUILDER COMPONENT
// ============================================================================

/**
 * Item builder component
 * Uses useEditor hooks and spatialGrid to manage item placement with collision detection
 */
export function ItemNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const spatialGrid = useEditor((state) => state.spatialGrid)
  const selectedItem = useEditor((state) => state.selectedItem)
  const levels = useEditor((state) => {
    const building = state.root.children[0]
    return building ? building.children : []
  })

  // Use ref to persist preview state across renders without triggering re-renders
  const previewStateRef = useRef<{
    previewItemId: string | null
    lastPreviewPosition: [number, number] | null
  }>({
    previewItemId: null,
    lastPreviewPosition: null,
  })

  useEffect(() => {
    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      const level = levels.find((l) => l.id === selectedFloorId)
      if (!level) return

      const [x, y] = e.position

      // Check if position is occupied using spatial grid
      const canPlace = canPlaceItem(x, y, selectedFloorId)

      if (canPlace) {
        // Create item node using selectedItem configuration
        addNode(
          {
            type: 'item' as const,
            name: `Item at ${x},${y}`,
            position: [x, y],
            rotation: 0,
            size: selectedItem.size,
            visible: true,
            opacity: 100,
            category: 'furniture',
            modelUrl: selectedItem.modelUrl,
            scale: selectedItem.scale,
            children: [],
          } as any,
          selectedFloorId,
        )
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const level = levels.find((l) => l.id === selectedFloorId)
      if (!level) return

      const [x, y] = e.position
      const lastPos = previewStateRef.current.lastPreviewPosition

      // Only update if position changed
      if (!lastPos || lastPos[0] !== x || lastPos[1] !== y) {
        previewStateRef.current.lastPreviewPosition = [x, y]

        // Check if position is occupied using spatial grid
        const canPlace = canPlaceItem(x, y, selectedFloorId)

        const previewId = previewStateRef.current.previewItemId

        if (previewId) {
          // Update existing preview position and canPlace state
          updateNode(previewId, {
            position: [x, y] as [number, number],
            visible: true,
            canPlace,
          } as any)
        } else {
          // Create new preview item using selectedItem configuration
          const newPreviewId = addNode(
            {
              type: 'item' as const,
              name: 'Item Preview',
              position: [x, y] as [number, number],
              rotation: 0,
              size: selectedItem.size as [number, number],
              visible: true,
              opacity: 100,
              preview: true,
              canPlace,
              category: 'furniture',
              modelUrl: selectedItem.modelUrl,
              scale: selectedItem.scale,
              children: [] as [],
            } as any,
            selectedFloorId,
          )
          previewStateRef.current.previewItemId = newPreviewId
        }
      }
    }

    /**
     * Check if an item can be placed at the given position
     * Uses spatial grid to detect collisions with other objects
     */
    function canPlaceItem(x: number, y: number, levelId: string): boolean {
      const level = levels.find((l) => l.id === levelId)
      if (!level) return false

      // Query spatial grid for objects at this position
      const bounds = {
        minX: x,
        maxX: x + 1, // 1m width
        minY: y,
        maxY: y + 1, // 1m depth
        minZ: 0,
        maxZ: 0,
      }

      const nearbyNodeIds = spatialGrid.query(levelId, bounds)

      // Filter out preview nodes and check for actual collisions
      for (const nodeId of nearbyNodeIds) {
        const node = level.children.find((child: any) => child.id === nodeId)
        if (node && !node.preview) {
          // Found a non-preview node at this position - cannot place
          return false
        }
      }

      return true
    }

    // Register event listeners
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)

    // Cleanup event listeners
    return () => {
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)
    }
  }, [addNode, updateNode, selectedFloorId, levels, spatialGrid, selectedItem])

  return null
}

// ============================================================================
// REGISTER ITEM COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'item',
  nodeName: 'Item',
  editorMode: 'building',
  toolName: 'item',
  toolIcon: Package,
  rendererPropsSchema: ItemRendererPropsSchema,
  nodeEditor: ItemNodeEditor,
  nodeRenderer: ItemRenderer,
})
