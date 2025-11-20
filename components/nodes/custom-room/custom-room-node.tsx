'use client'

import { Pentagon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import { GroupNode } from '@/lib/scenegraph/schema/nodes/group'
import { WallNode } from '@/lib/scenegraph/schema/nodes/wall'
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
const EMPTY_LEVELS: any[] = []

export function CustomRoomNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
    return building ? building.children : EMPTY_LEVELS
  })

  // Use ref to persist values across renders without triggering re-renders
  const customRoomStateRef = useRef<{
    points: Array<[number, number]> // Points in absolute grid coordinates
    groupOrigin: [number, number] | null // Group's absolute position for calculating relative coords
    previewWallIds: string[] // Walls for placed segments
    cursorWallId: string | null // Wall from last point to cursor
    previewGroupId: string | null
    lastCursorPoint: [number, number] | null // Track last cursor position to avoid unnecessary updates
  }>({
    points: [],
    groupOrigin: null,
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
        const groupOrigin = customRoomStateRef.current.groupOrigin

        if (previewGroupId && groupOrigin) {
          // Update cursor wall to closing wall position, or delete it if 0-length
          if (cursorWallId) {
            const [x1, y1] = points[points.length - 1] // Absolute coordinates
            const [x2, y2] = points[0] // Absolute coordinates
            const dx = x2 - x1
            const dy = y2 - y1
            const length = Math.sqrt(dx * dx + dy * dy)

            if (length > 0) {
              const rotation = Math.atan2(-dy, dx)

              // Convert to group-relative coordinates
              const relX1 = x1 - groupOrigin[0]
              const relY1 = y1 - groupOrigin[1]
              const relX2 = x2 - groupOrigin[0]
              const relY2 = y2 - groupOrigin[1]

              updateNode(cursorWallId, {
                position: [relX1, relY1] as [number, number],
                size: [length, 0.2] as [number, number],
                rotation,
                start: [relX1, relY1] as [number, number],
                end: [relX2, relY2] as [number, number],
              })
            } else {
              // Delete 0-length cursor wall before committing
              deleteNode(cursorWallId)
            }
          }

          // Commit the entire group
          updateNode(previewGroupId, {
            editor: { preview: false },
          })
        }

        // Reset state
        customRoomStateRef.current.points = []
        customRoomStateRef.current.groupOrigin = null
        customRoomStateRef.current.previewWallIds = []
        customRoomStateRef.current.cursorWallId = null
        customRoomStateRef.current.previewGroupId = null
        customRoomStateRef.current.lastCursorPoint = null
      } else if (points.length === 0) {
        // First click: create preview group with cursor wall
        customRoomStateRef.current.points = [[x, y]]
        customRoomStateRef.current.groupOrigin = [x, y] // Store group's origin
        customRoomStateRef.current.lastCursorPoint = null

        // Create cursor wall (zero length initially)
        const cursorWallId = createId('wall')

        // Create preview group at [x, y]
        // Walls inside are positioned relative to this group origin
        const groupId = addNode(
          GroupNode.parse({
            type: 'group',
            name: 'Custom Room Preview',
            position: [x, y],
            visible: true,
            opacity: 100,
            editor: { preview: true },
            children: [
              WallNode.parse({
                id: cursorWallId,
                type: 'wall',
                name: 'Wall Preview Cursor',
                position: [0, 0], // Relative to group
                rotation: 0,
                size: [0, 0.2],
                start: [0, 0], // Relative to group
                end: [0, 0], // Relative to group
                editor: { preview: true },
                children: [],
              }),
            ],
          }),
          selectedFloorId,
        )

        // Update cursor wall parent
        updateNode(cursorWallId, { parentId: groupId })

        customRoomStateRef.current.cursorWallId = cursorWallId
        customRoomStateRef.current.previewGroupId = groupId
      } else {
        // Subsequent click: update cursor wall to the click position, then finalize it
        const oldCursorWallId = customRoomStateRef.current.cursorWallId
        const groupOrigin = customRoomStateRef.current.groupOrigin
        if (oldCursorWallId && groupOrigin) {
          // Calculate the final geometry for the cursor wall
          const [x1, y1] = points[points.length - 1] // Absolute coordinates
          const [x2, y2] = [x, y] // Absolute coordinates
          const dx = x2 - x1
          const dy = y2 - y1
          const length = Math.sqrt(dx * dx + dy * dy)

          // Only finalize the wall if it has non-zero length
          // (prevents adding 0-length walls when double-clicking)
          if (length > 0) {
            const rotation = Math.atan2(-dy, dx)

            // Convert to group-relative coordinates
            const relX1 = x1 - groupOrigin[0]
            const relY1 = y1 - groupOrigin[1]
            const relX2 = x2 - groupOrigin[0]
            const relY2 = y2 - groupOrigin[1]

            // Update cursor wall to final position (relative to group)
            updateNode(oldCursorWallId, {
              position: [relX1, relY1] as [number, number],
              size: [length, 0.2] as [number, number],
              rotation,
              start: [relX1, relY1] as [number, number],
              end: [relX2, relY2] as [number, number],
              name: `Wall Preview ${customRoomStateRef.current.previewWallIds.length + 1}`,
            })

            // Move it to the placed walls list
            customRoomStateRef.current.previewWallIds.push(oldCursorWallId)

            // Add the new point AFTER finalizing the old cursor wall
            const newPoints = [...points, [x, y] as [number, number]]
            customRoomStateRef.current.points = newPoints
            customRoomStateRef.current.lastCursorPoint = null

            // Create new cursor wall starting at the point we just added (relative to group)
            const newCursorWallId = addNode(
              WallNode.parse({
                type: 'wall',
                name: 'Wall Preview Cursor',
                position: [relX2, relY2],
                rotation: 0,
                size: [0, 0.2],
                start: [relX2, relY2],
                end: [relX2, relY2],
                editor: { preview: true },
                children: [],
              }),
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
      const groupOrigin = customRoomStateRef.current.groupOrigin

      if (points.length >= 1 && cursorWallId && groupOrigin) {
        let [x, y] = e.position

        // Snap to grid from last point
        ;[x, y] = calculateSnapPoint(points[points.length - 1], [x, y])

        // Only update if the cursor point has changed
        const lastCursorPoint = customRoomStateRef.current.lastCursorPoint
        if (!lastCursorPoint || lastCursorPoint[0] !== x || lastCursorPoint[1] !== y) {
          customRoomStateRef.current.lastCursorPoint = [x, y]

          // Check if hovering over the first point to close the shape
          const hoveringFirstPoint = points.length >= 3 && x === points[0][0] && y === points[0][1]

          const [x1, y1] = points[points.length - 1] // Absolute coordinates
          const [x2, y2] = hoveringFirstPoint ? points[0] : [x, y] // Absolute coordinates
          const dx = x2 - x1
          const dy = y2 - y1
          const length = Math.sqrt(dx * dx + dy * dy)
          const rotation = Math.atan2(-dy, dx)

          // Convert to group-relative coordinates
          const relX1 = x1 - groupOrigin[0]
          const relY1 = y1 - groupOrigin[1]
          const relX2 = x2 - groupOrigin[0]
          const relY2 = y2 - groupOrigin[1]

          // Update cursor wall with relative positions
          updateNode(cursorWallId, {
            position: [relX1, relY1] as [number, number],
            size: [length, 0.2] as [number, number],
            rotation,
            start: [relX1, relY1] as [number, number],
            end: [relX2, relY2] as [number, number],
            visible: true,
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
          editor: { preview: false },
        })

        // Reset state
        customRoomStateRef.current.points = []
        customRoomStateRef.current.groupOrigin = null
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
  nodeRenderer: null,
})
