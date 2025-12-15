'use client'

import { Package } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { ItemRenderer } from '@/components/nodes/item/item-renderer'
import { type CeilingEvent, emitter, type GridEvent, type WallEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import { ItemNode } from '@/lib/scenegraph/schema/nodes/item'
import type { LevelNode } from '@/lib/scenegraph/schema/nodes/level'
import { canPlaceGridItemOnWall } from '@/lib/utils'

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
    lastCalculatedRotation: number | null // Track last auto-calculated rotation from wall normal
    currentSide: 'front' | 'back' // Track which side of the wall the item is on
    canPlace: boolean
  }>({
    previewItemId: null,
    lastPreviewPosition: null,
    currentRotation: 0,
    lastCalculatedRotation: null,
    currentSide: 'front',
    canPlace: false,
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
    // Determine attachment mode from selectedItem
    const attachTo = selectedItem.attachTo

    let ignoreGridMove = false

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /**
     * Calculate rotation angle from wall normal vector
     * The normal points outward from the wall surface
     */
    const calculateRotationFromNormal = (normal: [number, number, number] | undefined): number => {
      if (!normal) return 0
      // Calculate angle in X-Z plane (top-down view)
      // atan2(z, x) gives the angle the vector makes with the positive X axis
      // Add π/2 to align item's forward direction with the wall normal
      return Math.atan2(normal[2], normal[0]) + Math.PI / 2
    }

    /**
     * Determine which side of the wall based on the normal vector
     * In wall-local space, the wall runs along X-axis, so the normal points along Z-axis
     * Positive Z normal = 'front', Negative Z normal = 'back'
     */
    const getSideFromNormal = (normal: [number, number, number] | undefined): 'front' | 'back' => {
      if (!normal) return 'front'
      // The Z component of the normal determines which side
      // We use a threshold to handle floating point imprecision
      return normal[2] >= 0 ? 'front' : 'back'
    }

    /**
     * Adjust Z position for wall-attached items with Y size > 1
     * This pushes the item forward so it appears in front of the wall instead of half inside
     * The direction depends on which side of the wall the item is on (based on normal)
     */
    const adjustPositionForWallAttachment = (
      localPos: [number, number],
      size: [number, number],
      normal: [number, number, number] | undefined,
    ): [number, number] => {
      if (size[1] > 1) {
        // Offset by the full extra depth (size - 1) in the Z direction
        const depthOffset = size[1] - 1
        // Direction depends on which side of the wall (positive or negative Z normal)
        const direction = normal && normal[2] >= 0 ? 1 : -1
        return [localPos[0], localPos[1] + depthOffset * direction]
      }
      return localPos
    }

    // ============================================================================
    // GRID PLACEMENT (default behavior when no attachTo)
    // ============================================================================

    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId || attachTo) return // Skip if attaching to wall/ceiling

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
            name: selectedItem.name || 'Item',
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
            attachTo: selectedItem.attachTo,
            children: [],
          }),
          selectedFloorId,
        )
        updateNode(previewStateRef.current.previewItemId!, {
          editor: { preview: true, canPlace: false },
        }) // As  we placed an item here we can't place another
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId || attachTo || ignoreGridMove) return // Skip if attaching to wall/ceiling

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
              name: `${selectedItem.name || 'Item'} (Preview)`,
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
              attachTo: selectedItem.attachTo,
              children: [] as [],
            }),
            selectedFloorId,
          )
          previewStateRef.current.previewItemId = newPreviewId
        }
      }
    }

    // ============================================================================
    // WALL ATTACHMENT
    // ============================================================================

    const handleWallClick = (e: WallEvent) => {
      if (attachTo !== 'wall' && attachTo !== 'wall-side') return

      const previewId = previewStateRef.current.previewItemId
      if (!previewId) return

      if (previewStateRef.current.canPlace) {
        // Commit the preview by setting preview: false
        updateNode(previewId, { editor: { preview: false } })
        previewStateRef.current.previewItemId = null
        previewStateRef.current.lastPreviewPosition = null
      }
    }

    const handleWallEnter = (e: WallEvent) => {
      if (attachTo !== 'wall' && attachTo !== 'wall-side') return

      // Delete any existing preview
      const previewId = previewStateRef.current.previewItemId
      if (previewId) {
        deleteNode(previewId)
      }

      ignoreGridMove = true

      // gridPosition is already in wall's local coordinate system
      const basePos: [number, number] = [e.gridPosition.x, e.gridPosition.z]
      // Adjust position for items with Y size > 1 to push them in front of wall
      const localPos = adjustPositionForWallAttachment(basePos, selectedItem.size, e.normal)

      // Calculate rotation from wall normal
      const rotation = calculateRotationFromNormal(e.normal)
      previewStateRef.current.currentRotation = rotation
      previewStateRef.current.lastCalculatedRotation = rotation

      // Determine side based on attachTo:
      // - 'wall': impacts both sides (doors, windows) → no side (undefined)
      // - 'wall-side': one side only (art, TV, etc.) → use normal to determine side
      const side = attachTo === 'wall-side' ? getSideFromNormal(e.normal) : undefined
      if (side) {
        previewStateRef.current.currentSide = side
      }

      // Create a temporary item to check placement (with side for collision detection)
      const tempItem = {
        position: localPos,
        rotation,
        size: selectedItem.size,
        side,
      } as any

      const canPlace = canPlaceGridItemOnWall(e.node, tempItem, 2)
      previewStateRef.current.canPlace = canPlace

      const newPreviewId = addNode(
        ItemNode.parse({
          parentId: e.node.id,
          type: 'item' as const,
          name: `${selectedItem.name || 'Item'} (Preview)`,
          position: localPos,
          rotation, // Set rotation based on wall normal
          size: selectedItem.size,
          visible: true,
          opacity: 100,
          category: 'furniture',
          src: selectedItem.modelUrl,
          modelScale: selectedItem.scale,
          modelPosition: selectedItem.position,
          modelRotation: selectedItem.rotation,
          attachTo: selectedItem.attachTo,
          side, // Set side based on wall normal (undefined for doors/windows)
          editor: { preview: true, canPlace },
          children: [],
        }),
        e.node.id, // Parent is the wall
      )
      previewStateRef.current.previewItemId = newPreviewId
      previewStateRef.current.lastPreviewPosition = basePos
    }

    const handleWallMove = (e: WallEvent) => {
      if (attachTo !== 'wall' && attachTo !== 'wall-side') return

      const previewId = previewStateRef.current.previewItemId
      const lastPos = previewStateRef.current.lastPreviewPosition

      // Only update if position changed
      if (lastPos && lastPos[0] === e.gridPosition.x && lastPos[1] === e.gridPosition.z) {
        return
      }

      ignoreGridMove = true

      const basePos: [number, number] = [e.gridPosition.x, e.gridPosition.z]
      previewStateRef.current.lastPreviewPosition = basePos
      // Adjust position for items with Y size > 1 to push them in front of wall
      const localPos = adjustPositionForWallAttachment(basePos, selectedItem.size, e.normal)

      // Calculate rotation from wall normal
      const calculatedRotation = calculateRotationFromNormal(e.normal)

      // Determine side based on attachTo:
      // - 'wall': impacts both sides (doors, windows) → no side (undefined)
      // - 'wall-side': one side only (art, TV, etc.) → use normal to determine side
      const side = attachTo === 'wall-side' ? getSideFromNormal(e.normal) : undefined
      if (side) {
        previewStateRef.current.currentSide = side
      }

      // Only update rotation if the calculated value changed
      // This preserves user's manual rotation adjustments when moving along the same wall
      let rotation = previewStateRef.current.currentRotation
      if (calculatedRotation !== previewStateRef.current.lastCalculatedRotation) {
        rotation = calculatedRotation
        previewStateRef.current.currentRotation = rotation
        previewStateRef.current.lastCalculatedRotation = calculatedRotation
      }

      // Create a temporary item to check placement (with side for collision detection)
      const tempItem = {
        position: localPos,
        rotation,
        size: selectedItem.size,
        side,
      } as any

      const canPlace = canPlaceGridItemOnWall(e.node, tempItem, 2)
      previewStateRef.current.canPlace = canPlace

      if (previewId) {
        // Update existing preview
        updateNode(previewId, {
          position: localPos,
          rotation,
          side,
          editor: { preview: true, canPlace },
        })
      } else {
        // Create new preview
        const newPreviewId = addNode(
          ItemNode.parse({
            parentId: e.node.id,
            type: 'item' as const,
            name: `${selectedItem.name || 'Item'} (Preview)`,
            position: localPos,
            rotation,
            size: selectedItem.size,
            visible: true,
            opacity: 100,
            category: 'furniture',
            src: selectedItem.modelUrl,
            modelScale: selectedItem.scale,
            modelPosition: selectedItem.position,
            modelRotation: selectedItem.rotation,
            attachTo: selectedItem.attachTo,
            side, // Set side based on wall normal (undefined for doors/windows)
            editor: { preview: true, canPlace },
            children: [],
          }),
          e.node.id,
        )
        previewStateRef.current.previewItemId = newPreviewId
      }
    }

    const handleWallLeave = (e: WallEvent) => {
      if (attachTo !== 'wall' && attachTo !== 'wall-side') return

      const previewId = previewStateRef.current.previewItemId
      if (previewId) {
        deleteNode(previewId)
        previewStateRef.current.previewItemId = null
        previewStateRef.current.lastPreviewPosition = null
        previewStateRef.current.lastCalculatedRotation = null
      }
      ignoreGridMove = false
    }

    // ============================================================================
    // CEILING ATTACHMENT
    // ============================================================================

    const handleCeilingClick = (e: CeilingEvent) => {
      if (attachTo !== 'ceiling') return

      const previewId = previewStateRef.current.previewItemId
      if (!previewId) return

      if (previewStateRef.current.canPlace) {
        // Commit the preview by setting preview: false
        updateNode(previewId, { editor: { preview: false } })
        previewStateRef.current.previewItemId = null
        previewStateRef.current.lastPreviewPosition = null
      }
    }

    const handleCeilingEnter = (e: CeilingEvent) => {
      if (attachTo !== 'ceiling') return

      // Delete any existing preview
      const previewId = previewStateRef.current.previewItemId
      if (previewId) {
        deleteNode(previewId)
      }

      ignoreGridMove = true

      // gridPosition is already in ceiling's local coordinate system
      const localPos: [number, number] = [e.gridPosition.x, e.gridPosition.z]

      // For ceiling, we can check if the item fits within the ceiling bounds
      const ceilingSize = e.node.size || [0, 0]
      const itemSize = selectedItem.size
      const canPlace =
        localPos[0] >= 0 &&
        localPos[1] >= 0 &&
        localPos[0] + itemSize[0] <= ceilingSize[0] &&
        localPos[1] + itemSize[1] <= ceilingSize[1]

      previewStateRef.current.canPlace = canPlace

      const newPreviewId = addNode(
        ItemNode.parse({
          parentId: e.node.id,
          type: 'item' as const,
          name: `${selectedItem.name || 'Item'} (Preview)`,
          position: localPos,
          rotation: 0,
          size: selectedItem.size,
          visible: true,
          opacity: 100,
          category: 'furniture',
          src: selectedItem.modelUrl,
          modelScale: selectedItem.scale,
          modelPosition: selectedItem.position,
          modelRotation: selectedItem.rotation,
          attachTo: selectedItem.attachTo,
          editor: { preview: true, canPlace },
          children: [],
        }),
        e.node.id, // Parent is the ceiling
      )
      previewStateRef.current.previewItemId = newPreviewId
      previewStateRef.current.lastPreviewPosition = localPos
    }

    const handleCeilingMove = (e: CeilingEvent) => {
      if (attachTo !== 'ceiling') return

      const previewId = previewStateRef.current.previewItemId
      const lastPos = previewStateRef.current.lastPreviewPosition

      // Only update if position changed
      if (lastPos && lastPos[0] === e.gridPosition.x && lastPos[1] === e.gridPosition.z) {
        return
      }

      ignoreGridMove = true

      const localPos: [number, number] = [e.gridPosition.x, e.gridPosition.z]
      previewStateRef.current.lastPreviewPosition = localPos

      // Check if item fits within ceiling bounds
      const ceilingSize = e.node.size || [0, 0]
      const itemSize = selectedItem.size
      const canPlace =
        localPos[0] >= 0 &&
        localPos[1] >= 0 &&
        localPos[0] + itemSize[0] <= ceilingSize[0] &&
        localPos[1] + itemSize[1] <= ceilingSize[1]

      previewStateRef.current.canPlace = canPlace

      if (previewId) {
        // Update existing preview
        updateNode(previewId, {
          position: localPos,
          rotation: 0,
          editor: { preview: true, canPlace },
        })
      } else {
        // Create new preview
        const newPreviewId = addNode(
          ItemNode.parse({
            parentId: e.node.id,
            type: 'item' as const,
            name: `${selectedItem.name || 'Item'} (Preview)`,
            position: localPos,
            rotation: 0,
            size: selectedItem.size,
            visible: true,
            opacity: 100,
            category: 'furniture',
            src: selectedItem.modelUrl,
            modelScale: selectedItem.scale,
            modelPosition: selectedItem.position,
            modelRotation: selectedItem.rotation,
            attachTo: selectedItem.attachTo,
            editor: { preview: true, canPlace },
            children: [],
          }),
          e.node.id,
        )
        previewStateRef.current.previewItemId = newPreviewId
      }
    }

    const handleCeilingLeave = (e: CeilingEvent) => {
      if (attachTo !== 'ceiling') return

      const previewId = previewStateRef.current.previewItemId
      if (previewId) {
        deleteNode(previewId)
        previewStateRef.current.previewItemId = null
        previewStateRef.current.lastPreviewPosition = null
      }
      ignoreGridMove = false
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

    // Register event listeners based on attachment mode
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)

    if (attachTo === 'wall' || attachTo === 'wall-side') {
      emitter.on('wall:click', handleWallClick)
      emitter.on('wall:enter', handleWallEnter)
      emitter.on('wall:move', handleWallMove)
      emitter.on('wall:leave', handleWallLeave)
    }

    if (attachTo === 'ceiling') {
      emitter.on('ceiling:click', handleCeilingClick)
      emitter.on('ceiling:enter', handleCeilingEnter)
      emitter.on('ceiling:move', handleCeilingMove)
      emitter.on('ceiling:leave', handleCeilingLeave)
    }

    // Cleanup event listeners
    return () => {
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)

      if (attachTo === 'wall' || attachTo === 'wall-side') {
        emitter.off('wall:click', handleWallClick)
        emitter.off('wall:enter', handleWallEnter)
        emitter.off('wall:move', handleWallMove)
        emitter.off('wall:leave', handleWallLeave)
      }

      if (attachTo === 'ceiling') {
        emitter.off('ceiling:click', handleCeilingClick)
        emitter.off('ceiling:enter', handleCeilingEnter)
        emitter.off('ceiling:move', handleCeilingMove)
        emitter.off('ceiling:leave', handleCeilingLeave)
      }
    }
  }, [addNode, updateNode, deleteNode, selectedFloorId, levels, spatialGrid, selectedItem])

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
