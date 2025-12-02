'use client'

import { useEffect, useRef } from 'react'
import { emitter, type GridEvent, type WallEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { WallNode } from '@/lib/scenegraph/schema/nodes/wall'

interface WallDeleteInfo {
  rangeStart: number
  rangeEnd: number
}

interface SledgehammerState {
  // Wall deletion state
  hoveredWallId: string | null
  hoveredGridIndex: number | null // Which grid cell (0 to length-1)
  isDragging: boolean
  dragStartWallId: string | null // Wall where drag started
  dragStartIndex: number | null // Grid index where drag started
  dragEndIndex: number | null // Grid index where drag currently is
  // Track all walls to delete during drag (wallId -> delete range)
  wallsToDelete: Map<string, WallDeleteInfo>

  // Grid/item deletion state
  itemsToDelete: Set<string>
  isGridDragging: boolean
  gridDragStart: [number, number] | null
}

/**
 * Calculate which grid cell index a point lies on along a wall
 * The gridX is already in wall-local coordinates (0 to wallLength along the wall)
 * Returns an integer from 0 to (wallLength - 1)
 */
function getWallGridIndex(wall: WallNode, localGridX: number): number {
  const wallGridLength = wall.size[0]

  if (wallGridLength === 0) return 0

  // localGridX is already the position along the wall in grid units
  // Floor to get the cell index, clamp to valid range
  const index = Math.floor(localGridX)

  return Math.max(0, Math.min(wallGridLength - 1, index))
}

/**
 * Sledgehammer tool for deleting walls and items
 */
export function SledgehammerTool() {
  const graph = useEditor((state) => state.graph)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const addNode = useEditor((state) => state.addNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const spatialGrid = useEditor((state) => state.spatialGrid)

  const stateRef = useRef<SledgehammerState>({
    hoveredWallId: null,
    hoveredGridIndex: null,
    isDragging: false,
    dragStartWallId: null,
    dragStartIndex: null,
    dragEndIndex: null,
    wallsToDelete: new Map(),
    itemsToDelete: new Set(),
    isGridDragging: false,
    gridDragStart: null,
  })

  useEffect(() => {
    if (!selectedFloorId) return

    const state = stateRef.current

    // Helper to update the delete range on a wall
    const setDeleteRange = (
      wallId: string,
      wall: WallNode,
      startIndex: number,
      endIndex: number,
    ) => {
      // Ensure start <= end
      const rangeStart = Math.min(startIndex, endIndex)
      const rangeEnd = Math.max(startIndex, endIndex)

      updateNode(wallId, {
        editor: {
          ...wall.editor,
          deletePreview: true,
          deleteRange: [rangeStart, rangeEnd],
        },
      })
    }

    // Helper to clear delete preview from a wall
    const clearDeletePreview = (wallId: string) => {
      const handle = graph.getNodeById(wallId as any)
      if (handle) {
        const node = handle.data() as any
        if (node?.editor?.deletePreview) {
          updateNode(wallId, {
            editor: { ...node.editor, deletePreview: false, deleteRange: undefined },
          })
        }
      }
    }

    // Clear any existing delete flags when tool activates
    const clearDeleteFlags = () => {
      if (state.hoveredWallId) {
        clearDeletePreview(state.hoveredWallId)
      }
      // Clear all walls in the delete set
      state.wallsToDelete.forEach((_, wallId) => {
        clearDeletePreview(wallId)
      })
      state.wallsToDelete.clear()

      state.itemsToDelete.forEach((itemId) => {
        const handle = graph.getNodeById(itemId as any)
        if (handle) {
          const node = handle.data() as any
          if (node?.editor?.deletePreview) {
            updateNode(itemId, { editor: { ...node.editor, deletePreview: false } })
          }
        }
      })
    }

    // ========================================================================
    // WALL EVENT HANDLERS
    // ========================================================================

    const handleWallEnter = (e: WallEvent) => {
      const wall = e.node
      // gridPosition.x is already in wall-local space (0 to wallLength)
      const gridIndex = getWallGridIndex(wall, e.gridPosition.x)

      state.hoveredWallId = wall.id
      state.hoveredGridIndex = gridIndex

      if (state.isDragging) {
        // When entering a new wall during drag, start fresh range on this wall
        state.dragStartIndex = gridIndex
        state.dragEndIndex = gridIndex

        // Add/update this wall in the delete set
        state.wallsToDelete.set(wall.id, { rangeStart: gridIndex, rangeEnd: gridIndex })
        setDeleteRange(wall.id, wall, gridIndex, gridIndex)
      } else {
        // Just hovering - highlight single cell
        setDeleteRange(wall.id, wall, gridIndex, gridIndex)
      }
    }

    const handleWallMove = (e: WallEvent) => {
      const wall = e.node
      // gridPosition.x is already in wall-local space (0 to wallLength)
      const gridIndex = getWallGridIndex(wall, e.gridPosition.x)

      // Check if we moved to a different wall
      if (state.hoveredWallId && state.hoveredWallId !== wall.id) {
        if (!state.isDragging) {
          // Clear previous wall's preview only if not dragging
          clearDeletePreview(state.hoveredWallId)
        }
        // When moving to a new wall during drag, start fresh on new wall
        if (state.isDragging) {
          state.dragStartIndex = gridIndex
        }
      }

      // Check if grid index changed before updating state
      const indexChanged = state.hoveredGridIndex !== gridIndex
      const wallChanged = state.hoveredWallId !== wall.id

      state.hoveredWallId = wall.id
      state.hoveredGridIndex = gridIndex

      if (state.isDragging) {
        // Update drag end position
        state.dragEndIndex = gridIndex

        // Update this wall's range in the delete set
        const rangeStart = Math.min(state.dragStartIndex!, gridIndex)
        const rangeEnd = Math.max(state.dragStartIndex!, gridIndex)
        state.wallsToDelete.set(wall.id, { rangeStart, rangeEnd })
        setDeleteRange(wall.id, wall, rangeStart, rangeEnd)
      } else if (indexChanged || wallChanged) {
        // Just hovering - highlight single cell when index or wall changes
        setDeleteRange(wall.id, wall, gridIndex, gridIndex)
      }
    }

    const handleWallLeave = (e: WallEvent) => {
      const wall = e.node

      // Don't clear preview if dragging and this wall is in the delete set
      if (state.isDragging && state.wallsToDelete.has(wall.id)) {
        // Keep the preview, just update hover state
        if (state.hoveredWallId === wall.id) {
          state.hoveredWallId = null
          state.hoveredGridIndex = null
        }
        return
      }

      // Clear preview if not dragging
      if (!state.isDragging) {
        clearDeletePreview(wall.id)
      }

      if (state.hoveredWallId === wall.id) {
        state.hoveredWallId = null
        state.hoveredGridIndex = null
      }
    }

    const handleWallClick = (e: WallEvent) => {
      // Click is handled by pointerup for drag support
      // This is just for the case where we click without dragging
    }

    // ========================================================================
    // GRID EVENT HANDLERS (for items)
    // ========================================================================

    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position

      // Query spatial grid for items at this position
      const nodesAtPoint = spatialGrid.queryPoint(selectedFloorId, [x, y])

      for (const nodeId of nodesAtPoint) {
        const handle = graph.getNodeById(nodeId as any)
        if (!handle) continue

        const node = handle.data() as any
        // Delete items (not walls, rooms, etc.)
        if (node.type === 'item') {
          deleteNode(nodeId)
          return // Delete one item at a time for single click
        }
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      // If dragging on grid, flag items for deletion
      if (state.isGridDragging) {
        const [x, y] = e.position
        const nodesAtPoint = spatialGrid.queryPoint(selectedFloorId, [x, y])

        for (const nodeId of nodesAtPoint) {
          const handle = graph.getNodeById(nodeId as any)
          if (!handle) continue

          const node = handle.data() as any
          if (node.type === 'item' && !state.itemsToDelete.has(nodeId)) {
            state.itemsToDelete.add(nodeId)
            updateNode(nodeId, { editor: { ...node.editor, deletePreview: true } })
          }
        }
      }
    }

    // ========================================================================
    // POINTER EVENT HANDLERS (for drag detection)
    // ========================================================================

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return // Only left click

      if (state.hoveredWallId && state.hoveredGridIndex !== null) {
        // Start drag on wall
        state.isDragging = true
        state.dragStartWallId = state.hoveredWallId
        state.dragStartIndex = state.hoveredGridIndex
        state.dragEndIndex = state.hoveredGridIndex

        // Initialize the delete set with the current wall
        state.wallsToDelete.clear()
        state.wallsToDelete.set(state.hoveredWallId, {
          rangeStart: state.hoveredGridIndex,
          rangeEnd: state.hoveredGridIndex,
        })
      } else {
        // Start drag on grid (for items)
        state.isGridDragging = true
        state.gridDragStart = [e.clientX, e.clientY]
      }
    }

    const handlePointerUp = () => {
      // Handle wall deletion - delete ALL walls in the delete set
      if (state.isDragging && state.wallsToDelete.size > 0) {
        // Process all walls in the delete set
        state.wallsToDelete.forEach((deleteInfo, wallId) => {
          const handle = graph.getNodeById(wallId as any)
          if (handle) {
            const wall = handle.data() as WallNode
            // Perform the wall split/deletion
            deleteWallSegment(wall, deleteInfo.rangeStart, deleteInfo.rangeEnd)
          }
        })

        state.wallsToDelete.clear()
        state.hoveredWallId = null
        state.hoveredGridIndex = null
      }

      // Handle item deletion
      if (state.isGridDragging && state.itemsToDelete.size > 0) {
        state.itemsToDelete.forEach((itemId) => {
          deleteNode(itemId)
        })
        state.itemsToDelete.clear()
      }

      state.isDragging = false
      state.isGridDragging = false
      state.dragStartWallId = null
      state.dragStartIndex = null
      state.dragEndIndex = null
      state.gridDragStart = null
    }

    /**
     * Delete a segment of a wall, potentially creating 1 or 2 remaining walls
     * Also handles children (doors/windows):
     * - Children in the deleted segment are deleted
     * - Children in remaining segments have their positions adjusted
     * @param wall The wall to modify
     * @param rangeStart Start grid index of segment to delete (inclusive)
     * @param rangeEnd End grid index of segment to delete (inclusive)
     */
    const deleteWallSegment = (wall: WallNode, rangeStart: number, rangeEnd: number) => {
      const wallLength = wall.size[0]
      const [startX, startZ] = wall.start
      const [endX, endZ] = wall.end

      // Direction vector (normalized per grid unit)
      const dx = (endX - startX) / wallLength
      const dz = (endZ - startZ) / wallLength

      const hasPartBefore = rangeStart > 0
      const hasPartAfter = rangeEnd < wallLength - 1

      // Categorize children based on their position along the wall
      const children = wall.children || []
      const childrenBefore: typeof children = []
      const childrenAfter: typeof children = []

      for (const child of children) {
        const childX = child.position[0] // Position along the wall in grid units

        if (childX < rangeStart) {
          // Child is in the "before" segment - keep as is
          childrenBefore.push(child)
        } else if (childX > rangeEnd) {
          // Child is in the "after" segment - adjust position
          // New position = old position - (rangeEnd + 1) since the "after" wall starts at 0
          const afterStart = rangeEnd + 1
          childrenAfter.push({
            ...child,
            position: [childX - afterStart, child.position[1]] as [number, number],
          })
        }
        // Children within [rangeStart, rangeEnd] are deleted (not added to either array)
      }

      // Calculate remaining wall parts
      const parts: Array<{
        start: [number, number]
        end: [number, number]
        length: number
        children: typeof children
      }> = []

      // Part before the deleted segment
      if (hasPartBefore) {
        parts.push({
          start: [startX, startZ],
          end: [startX + dx * rangeStart, startZ + dz * rangeStart],
          length: rangeStart,
          children: childrenBefore,
        })
      }

      // Part after the deleted segment
      if (hasPartAfter) {
        const afterStart = rangeEnd + 1
        parts.push({
          start: [startX + dx * afterStart, startZ + dz * afterStart],
          end: [endX, endZ],
          length: wallLength - afterStart,
          children: childrenAfter,
        })
      }

      // Get the parent for creating new walls
      const parentHandle = graph.getNodeById(wall.id as any)?.parent()
      const parentId = parentHandle?.id ?? selectedFloorId

      if (parts.length === 0) {
        // Delete entire wall (and all its children)
        deleteNode(wall.id)
      } else if (parts.length === 1) {
        // Update original wall to the remaining part
        const part = parts[0]

        // If this is the "after" part (rangeStart === 0), we need to adjust children positions
        // since the wall start is moving
        const isAfterPart = rangeStart === 0
        const adjustedChildren = isAfterPart ? childrenAfter : childrenBefore

        updateNode(wall.id, {
          start: part.start,
          end: part.end,
          position: part.start,
          size: [part.length, wall.size[1]],
          children: adjustedChildren,
          editor: { ...wall.editor, deletePreview: false, deleteRange: undefined },
        })
      } else {
        // Two parts remain - update original to first part, create new wall for second
        const firstPart = parts[0]
        const secondPart = parts[1]

        // Update original wall to first part (keeps children in "before" segment)
        updateNode(wall.id, {
          start: firstPart.start,
          end: firstPart.end,
          position: firstPart.start,
          size: [firstPart.length, wall.size[1]],
          children: childrenBefore,
          editor: { ...wall.editor, deletePreview: false, deleteRange: undefined },
        })

        // Create new wall for second part with adjusted children positions
        addNode(
          WallNode.parse({
            type: 'wall',
            start: secondPart.start,
            end: secondPart.end,
            position: secondPart.start,
            size: [secondPart.length, wall.size[1]],
            rotation: wall.rotation,
            children: childrenAfter,
          }),
          parentId!,
        )
      }
    }

    // Register event listeners
    emitter.on('wall:enter', handleWallEnter)
    emitter.on('wall:move', handleWallMove)
    emitter.on('wall:leave', handleWallLeave)
    emitter.on('wall:click', handleWallClick)
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointerup', handlePointerUp)

    // Cleanup
    return () => {
      clearDeleteFlags()

      emitter.off('wall:enter', handleWallEnter)
      emitter.off('wall:move', handleWallMove)
      emitter.off('wall:leave', handleWallLeave)
      emitter.off('wall:click', handleWallClick)
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)

      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [graph, updateNode, deleteNode, addNode, selectedFloorId, spatialGrid])

  return null
}
