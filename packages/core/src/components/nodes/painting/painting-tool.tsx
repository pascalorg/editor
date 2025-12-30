'use client'

import { useEffect, useRef } from 'react'
import { emitter, type WallEvent } from '@pascal/core/events'
import { useEditor } from '../../../hooks'
import { WallNode } from '@pascal/core/scenegraph/schema/nodes/wall'

interface WallPaintInfo {
  rangeStart: number
  rangeEnd: number
  face: 'front' | 'back'
}

interface PaintingState {
  // Wall painting state
  hoveredWallId: string | null
  hoveredGridIndex: number | null
  hoveredFace: 'front' | 'back' | null
  isDragging: boolean
  dragStartWallId: string | null
  dragStartIndex: number | null
  dragEndIndex: number | null
  dragFace: 'front' | 'back' | null
  // Track all walls to paint during drag
  wallsToPaint: Map<string, WallPaintInfo>
}

/**
 * Calculate which grid cell index a point lies on along a wall
 */
function getWallGridIndex(wall: WallNode | undefined, localGridX: number): number {
  if (!wall?.size) return 0
  const wallGridLength = wall.size[0]
  if (wallGridLength === 0) return 0
  const index = Math.floor(localGridX)
  return Math.max(0, Math.min(wallGridLength - 1, index))
}

/**
 * Determine which side of the wall based on the normal vector.
 * In wall-local space, the wall runs along X-axis, so the normal points along Z-axis.
 * Positive Z normal = 'front', Negative Z normal = 'back'
 *
 * This matches the logic used in item-node.tsx for wall attachments.
 */
function getFaceFromNormal(normal: [number, number, number] | undefined): 'front' | 'back' {
  if (!normal) return 'front'
  // The Z component of the normal determines which side
  return normal[2] >= 0 ? 'front' : 'back'
}

/**
 * Painting tool for applying materials to wall surfaces
 */
export function PaintingTool() {
  const graph = useEditor((state) => state.graph)
  const updateNode = useEditor((state) => state.updateNode)
  const addNode = useEditor((state) => state.addNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedMaterial = useEditor((state) => state.selectedMaterial)
  const paintMode = useEditor((state) => state.paintMode)
  const startTransaction = useEditor((state) => state.startTransaction)
  const commitTransaction = useEditor((state) => state.commitTransaction)
  const cancelTransaction = useEditor((state) => state.cancelTransaction)
  const captureSnapshot = useEditor((state) => state.captureSnapshot)
  const trackCreatedNode = useEditor((state) => state.trackCreatedNode)

  const stateRef = useRef<PaintingState>({
    hoveredWallId: null,
    hoveredGridIndex: null,
    hoveredFace: null,
    isDragging: false,
    dragStartWallId: null,
    dragStartIndex: null,
    dragEndIndex: null,
    dragFace: null,
    wallsToPaint: new Map(),
  })

  useEffect(() => {
    if (!selectedFloorId) return

    const state = stateRef.current

    /**
     * Get all sibling walls in the same room (group) as the given wall.
     * Returns the wall IDs and their node data.
     */
    const getRoomWalls = (wallId: string): Array<{ id: string; wall: WallNode }> => {
      const handle = graph.getNodeById(wallId as any)
      if (!handle) return []

      const parent = handle.parent()
      if (!parent) return []

      // Check if parent is a group (room)
      const parentData = parent.data() as any
      if (parentData?.type !== 'group') return []

      // Get all wall children of this group
      const walls: Array<{ id: string; wall: WallNode }> = []
      for (const child of parent.children()) {
        const childData = child.data() as any
        if (childData?.type === 'wall') {
          walls.push({ id: child.id as string, wall: childData as WallNode })
        }
      }
      return walls
    }

    /**
     * Set paint preview for all walls in a room, or the single wall if not in a room
     */
    const setRoomPaintPreview = (wallId: string, face: 'front' | 'back') => {
      const roomWalls = getRoomWalls(wallId)
      if (roomWalls.length > 0) {
        // Wall is in a room - preview all walls in the room
        for (const { id, wall } of roomWalls) {
          if (!wall.size) continue
          const wallLength = wall.size[0]
          updateNode(
            id,
            {
              editor: {
                ...wall.editor,
                paintPreview: true,
                paintRange: [0, wallLength - 1],
                paintFace: face,
              },
            },
            true,
          )
        }
      } else {
        // Single wall not in a room - preview the whole wall
        const handle = graph.getNodeById(wallId as any)
        if (!handle) return
        const wall = handle.data() as WallNode
        if (!wall?.size) return
        const wallLength = wall.size[0]
        updateNode(
          wallId,
          {
            editor: {
              ...wall.editor,
              paintPreview: true,
              paintRange: [0, wallLength - 1],
              paintFace: face,
            },
          },
          true,
        )
      }
    }

    /**
     * Clear paint preview for all walls in a room, or the single wall if not in a room
     */
    const clearRoomPaintPreview = (wallId: string) => {
      const roomWalls = getRoomWalls(wallId)
      if (roomWalls.length > 0) {
        // Wall is in a room - clear all walls in the room
        for (const { id, wall } of roomWalls) {
          if (wall.editor?.paintPreview) {
            updateNode(
              id,
              {
                editor: {
                  ...wall.editor,
                  paintPreview: false,
                  paintRange: undefined,
                  paintFace: undefined,
                },
              },
              true,
            )
          }
        }
      } else {
        // Single wall not in a room - clear just this wall
        clearPaintPreview(wallId)
      }
    }

    // Helper to update the paint preview range on a wall (preview only, skip undo)
    const setPaintRange = (
      wallId: string,
      wall: WallNode,
      startIndex: number,
      endIndex: number,
      face: 'front' | 'back',
    ) => {
      const rangeStart = Math.min(startIndex, endIndex)
      const rangeEnd = Math.max(startIndex, endIndex)

      updateNode(
        wallId,
        {
          editor: {
            ...wall.editor,
            paintPreview: true,
            paintRange: [rangeStart, rangeEnd],
            paintFace: face,
          },
        },
        true,
      ) // skipUndo - preview changes shouldn't be in history
    }

    // Helper to clear paint preview from a wall (preview only, skip undo)
    const clearPaintPreview = (wallId: string) => {
      const handle = graph.getNodeById(wallId as any)
      if (handle) {
        const node = handle.data() as any
        if (node?.editor?.paintPreview) {
          updateNode(
            wallId,
            {
              editor: {
                ...node.editor,
                paintPreview: false,
                paintRange: undefined,
                paintFace: undefined,
              },
            },
            true,
          ) // skipUndo - preview changes shouldn't be in history
        }
      }
    }

    // Clear any existing paint flags when tool activates
    const clearPaintFlags = () => {
      if (state.hoveredWallId) {
        clearPaintPreview(state.hoveredWallId)
      }
      state.wallsToPaint.forEach((_, wallId) => {
        clearPaintPreview(wallId)
      })
      state.wallsToPaint.clear()
    }

    // ========================================================================
    // WALL EVENT HANDLERS
    // ========================================================================

    const handleWallEnter = (e: WallEvent) => {
      const wall = e.node
      e.stopPropagation()
      if (!wall?.size) return // Guard against undefined wall

      const gridIndex = getWallGridIndex(wall, e.gridPosition.x)
      const face = getFaceFromNormal(e.normal)

      state.hoveredWallId = wall.id
      state.hoveredGridIndex = gridIndex
      state.hoveredFace = face

      if (state.isDragging) {
        // In room mode, dragging is not used - we paint on click
        if (paintMode === 'room') return

        // Ignore faces that are opposite to the face we started painting on
        if (face !== state.dragFace) {
          return
        }

        const existingPaintInfo = state.wallsToPaint.get(wall.id)

        if (existingPaintInfo) {
          // Re-entering a wall we're already painting - extend the range
          const rangeStart = Math.min(existingPaintInfo.rangeStart, gridIndex)
          const rangeEnd = Math.max(existingPaintInfo.rangeEnd, gridIndex)
          state.wallsToPaint.set(wall.id, { rangeStart, rangeEnd, face: state.dragFace! })
          setPaintRange(wall.id, wall, rangeStart, rangeEnd, state.dragFace!)
        } else {
          // New wall during drag - capture snapshot and start fresh range
          captureSnapshot(wall.id)
          state.dragStartIndex = gridIndex
          state.dragEndIndex = gridIndex
          state.wallsToPaint.set(wall.id, {
            rangeStart: gridIndex,
            rangeEnd: gridIndex,
            face: state.dragFace!,
          })
          setPaintRange(wall.id, wall, gridIndex, gridIndex, state.dragFace!)
        }
      } else {
        // Just hovering
        if (paintMode === 'room') {
          // In room mode, highlight all walls in the room
          setRoomPaintPreview(wall.id, face)
        } else {
          // In wall mode, highlight single cell
          setPaintRange(wall.id, wall, gridIndex, gridIndex, face)
        }
      }
    }

    const handleWallMove = (e: WallEvent) => {
      const wall = e.node
      e.stopPropagation()
      if (!wall?.size) return // Guard against undefined wall

      const gridIndex = getWallGridIndex(wall, e.gridPosition.x)
      const face = getFaceFromNormal(e.normal)

      // Check if we moved to a different wall - clear preview if not dragging
      if (state.hoveredWallId && state.hoveredWallId !== wall.id && !state.isDragging) {
        if (paintMode === 'room') {
          clearRoomPaintPreview(state.hoveredWallId)
        } else {
          clearPaintPreview(state.hoveredWallId)
        }
      }

      const indexChanged = state.hoveredGridIndex !== gridIndex
      const wallChanged = state.hoveredWallId !== wall.id
      const faceChanged = state.hoveredFace !== face

      state.hoveredWallId = wall.id
      state.hoveredGridIndex = gridIndex
      state.hoveredFace = face

      if (state.isDragging) {
        // In room mode, dragging is not used - we paint on click
        if (paintMode === 'room') return

        // Ignore faces that are opposite to the face we started painting on
        if (face !== state.dragFace) {
          return
        }

        state.dragEndIndex = gridIndex

        // Get existing range and extend it (never shrink)
        const existingPaintInfo = state.wallsToPaint.get(wall.id)
        const rangeStart = existingPaintInfo
          ? Math.min(existingPaintInfo.rangeStart, gridIndex)
          : gridIndex
        const rangeEnd = existingPaintInfo
          ? Math.max(existingPaintInfo.rangeEnd, gridIndex)
          : gridIndex

        state.wallsToPaint.set(wall.id, { rangeStart, rangeEnd, face: state.dragFace! })
        setPaintRange(wall.id, wall, rangeStart, rangeEnd, state.dragFace!)
      } else if (indexChanged || wallChanged || faceChanged) {
        if (paintMode === 'room') {
          // In room mode, highlight all walls in the room
          setRoomPaintPreview(wall.id, face)
        } else {
          // In wall mode, highlight single cell
          setPaintRange(wall.id, wall, gridIndex, gridIndex, face)
        }
      }
    }

    const handleWallLeave = (e: WallEvent) => {
      const wall = e.node
      e.stopPropagation()
      if (!wall?.id) return // Guard against undefined wall

      // Don't clear preview if dragging and this wall is in the paint set (wall mode only)
      if (state.isDragging && paintMode === 'wall' && state.wallsToPaint.has(wall.id)) {
        if (state.hoveredWallId === wall.id) {
          state.hoveredWallId = null
          state.hoveredGridIndex = null
          state.hoveredFace = null
        }
        return
      }

      if (!state.isDragging) {
        if (paintMode === 'room') {
          clearRoomPaintPreview(wall.id)
        } else {
          clearPaintPreview(wall.id)
        }
      }

      if (state.hoveredWallId === wall.id) {
        state.hoveredWallId = null
        state.hoveredGridIndex = null
        state.hoveredFace = null
      }
    }

    const handleWallPointerDown = (e: WallEvent) => {
      const wall = e.node
      e.stopPropagation()
      if (!wall?.size) return // Guard against undefined wall

      const gridIndex = getWallGridIndex(wall, e.gridPosition.x)
      // Use normal from event if available, otherwise fallback to the face we saved from hover
      const face = e.normal ? getFaceFromNormal(e.normal) : state.hoveredFace || 'front'

      // Start a transaction for this paint operation
      startTransaction()

      if (paintMode === 'room') {
        // In room mode, paint all walls in the room (or single wall if not in room)
        const roomWalls = getRoomWalls(wall.id)
        if (roomWalls.length > 0) {
          // Capture snapshots for all walls in the room
          for (const { id } of roomWalls) {
            captureSnapshot(id)
          }
          // Paint all walls in the room (full wall, specified face)
          for (const { wall: roomWall } of roomWalls) {
            if (!roomWall.size) continue
            const wallLength = roomWall.size[0]
            paintWallSegment(roomWall, 0, wallLength - 1, face)
          }
          commitTransaction()
        } else {
          // Single wall not in a room - paint the whole wall
          captureSnapshot(wall.id)
          const wallLength = wall.size[0]
          paintWallSegment(wall, 0, wallLength - 1, face)
          commitTransaction()
        }
        // Don't set isDragging in room mode
        return
      }

      // Wall mode - start dragging
      captureSnapshot(wall.id)

      state.isDragging = true
      state.hoveredWallId = wall.id
      state.hoveredGridIndex = gridIndex
      state.hoveredFace = face
      state.dragStartWallId = wall.id
      state.dragStartIndex = gridIndex
      state.dragEndIndex = gridIndex
      state.dragFace = face

      state.wallsToPaint.clear()
      state.wallsToPaint.set(wall.id, {
        rangeStart: gridIndex,
        rangeEnd: gridIndex,
        face,
      })

      setPaintRange(wall.id, wall, gridIndex, gridIndex, face)
    }

    // Commit painting - called when pointer is released (on wall or anywhere else)
    const commitPainting = () => {
      if (!state.isDragging) return

      if (state.wallsToPaint.size > 0) {
        // Process all walls in the paint set
        state.wallsToPaint.forEach((paintInfo, wallId) => {
          const handle = graph.getNodeById(wallId as any)
          if (handle) {
            const wall = handle.data() as WallNode
            paintWallSegment(wall, paintInfo.rangeStart, paintInfo.rangeEnd, paintInfo.face)
          }
        })

        // Commit the transaction - this creates a single undo entry
        commitTransaction()

        state.wallsToPaint.clear()
        state.hoveredWallId = null
        state.hoveredGridIndex = null
        state.hoveredFace = null
      } else {
        // No painting happened, cancel the transaction
        cancelTransaction()
      }

      state.isDragging = false
      state.dragStartWallId = null
      state.dragStartIndex = null
      state.dragEndIndex = null
      state.dragFace = null
    }

    const handleWallPointerUp = (e: WallEvent) => {
      e.stopPropagation()
      commitPainting()
    }

    // Global pointer up handler - commits painting when releasing anywhere (not just on walls)
    const handleGlobalPointerUp = () => {
      commitPainting()
    }

    /**
     * Paint a segment of a wall with the selected material.
     * If the segment doesn't cover the whole wall, split the wall and apply the material
     * only to the painted segment.
     */
    const paintWallSegment = (
      wall: WallNode,
      rangeStart: number,
      rangeEnd: number,
      face: 'front' | 'back',
    ) => {
      const wallLength = wall.size[0]
      const materialProperty = face === 'front' ? 'materialFront' : 'materialBack'

      // If painting the entire wall, just update the material
      if (rangeStart === 0 && rangeEnd === wallLength - 1) {
        updateNode(wall.id, {
          [materialProperty]: selectedMaterial,
          editor: {
            ...wall.editor,
            paintPreview: false,
            paintRange: undefined,
            paintFace: undefined,
          },
        })
        return
      }

      // Otherwise, we need to split the wall
      const [startX, startZ] = wall.start
      const [endX, endZ] = wall.end

      // Direction vector (normalized per grid unit)
      const dx = (endX - startX) / wallLength
      const dz = (endZ - startZ) / wallLength

      const hasPartBefore = rangeStart > 0
      const hasPartAfter = rangeEnd < wallLength - 1

      // Categorize children based on their position
      const children = wall.children || []
      const childrenBefore: typeof children = []
      const childrenPainted: typeof children = []
      const childrenAfter: typeof children = []

      for (const child of children) {
        const childX = child.position[0]

        if (childX < rangeStart) {
          childrenBefore.push(child)
        } else if (childX > rangeEnd) {
          const afterStart = rangeEnd + 1
          childrenAfter.push({
            ...child,
            position: [childX - afterStart, child.position[1]] as [number, number],
          })
        } else {
          // Child in painted segment - adjust position relative to painted segment start
          childrenPainted.push({
            ...child,
            position: [childX - rangeStart, child.position[1]] as [number, number],
          })
        }
      }

      // Get the parent for creating new walls
      const parentHandle = graph.getNodeById(wall.id as any)?.parent()
      const parentId = parentHandle?.id ?? selectedFloorId

      // Calculate parts
      const parts: Array<{
        start: [number, number]
        end: [number, number]
        length: number
        children: typeof children
        isPainted: boolean
      }> = []

      // Part before the painted segment
      if (hasPartBefore) {
        parts.push({
          start: [startX, startZ],
          end: [startX + dx * rangeStart, startZ + dz * rangeStart],
          length: rangeStart,
          children: childrenBefore,
          isPainted: false,
        })
      }

      // The painted segment
      const paintedStart = rangeStart
      const paintedEnd = rangeEnd + 1
      parts.push({
        start: [startX + dx * paintedStart, startZ + dz * paintedStart],
        end: [startX + dx * paintedEnd, startZ + dz * paintedEnd],
        length: rangeEnd - rangeStart + 1,
        children: childrenPainted,
        isPainted: true,
      })

      // Part after the painted segment
      if (hasPartAfter) {
        const afterStart = rangeEnd + 1
        parts.push({
          start: [startX + dx * afterStart, startZ + dz * afterStart],
          end: [endX, endZ],
          length: wallLength - afterStart,
          children: childrenAfter,
          isPainted: false,
        })
      }

      // Delete original wall and create new walls for each part
      deleteNode(wall.id)

      for (const part of parts) {
        const newMaterialFront =
          part.isPainted && face === 'front' ? selectedMaterial : wall.materialFront
        const newMaterialBack =
          part.isPainted && face === 'back' ? selectedMaterial : wall.materialBack

        const newWallId = addNode(
          WallNode.parse({
            type: 'wall',
            start: part.start,
            end: part.end,
            position: part.start,
            size: [part.length, wall.size[1]],
            rotation: wall.rotation,
            thickness: wall.thickness,
            height: wall.height,
            materialFront: newMaterialFront,
            materialBack: newMaterialBack,
            children: part.children,
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
    emitter.on('wall:pointerdown', handleWallPointerDown)
    emitter.on('wall:pointerup', handleWallPointerUp)

    // Global pointer up to handle releasing outside of walls
    window.addEventListener('pointerup', handleGlobalPointerUp)

    // Cleanup
    return () => {
      // Cancel any active transaction when tool is deactivated
      cancelTransaction()
      clearPaintFlags()

      emitter.off('wall:enter', handleWallEnter)
      emitter.off('wall:move', handleWallMove)
      emitter.off('wall:leave', handleWallLeave)
      emitter.off('wall:pointerdown', handleWallPointerDown)
      emitter.off('wall:pointerup', handleWallPointerUp)
      window.removeEventListener('pointerup', handleGlobalPointerUp)
    }
  }, [
    graph,
    updateNode,
    deleteNode,
    addNode,
    selectedFloorId,
    selectedMaterial,
    paintMode,
    startTransaction,
    commitTransaction,
    cancelTransaction,
    captureSnapshot,
    trackCreatedNode,
  ])

  return null
}
