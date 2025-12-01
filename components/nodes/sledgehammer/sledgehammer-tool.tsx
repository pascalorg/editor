'use client'

import { useEffect, useRef } from 'react'
import { emitter, type GridEvent, type WallEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { WallNode } from '@/lib/scenegraph/schema/nodes/wall'

interface SledgehammerState {
  // Wall deletion state
  hoveredWallId: string | null
  hoveredGridIndex: number | null // Which grid cell (0 to length-1)
  isDragging: boolean
  dragStartIndex: number | null // Grid index where drag started
  dragEndIndex: number | null // Grid index where drag currently is

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
    dragStartIndex: null,
    dragEndIndex: null,
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
        // If dragging, extend the range
        state.dragEndIndex = gridIndex
        setDeleteRange(wall.id, wall, state.dragStartIndex!, state.dragEndIndex)
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
        // Clear previous wall's preview
        clearDeletePreview(state.hoveredWallId)

        // Reset drag if we moved to a different wall
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
        setDeleteRange(wall.id, wall, state.dragStartIndex!, state.dragEndIndex)
      } else if (indexChanged || wallChanged) {
        // Just hovering - highlight single cell when index or wall changes
        setDeleteRange(wall.id, wall, gridIndex, gridIndex)
      }
    }

    const handleWallLeave = (e: WallEvent) => {
      // Don't clear if dragging (we want to keep the preview)
      if (state.isDragging) return

      const wall = e.node
      clearDeletePreview(wall.id)

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
        state.dragStartIndex = state.hoveredGridIndex
        state.dragEndIndex = state.hoveredGridIndex
      } else {
        // Start drag on grid (for items)
        state.isGridDragging = true
        state.gridDragStart = [e.clientX, e.clientY]
      }
    }

    const handlePointerUp = () => {
      // Handle wall deletion
      if (state.isDragging && state.hoveredWallId) {
        const wallId = state.hoveredWallId
        const handle = graph.getNodeById(wallId as any)
        if (handle) {
          const wall = handle.data() as WallNode

          const rangeStart = Math.min(state.dragStartIndex!, state.dragEndIndex!)
          const rangeEnd = Math.max(state.dragStartIndex!, state.dragEndIndex!)
          const wallLength = wall.size[0]

          // Perform the wall split/deletion
          deleteWallSegment(wall, rangeStart, rangeEnd)
        }

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
      state.dragStartIndex = null
      state.dragEndIndex = null
      state.gridDragStart = null
    }

    /**
     * Delete a segment of a wall, potentially creating 1 or 2 remaining walls
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

      // Calculate remaining wall parts
      const parts: Array<{
        start: [number, number]
        end: [number, number]
        length: number
      }> = []

      // Part before the deleted segment
      if (hasPartBefore) {
        parts.push({
          start: [startX, startZ],
          end: [startX + dx * rangeStart, startZ + dz * rangeStart],
          length: rangeStart,
        })
      }

      // Part after the deleted segment
      if (hasPartAfter) {
        const afterStart = rangeEnd + 1
        parts.push({
          start: [startX + dx * afterStart, startZ + dz * afterStart],
          end: [endX, endZ],
          length: wallLength - afterStart,
        })
      }

      // Get the parent for creating new walls
      const parentHandle = graph.getNodeById(wall.id as any)?.parent()
      const parentId = parentHandle?.id ?? selectedFloorId

      if (parts.length === 0) {
        // Delete entire wall
        deleteNode(wall.id)
      } else if (parts.length === 1) {
        // Update original wall to the remaining part
        const part = parts[0]
        updateNode(wall.id, {
          start: part.start,
          end: part.end,
          position: part.start,
          size: [part.length, wall.size[1]],
          editor: { ...wall.editor, deletePreview: false, deleteRange: undefined },
        })
      } else {
        // Two parts remain - update original to first part, create new wall for second
        const firstPart = parts[0]
        const secondPart = parts[1]

        // Update original wall to first part
        updateNode(wall.id, {
          start: firstPart.start,
          end: firstPart.end,
          position: firstPart.start,
          size: [firstPart.length, wall.size[1]],
          editor: { ...wall.editor, deletePreview: false, deleteRange: undefined },
        })

        // Create new wall for second part
        addNode(
          WallNode.parse({
            type: 'wall',
            start: secondPart.start,
            end: secondPart.end,
            position: secondPart.start,
            size: [secondPart.length, wall.size[1]],
            rotation: wall.rotation,
            children: [],
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
