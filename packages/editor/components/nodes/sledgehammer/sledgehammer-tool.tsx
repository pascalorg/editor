'use client'

import { Line } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { GRID_SIZE, TILE_SIZE } from '@/components/editor'
import { emitter, type GridEvent, type WallEvent } from '@/events/bus'
import { type EditorMode, useEditor } from '@/hooks/use-editor'
import { WallNode } from '@/lib/scenegraph/schema/nodes/wall'

interface WallDeleteInfo {
  rangeStart: number
  rangeEnd: number
}

interface SledgehammerState {
  // Wall deletion state (for hover preview only)
  hoveredWallId: string | null
  hoveredGridIndex: number | null // Which grid cell (0 to length-1)
  // Track all walls to delete during drag (wallId -> delete range)
  wallsToDelete: Map<string, WallDeleteInfo>

  // Grid/item deletion state (used for both items AND walls with rectangle selection)
  itemsToDelete: Set<string>
  isGridDragging: boolean
  gridDragStartPos: [number, number] | null // Grid coordinates where drag started
  gridDragEndPos: [number, number] | null // Grid coordinates where drag currently is
  // Whether the drag started on a wall (determines if we delete walls or items)
  dragStartedOnWall: boolean
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
  const startTransaction = useEditor((state) => state.startTransaction)
  const commitTransaction = useEditor((state) => state.commitTransaction)
  const cancelTransaction = useEditor((state) => state.cancelTransaction)
  const captureSnapshot = useEditor((state) => state.captureSnapshot)
  const trackCreatedNode = useEditor((state) => state.trackCreatedNode)
  const editorMode = useEditor((state) => state.editorMode)

  // Mode-based deletion: Structure mode = walls only, Furnish mode = items only
  const canDeleteWalls = editorMode === 'structure'
  const canDeleteItems = editorMode === 'furnish'

  const stateRef = useRef<SledgehammerState>({
    hoveredWallId: null,
    hoveredGridIndex: null,
    wallsToDelete: new Map(),
    itemsToDelete: new Set(),
    isGridDragging: false,
    gridDragStartPos: null,
    gridDragEndPos: null,
    dragStartedOnWall: false,
  })

  // State for the delete rectangle visualization
  const [deleteRect, setDeleteRect] = useState<{
    start: [number, number]
    end: [number, number]
  } | null>(null)

  useEffect(() => {
    if (!selectedFloorId) return

    const state = stateRef.current

    // Helper to update the delete range on a wall (preview only, skip undo)
    const setDeleteRange = (
      wallId: string,
      wall: WallNode,
      startIndex: number,
      endIndex: number,
    ) => {
      // Ensure start <= end
      const rangeStart = Math.min(startIndex, endIndex)
      const rangeEnd = Math.max(startIndex, endIndex)

      updateNode(
        wallId,
        {
          editor: {
            ...wall.editor,
            deletePreview: true,
            deleteRange: [rangeStart, rangeEnd],
          },
        },
        true,
      ) // skipUndo - preview changes shouldn't be in history
    }

    // Helper to clear delete preview from a wall (preview only, skip undo)
    const clearDeletePreview = (wallId: string) => {
      const handle = graph.getNodeById(wallId as any)
      if (handle) {
        const node = handle.data() as any
        if (node?.editor?.deletePreview) {
          updateNode(
            wallId,
            {
              editor: { ...node.editor, deletePreview: false, deleteRange: undefined },
            },
            true,
          ) // skipUndo - preview changes shouldn't be in history
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
            updateNode(itemId, { editor: { ...node.editor, deletePreview: false } }, true) // skipUndo
          }
        }
      })
    }

    // ========================================================================
    // WALL EVENT HANDLERS
    // ========================================================================

    const handleWallEnter = (e: WallEvent) => {
      // Skip wall events if we can't delete walls in this mode
      if (!canDeleteWalls) return

      const wall = e.node
      // gridPosition.x is already in wall-local space (0 to wallLength)
      const gridIndex = getWallGridIndex(wall, e.gridPosition.x)

      state.hoveredWallId = wall.id
      state.hoveredGridIndex = gridIndex

      // Only show hover preview if not dragging
      if (!state.isGridDragging) {
        setDeleteRange(wall.id, wall, gridIndex, gridIndex)
      }
    }

    const handleWallMove = (e: WallEvent) => {
      // Skip wall events if we can't delete walls in this mode
      if (!canDeleteWalls) return

      const wall = e.node
      // gridPosition.x is already in wall-local space (0 to wallLength)
      const gridIndex = getWallGridIndex(wall, e.gridPosition.x)

      // Check if we moved to a different wall
      if (state.hoveredWallId && state.hoveredWallId !== wall.id && !state.isGridDragging) {
        clearDeletePreview(state.hoveredWallId)
      }

      // Check if grid index changed before updating state
      const indexChanged = state.hoveredGridIndex !== gridIndex
      const wallChanged = state.hoveredWallId !== wall.id

      state.hoveredWallId = wall.id
      state.hoveredGridIndex = gridIndex

      // Only show hover preview if not dragging
      if (!state.isGridDragging && (indexChanged || wallChanged)) {
        setDeleteRange(wall.id, wall, gridIndex, gridIndex)
      }
    }

    const handleWallLeave = (e: WallEvent) => {
      // Skip wall events if we can't delete walls in this mode
      if (!canDeleteWalls) return

      const wall = e.node

      // Don't clear preview if dragging (wall might be in delete set)
      if (!state.isGridDragging) {
        clearDeletePreview(wall.id)
      }

      if (state.hoveredWallId === wall.id) {
        state.hoveredWallId = null
        state.hoveredGridIndex = null
      }
    }

    const handleWallClick = (_e: WallEvent) => {
      // Click is handled by pointerup for drag support
    }

    // ========================================================================
    // GRID EVENT HANDLERS (for items)
    // ========================================================================

    const handleGridClick = (e: GridEvent) => {
      // Skip item deletion if we can't delete items in this mode
      if (!canDeleteItems) return
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

    /**
     * Helper to find all walls in the level and calculate which segments intersect the rectangle
     * The rectangle coordinates are in absolute grid space
     */
    const findWallsInRect = (minX: number, maxX: number, minY: number, maxY: number) => {
      const wallsInRect = new Map<string, WallDeleteInfo>()

      // Find all walls in the current level
      const levelHandle = graph.getNodeById(selectedFloorId as any)
      if (!levelHandle) return wallsInRect

      // Traverse children, accumulating parent position offsets
      const findWalls = (handle: any, parentOffsetX: number, parentOffsetZ: number) => {
        for (const child of handle.children()) {
          const node = child.data()
          if (node.type === 'wall') {
            const wall = node as WallNode
            // Calculate which segments of this wall intersect the rectangle
            // Pass the accumulated parent offset to convert wall coords to absolute
            const range = calculateWallRangeInRect(
              wall,
              { minX, maxX, minY, maxY },
              parentOffsetX,
              parentOffsetZ,
            )
            if (range) {
              wallsInRect.set(wall.id, range)
            }
          } else if (node.type === 'group' || node.type === 'room') {
            // Accumulate this group's position offset
            const groupPos = node.position as [number, number] | undefined
            const newOffsetX = parentOffsetX + (groupPos?.[0] ?? 0)
            const newOffsetZ = parentOffsetZ + (groupPos?.[1] ?? 0)
            // Recurse into groups/rooms with accumulated offset
            findWalls(child, newOffsetX, newOffsetZ)
          }
        }
      }

      findWalls(levelHandle, 0, 0)
      return wallsInRect
    }

    /**
     * Calculate which segment of a wall intersects a rectangle
     * Returns null if no intersection, or the range [start, end] of grid cells that intersect
     * @param wall The wall node
     * @param rect Rectangle bounds in absolute grid coordinates
     * @param parentOffsetX Accumulated X offset from parent groups/rooms
     * @param parentOffsetZ Accumulated Z offset from parent groups/rooms
     */
    const calculateWallRangeInRect = (
      wall: WallNode,
      rect: { minX: number; maxX: number; minY: number; maxY: number },
      parentOffsetX: number,
      parentOffsetZ: number,
    ): WallDeleteInfo | null => {
      const { minX, maxX, minY, maxY } = rect
      // Wall start/end are relative to parent - add offset to get absolute
      const [relStartX, relStartZ] = wall.start
      const [relEndX, relEndZ] = wall.end
      const startX = relStartX + parentOffsetX
      const startZ = relStartZ + parentOffsetZ
      const endX = relEndX + parentOffsetX
      const endZ = relEndZ + parentOffsetZ
      const wallLength = wall.size[0]

      if (wallLength === 0) return null

      // Direction vector per grid unit
      const dx = (endX - startX) / wallLength
      const dz = (endZ - startZ) / wallLength

      let rangeStart: number | null = null
      let rangeEnd: number | null = null

      // Check each grid cell of the wall
      for (let i = 0; i < wallLength; i++) {
        // Get the center point of this grid cell in absolute coords
        const cellX = startX + dx * (i + 0.5)
        const cellZ = startZ + dz * (i + 0.5)

        // Check if this cell is inside the rectangle
        if (cellX >= minX && cellX <= maxX && cellZ >= minY && cellZ <= maxY) {
          if (rangeStart === null) {
            rangeStart = i
          }
          rangeEnd = i
        }
      }

      if (rangeStart !== null && rangeEnd !== null) {
        return { rangeStart, rangeEnd }
      }
      return null
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      // If dragging on grid, update rectangle and mark items/walls for deletion
      if (state.isGridDragging && state.gridDragStartPos) {
        const [x, y] = e.position
        state.gridDragEndPos = [x, y]

        // Update the visual rectangle
        setDeleteRect({
          start: state.gridDragStartPos,
          end: [x, y],
        })

        // Calculate rectangle bounds
        const minX = Math.min(state.gridDragStartPos[0], x)
        const maxX = Math.max(state.gridDragStartPos[0], x)
        const minY = Math.min(state.gridDragStartPos[1], y)
        const maxY = Math.max(state.gridDragStartPos[1], y)

        if (state.dragStartedOnWall) {
          // Find walls in the rectangle
          const wallsInRect = findWallsInRect(minX, maxX, minY, maxY)

          // Clear walls that are no longer in the rect
          state.wallsToDelete.forEach((_, wallId) => {
            if (!wallsInRect.has(wallId)) {
              clearDeletePreview(wallId)
              state.wallsToDelete.delete(wallId)
            }
          })

          // Add/update walls in the rect
          wallsInRect.forEach((range, wallId) => {
            const handle = graph.getNodeById(wallId as any)
            if (handle) {
              const wall = handle.data() as WallNode
              state.wallsToDelete.set(wallId, range)
              setDeleteRange(wallId, wall, range.rangeStart, range.rangeEnd)
            }
          })
        } else {
          // Handle item deletion (original behavior)
          const nodesInRect = spatialGrid.queryRect(selectedFloorId, [minX, minY], [maxX, maxY])

          // Clear previous items that are no longer in the rect
          state.itemsToDelete.forEach((itemId) => {
            if (!nodesInRect.includes(itemId)) {
              const handle = graph.getNodeById(itemId as any)
              if (handle) {
                const node = handle.data() as any
                updateNode(itemId, { editor: { ...node.editor, deletePreview: false } }, true) // skipUndo
              }
              state.itemsToDelete.delete(itemId)
            }
          })

          // Add new items in the rect
          for (const nodeId of nodesInRect) {
            const handle = graph.getNodeById(nodeId as any)
            if (!handle) continue

            const node = handle.data() as any
            if (node.type === 'item' && !state.itemsToDelete.has(nodeId)) {
              state.itemsToDelete.add(nodeId)
              updateNode(nodeId, { editor: { ...node.editor, deletePreview: true } }, true) // skipUndo
            }
          }
        }
      }
    }

    const handleGridPointerDown = (e: GridEvent) => {
      // Skip item deletion if we can't delete items in this mode
      if (!canDeleteItems) return
      if (!selectedFloorId) return

      // Don't start grid drag if we're on a wall (wall pointer down handles that)
      if (state.hoveredWallId) return

      // Start a transaction for item deletion
      startTransaction()

      const [x, y] = e.position
      state.isGridDragging = true
      state.dragStartedOnWall = false
      state.gridDragStartPos = [x, y]
      state.gridDragEndPos = [x, y]
      setDeleteRect({ start: [x, y], end: [x, y] })
    }

    const handleGridPointerUp = (_e: GridEvent) => {
      if (!selectedFloorId) return

      if (state.isGridDragging) {
        if (state.dragStartedOnWall && state.wallsToDelete.size > 0) {
          // Handle wall deletion
          // Capture snapshots and delete walls
          state.wallsToDelete.forEach((deleteInfo, wallId) => {
            captureSnapshot(wallId)
            const handle = graph.getNodeById(wallId as any)
            if (handle) {
              const wall = handle.data() as WallNode
              deleteWallSegment(wall, deleteInfo.rangeStart, deleteInfo.rangeEnd)
            }
          })
          commitTransaction()
          state.wallsToDelete.clear()
        } else if (!state.dragStartedOnWall && state.itemsToDelete.size > 0) {
          // Handle item deletion
          state.itemsToDelete.forEach((itemId) => {
            captureSnapshot(itemId)
          })
          state.itemsToDelete.forEach((itemId) => {
            deleteNode(itemId)
          })
          commitTransaction()
          state.itemsToDelete.clear()
        } else {
          cancelTransaction()
        }
      }

      state.isGridDragging = false
      state.dragStartedOnWall = false
      state.gridDragStartPos = null
      state.gridDragEndPos = null
      setDeleteRect(null)
    }

    // ========================================================================
    // WALL POINTER EVENT HANDLERS
    // ========================================================================

    const handleWallPointerDown = (e: WallEvent) => {
      // Skip wall events if we can't delete walls in this mode
      if (!canDeleteWalls) return
      if (!selectedFloorId) return

      // Clear the hover preview
      clearDeletePreview(e.node.id)

      // Start a transaction for wall deletion
      startTransaction()

      const wall = e.node
      const gridIndex = getWallGridIndex(wall, e.gridPosition.x)

      // Use world position from the event to get absolute grid coordinates
      // e.position is in world space, convert to grid coordinates
      // Apply the same conversion as grid-tiles: add GRID_SIZE/2 offset then divide by TILE_SIZE
      const [worldX, , worldZ] = e.position
      const localX = worldX + GRID_SIZE / 2
      const localZ = worldZ + GRID_SIZE / 2
      const gridX = Math.round(localX / TILE_SIZE)
      const gridY = Math.round(localZ / TILE_SIZE)

      state.isGridDragging = true
      state.dragStartedOnWall = true
      state.gridDragStartPos = [gridX, gridY]
      state.gridDragEndPos = [gridX, gridY]
      state.wallsToDelete.clear()

      // Initialize with the starting wall
      state.wallsToDelete.set(wall.id, { rangeStart: gridIndex, rangeEnd: gridIndex })
      setDeleteRange(wall.id, wall, gridIndex, gridIndex)

      setDeleteRect({ start: [gridX, gridY], end: [gridX, gridY] })
    }

    const handleWallPointerUp = (_e: WallEvent) => {
      // Skip wall events if we can't delete walls in this mode
      if (!canDeleteWalls) return
      // Wall pointer up is handled by handleGridPointerUp since we use grid-based rectangle selection
      // Just clear hover state
      state.hoveredWallId = null
      state.hoveredGridIndex = null
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
        const newWallId = addNode(
          WallNode.parse({
            type: 'wall',
            start: secondPart.start,
            end: secondPart.end,
            position: secondPart.start,
            size: [secondPart.length, wall.size[1]],
            rotation: wall.rotation,
            thickness: wall.thickness,
            height: wall.height,
            materialFront: wall.materialFront,
            materialBack: wall.materialBack,
            children: childrenAfter,
            parentId,
          }),
          parentId!,
        )
        // Track the new wall so it gets deleted on undo
        trackCreatedNode(newWallId)
      }
    }

    // Register event listeners
    emitter.on('wall:enter', handleWallEnter)
    emitter.on('wall:move', handleWallMove)
    emitter.on('wall:leave', handleWallLeave)
    emitter.on('wall:click', handleWallClick)
    emitter.on('wall:pointerdown', handleWallPointerDown)
    emitter.on('wall:pointerup', handleWallPointerUp)
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)
    emitter.on('grid:pointerdown', handleGridPointerDown)
    emitter.on('grid:pointerup', handleGridPointerUp)

    // Cleanup
    return () => {
      // Cancel any active transaction when tool is deactivated
      cancelTransaction()
      clearDeleteFlags()
      setDeleteRect(null)

      emitter.off('wall:enter', handleWallEnter)
      emitter.off('wall:move', handleWallMove)
      emitter.off('wall:leave', handleWallLeave)
      emitter.off('wall:click', handleWallClick)
      emitter.off('wall:pointerdown', handleWallPointerDown)
      emitter.off('wall:pointerup', handleWallPointerUp)
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)
      emitter.off('grid:pointerdown', handleGridPointerDown)
      emitter.off('grid:pointerup', handleGridPointerUp)
    }
  }, [
    graph,
    updateNode,
    deleteNode,
    addNode,
    selectedFloorId,
    spatialGrid,
    startTransaction,
    commitTransaction,
    cancelTransaction,
    captureSnapshot,
    trackCreatedNode,
    canDeleteWalls,
    canDeleteItems,
  ])

  // Render the delete rectangle when dragging on grid
  if (!deleteRect) return null

  // Convert grid coordinates to world coordinates
  // Grid is offset by -GRID_SIZE/2 in the editor, so we need to account for that
  const x1 = deleteRect.start[0] * TILE_SIZE
  const z1 = deleteRect.start[1] * TILE_SIZE
  const x2 = deleteRect.end[0] * TILE_SIZE
  const z2 = deleteRect.end[1] * TILE_SIZE

  // Create rectangle corners (at a small height above the floor)
  const y = 0.05
  const points: [number, number, number][] = [
    [x1, y, z1],
    [x2, y, z1],
    [x2, y, z2],
    [x1, y, z2],
    [x1, y, z1], // Close the rectangle
  ]

  return (
    <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
      <Line
        color="#ff4444"
        depthTest={false}
        frustumCulled={false}
        lineWidth={2}
        points={points}
        renderOrder={999}
        transparent
      />
    </group>
  )
}
