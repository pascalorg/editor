'use client'

import { Pentagon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { GroupRenderer } from '@/components/renderer/group-renderer'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import { createId } from '@/lib/utils'

// ============================================================================
// CUSTOM ROOM RENDERER PROPS SCHEMA
// ============================================================================

/**
 * Zod schema for custom room renderer props (groups)
 * These are renderer-specific properties, not the full node structure
 */
export const CustomRoomRendererPropsSchema = z
  .object({
    // Optional renderer configuration
    groupType: z.string().optional(),
  })
  .optional()

export type CustomRoomRendererProps = z.infer<typeof CustomRoomRendererPropsSchema>

// ============================================================================
// CUSTOM ROOM NODE EDITOR
// ============================================================================

/**
 * Custom room node editor component
 * Uses useEditor hooks directly to manage custom room creation via multi-point polygon
 */
export function CustomRoomNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levels = useEditor((state) => state.levels)

  // Use ref to persist values across renders without triggering re-renders
  const customRoomStateRef = useRef<{
    points: Array<[number, number]>
    previewWallIds: string[] // Walls for placed segments
    cursorWallId: string | null // Wall from last point to cursor
    previewGroupId: string | null
    lastCursorPoint: [number, number] | null // Track last cursor position to avoid unnecessary updates
  }>({
    points: [],
    previewWallIds: [],
    cursorWallId: null,
    previewGroupId: null,
    lastCursorPoint: null,
  })

  useEffect(() => {
    const calculateSnapPoint = (
      lastPoint: [number, number],
      currentPoint: [number, number],
    ): [number, number] => {
      const [x1, y1] = lastPoint
      const [x, y] = currentPoint

      let projectedX = x1
      let projectedY = y1

      const dx = x - x1
      const dy = y - y1
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      // Calculate distances to horizontal, vertical, and diagonal lines
      const horizontalDist = absDy
      const verticalDist = absDx
      const diagonalDist = Math.abs(absDx - absDy)

      // Find the minimum distance to determine which axis to snap to
      const minDist = Math.min(horizontalDist, verticalDist, diagonalDist)

      if (minDist === diagonalDist) {
        // Snap to 45° diagonal
        const diagonalLength = Math.min(absDx, absDy)
        projectedX = x1 + Math.sign(dx) * diagonalLength
        projectedY = y1 + Math.sign(dy) * diagonalLength
      } else if (minDist === horizontalDist) {
        // Snap to horizontal
        projectedX = x
        projectedY = y1
      } else {
        // Snap to vertical
        projectedX = x1
        projectedY = y
      }

      return [projectedX, projectedY]
    }

    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      const points = customRoomStateRef.current.points
      let [x, y] = e.position

      // Snap to grid from last point if we have points
      if (points.length > 0) {
        ;[x, y] = calculateSnapPoint(points[points.length - 1], [x, y])
      }

      // Check if clicking on the first point to close the shape
      if (points.length >= 3 && x === points[0][0] && y === points[0][1]) {
        // Finalize the room by removing preview flags
        const previewGroupId = customRoomStateRef.current.previewGroupId
        const cursorWallId = customRoomStateRef.current.cursorWallId

        if (previewGroupId) {
          // Update cursor wall to closing wall position, or delete it if 0-length
          if (cursorWallId) {
            const [x1, y1] = points[points.length - 1]
            const [x2, y2] = points[0]
            const dx = x2 - x1
            const dy = y2 - y1
            const length = Math.sqrt(dx * dx + dy * dy)

            if (length > 0) {
              const rotation = Math.atan2(-dy, dx)

              updateNode(cursorWallId, {
                position: [x1, y1] as [number, number],
                size: [length, 0.2] as [number, number],
                rotation,
                start: { x: x1, z: y1 } as any,
                end: { x: x2, z: y2 } as any,
              })
            } else {
              // Delete 0-length cursor wall before committing
              deleteNode(cursorWallId)
            }
          }

          // Commit the entire group with position and size
          // useEditor will automatically convert wall positions to relative
          updateNode(previewGroupId, {
            preview: false,
          })
        }

        // Reset state
        customRoomStateRef.current.points = []
        customRoomStateRef.current.previewWallIds = []
        customRoomStateRef.current.cursorWallId = null
        customRoomStateRef.current.previewGroupId = null
        customRoomStateRef.current.lastCursorPoint = null
      } else if (points.length === 0) {
        // First click: create preview group with cursor wall
        customRoomStateRef.current.points = [[x, y]]
        customRoomStateRef.current.lastCursorPoint = null

        // Create cursor wall (zero length initially)
        const cursorWallId = createId('wall')

        // Create preview group
        const groupId = addNode(
          {
            type: 'group',
            name: 'Custom Room Preview',
            groupType: 'room',
            visible: true,
            opacity: 100,
            preview: true,
            children: [
              {
                id: cursorWallId,
                type: 'wall',
                name: 'Wall Preview Cursor',
                position: [x, y] as [number, number],
                rotation: 0,
                size: [0, 0.2] as [number, number],
                start: { x, z: y },
                end: { x, z: y },
                visible: true,
                opacity: 100,
                preview: true,
                children: [],
              } as any,
            ],
          } as any,
          selectedFloorId,
        )

        // Update cursor wall parent
        updateNode(cursorWallId, { parent: groupId })

        customRoomStateRef.current.cursorWallId = cursorWallId
        customRoomStateRef.current.previewGroupId = groupId
      } else {
        // Subsequent click: update cursor wall to the click position, then finalize it
        const oldCursorWallId = customRoomStateRef.current.cursorWallId
        if (oldCursorWallId) {
          // Calculate the final geometry for the cursor wall
          const [x1, y1] = points[points.length - 1]
          const [x2, y2] = [x, y]
          const dx = x2 - x1
          const dy = y2 - y1
          const length = Math.sqrt(dx * dx + dy * dy)

          // Only finalize the wall if it has non-zero length
          // (prevents adding 0-length walls when double-clicking)
          if (length > 0) {
            const rotation = Math.atan2(-dy, dx)

            // Update cursor wall to final position
            updateNode(oldCursorWallId, {
              size: [length, 0.2] as [number, number],
              rotation,
              start: { x: x1, z: y1 } as any,
              end: { x: x2, z: y2 } as any,
              name: `Wall Preview ${customRoomStateRef.current.previewWallIds.length + 1}`,
            })

            // Move it to the placed walls list
            customRoomStateRef.current.previewWallIds.push(oldCursorWallId)

            // Add the new point AFTER finalizing the old cursor wall
            const newPoints = [...points, [x, y] as [number, number]]
            customRoomStateRef.current.points = newPoints
            customRoomStateRef.current.lastCursorPoint = null

            // Create new cursor wall starting at the point we just added
            const newCursorWallId = addNode(
              {
                type: 'wall',
                name: 'Wall Preview Cursor',
                position: [x, y] as [number, number],
                rotation: 0,
                size: [0, 0.2] as [number, number],
                start: { x, z: y },
                end: { x, z: y },
                visible: true,
                opacity: 100,
                preview: true,
                children: [],
              } as any,
              customRoomStateRef.current.previewGroupId!,
            )

            customRoomStateRef.current.cursorWallId = newCursorWallId
          }
        }
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const points = customRoomStateRef.current.points
      const cursorWallId = customRoomStateRef.current.cursorWallId

      if (points.length >= 1 && cursorWallId) {
        let [x, y] = e.position

        // Snap to grid from last point
        ;[x, y] = calculateSnapPoint(points[points.length - 1], [x, y])

        // Only update if the cursor point has changed
        const lastCursorPoint = customRoomStateRef.current.lastCursorPoint
        if (!lastCursorPoint || lastCursorPoint[0] !== x || lastCursorPoint[1] !== y) {
          customRoomStateRef.current.lastCursorPoint = [x, y]

          // Check if hovering over the first point to close the shape
          const hoveringFirstPoint = points.length >= 3 && x === points[0][0] && y === points[0][1]

          const [x1, y1] = points[points.length - 1]
          const [x2, y2] = hoveringFirstPoint ? points[0] : [x, y]
          const dx = x2 - x1
          const dy = y2 - y1
          const length = Math.sqrt(dx * dx + dy * dy)
          const rotation = Math.atan2(-dy, dx)

          // Update cursor wall (position stays at the point where it was created)
          updateNode(cursorWallId, {
            size: [length, 0.2] as [number, number],
            rotation,
            start: { x: x1, z: y1 } as any,
            end: { x: x2, z: y2 } as any,
          })
        }
      }
    }

    const handleGridDoubleClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      // Double-click to finish without closing the shape
      const points = customRoomStateRef.current.points
      const previewGroupId = customRoomStateRef.current.previewGroupId
      const cursorWallId = customRoomStateRef.current.cursorWallId

      if (points.length >= 2 && previewGroupId) {
        // Delete the cursor wall before committing (it's always 0-length or unwanted)
        if (cursorWallId) {
          deleteNode(cursorWallId)
        }
        // Commit the entire group
        updateNode(previewGroupId, {
          preview: false,
        })

        // Reset state
        customRoomStateRef.current.points = []
        customRoomStateRef.current.previewWallIds = []
        customRoomStateRef.current.cursorWallId = null
        customRoomStateRef.current.previewGroupId = null
        customRoomStateRef.current.lastCursorPoint = null
      }
    }

    // Register event listeners
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)
    emitter.on('grid:double-click', handleGridDoubleClick)

    // Cleanup event listeners
    return () => {
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)
      emitter.off('grid:double-click', handleGridDoubleClick)
    }
  }, [addNode, updateNode, deleteNode, selectedFloorId, levels])

  return null
}

// ============================================================================
// REGISTER CUSTOM ROOM COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'custom-room', // Unique type for registry, even though it creates 'group' nodes
  nodeName: 'Custom Room',
  editorMode: 'building',
  toolName: 'custom-room',
  toolIcon: Pentagon,
  rendererPropsSchema: CustomRoomRendererPropsSchema,
  nodeEditor: CustomRoomNodeEditor,
  nodeRenderer: GroupRenderer,
})
