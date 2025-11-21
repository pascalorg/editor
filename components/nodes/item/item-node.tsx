'use client'

import { Package } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { ItemRenderer } from '@/components/nodes/item/item-renderer'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import { ItemNode } from '@/lib/scenegraph/schema/nodes/item'
import type { LevelNode } from '@/lib/scenegraph/schema/nodes/level'

// ============================================================================
// ITEM BUILDER COMPONENT
// ============================================================================

/**
 * Item builder component
 * Uses useEditor hooks and spatialGrid to manage item placement with collision detection
 */
const EMPTY_LEVELS: any[] = []

export function ItemNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const spatialGrid = useEditor((state) => state.spatialGrid)
  const selectedItem = useEditor((state) => state.selectedItem)
  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
    return building ? building.children : EMPTY_LEVELS
  })

  // Use ref to persist preview state across renders without triggering re-renders
  const previewStateRef = useRef<{
    previewItemId: string | null
    lastPreviewPosition: [number, number] | null
    currentRotation: number
  }>({
    previewItemId: null,
    lastPreviewPosition: null,
    currentRotation: 0,
  })

  // Delete preview when selectedItem changes (user picks a different item from catalog)
  // biome-ignore lint/correctness/useExhaustiveDependencies: We intentionally watch modelUrl to trigger on item change
  useEffect(() => {
    const previewId = previewStateRef.current.previewItemId
    if (previewId) {
      deleteNode(previewId)
      previewStateRef.current.previewItemId = null
      previewStateRef.current.lastPreviewPosition = null
    }
  }, [selectedItem.modelUrl, deleteNode])

  // Right-click handler for rotation
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const previewId = previewStateRef.current.previewItemId
      // Only handle if there's an active preview
      if (previewId && selectedFloorId) {
        e.preventDefault()
        e.stopPropagation()

        // Rotate by 45 degrees (Math.PI / 4 radians)
        previewStateRef.current.currentRotation += Math.PI / 4

        // Update preview with new rotation
        updateNode(previewId, {
          rotation: previewStateRef.current.currentRotation,
        })
      }
    }

    window.addEventListener('contextmenu', handleContextMenu)

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [selectedFloorId, updateNode])

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
          ItemNode.parse({
            type: 'item' as const,
            name: `Item at ${x},${y}`,
            position: [x, y],
            rotation: previewStateRef.current.currentRotation,
            size: selectedItem.size,
            visible: true,
            opacity: 100,
            category: 'furniture',
            src: selectedItem.modelUrl,
            modelScale: selectedItem.scale,
            modelPosition: selectedItem.position,
            modelRotation: selectedItem.rotation,
            children: [],
          }),
          selectedFloorId,
        )
        // Reset rotation after placing
        previewStateRef.current.currentRotation = 0
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
            rotation: previewStateRef.current.currentRotation,
            visible: true,
            editor: { canPlace, preview: true },
          })
        } else {
          // Create new preview item using selectedItem configuration
          const newPreviewId = addNode(
            ItemNode.parse({
              type: 'item' as const,
              name: 'Item Preview',
              position: [x, y] as [number, number],
              rotation: previewStateRef.current.currentRotation,
              size: selectedItem.size as [number, number],
              visible: true,
              opacity: 100,
              editor: { preview: true, canPlace },
              category: 'furniture',
              src: selectedItem.modelUrl,
              modelScale: selectedItem.scale,
              modelPosition: selectedItem.position,
              modelRotation: selectedItem.rotation,
              children: [] as [],
            }),
            selectedFloorId,
          )
          previewStateRef.current.previewItemId = newPreviewId
        }
      }
    }

    /**
     * Check if two bounding boxes actually overlap (not just touch)
     * Adjacent items (touching at edges) should NOT be considered overlapping
     */
    function boundsOverlap(
      bounds1: { minX: number; maxX: number; minZ: number; maxZ: number },
      bounds2: { minX: number; maxX: number; minZ: number; maxZ: number },
    ): boolean {
      // Check for overlap in both X and Z dimensions
      // Use < instead of <= so touching edges don't count as overlap
      const overlapX = bounds1.minX < bounds2.maxX && bounds1.maxX > bounds2.minX
      const overlapZ = bounds1.minZ < bounds2.maxZ && bounds1.maxZ > bounds2.minZ
      return overlapX && overlapZ
    }

    /**
     * Check if an item can be placed at the given position
     * Uses spatial grid to detect collisions with other objects
     */
    function canPlaceItem(x: number, y: number, levelId: string): boolean {
      const level = levels.find((l) => l.id === levelId)
      if (!level) return false

      // Query spatial grid for objects at this position using selectedItem size
      const [width, depth] = selectedItem.size
      const newItemBounds = {
        minX: x,
        maxX: x + width,
        minZ: y,
        maxZ: y + depth,
      }

      const nearbyNodeIds = spatialGrid.query(levelId, newItemBounds)

      // Filter out preview nodes and check for actual collisions
      // Items can be placed on slabs and next to walls, but not on other items or columns
      for (const nodeId of nearbyNodeIds) {
        const node = level.children.find(
          (child: LevelNode['children'][number]) => child.id === nodeId,
        )
        // Block placement only for non-preview items and columns (solid obstacles)
        if (node && !node.editor?.preview) {
          if (node.type === 'item') {
            // Check if there's actual overlap (not just touching)
            if (node.position && node.size) {
              const existingBounds = {
                minX: node.position[0],
                maxX: node.position[0] + node.size[0],
                minZ: node.position[1],
                maxZ: node.position[1] + node.size[1],
              }
              if (boundsOverlap(newItemBounds, existingBounds)) {
                return false
              }
            }
          } else if (node.type === 'column' && node.position) {
            // Columns are point obstacles - check if they're inside the new item bounds
            const [cx, cz] = node.position
            if (
              cx >= newItemBounds.minX &&
              cx < newItemBounds.maxX &&
              cz >= newItemBounds.minZ &&
              cz < newItemBounds.maxZ
            ) {
              return false
            }
          }
        }
        // Allow placement on slabs, next to walls, etc.
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
  schema: ItemNode,
  nodeEditor: ItemNodeEditor,
  nodeRenderer: ItemRenderer,
})
