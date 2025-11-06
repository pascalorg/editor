'use client'

import { useEffect, useRef } from 'react'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { createId } from '@/lib/utils'

export function CustomRoomBuilder() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
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
        const previewWallIds = customRoomStateRef.current.previewWallIds
        const cursorWallId = customRoomStateRef.current.cursorWallId

        if (previewGroupId) {
          // Count existing rooms to auto-increment the number
          const currentLevel = levels.find((l) => l.id === selectedFloorId)
          const existingRooms =
            currentLevel?.children.filter(
              (child) => child.type === 'group' && (child as any).groupType === 'room',
            ) || []
          const roomNumber = existingRooms.length + 1

          // Update group to remove preview
          updateNode(previewGroupId, {
            preview: false as any,
            name: `Room ${roomNumber}`,
          })

          // Update all placed walls to remove preview
          previewWallIds.forEach((wallId, i) => {
            updateNode(wallId, {
              preview: false as any,
              name: `Wall ${i + 1}`,
            })
          })

          // Convert cursor wall to closing wall and remove preview
          if (cursorWallId) {
            const [x1, y1] = points[points.length - 1]
            const [x2, y2] = points[0]
            const dx = x2 - x1
            const dy = y2 - y1
            const length = Math.sqrt(dx * dx + dy * dy)
            const rotation = Math.atan2(-dy, dx)

            updateNode(cursorWallId, {
              preview: false as any,
              name: `Wall ${points.length}`,
              position: [x1, y1] as [number, number],
              rotation,
              size: [length, 0.2] as [number, number],
              start: { x: x1, z: y1 } as any,
              end: { x: x2, z: y2 } as any,
            })
          }
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
        }

        // Add the new point AFTER finalizing the old cursor wall
        const newPoints = [...points, [x, y] as [number, number]]
        customRoomStateRef.current.points = newPoints
        customRoomStateRef.current.lastCursorPoint = null

        // Create new cursor wall starting at the point we just added
        // Note: addNode generates its own ID, so we need to capture the returned ID
        const newCursorWallId = addNode(
          {
            type: 'wall',
            name: 'Wall Preview Cursor',
            position: [x, y] as [number, number], // Start at the new point
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
      const previewWallIds = customRoomStateRef.current.previewWallIds
      const cursorWallId = customRoomStateRef.current.cursorWallId

      if (points.length >= 2 && previewGroupId) {
        // Count existing rooms to auto-increment the number
        const currentLevel = levels.find((l) => l.id === selectedFloorId)
        const existingRooms =
          currentLevel?.children.filter(
            (child) => child.type === 'group' && (child as any).groupType === 'room',
          ) || []
        const roomNumber = existingRooms.length + 1

        // Update group to remove preview
        updateNode(previewGroupId, {
          preview: false as any,
          name: `Room ${roomNumber}`,
        })

        // Update all placed walls to remove preview
        previewWallIds.forEach((wallId, i) => {
          updateNode(wallId, {
            preview: false as any,
            name: `Wall ${i + 1}`,
          })
        })

        // Also update cursor wall to remove preview (it becomes the last wall in an open polygon)
        if (cursorWallId) {
          updateNode(cursorWallId, {
            preview: false as any,
            name: `Wall ${previewWallIds.length + 1}`,
          })
        }

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
  }, [addNode, updateNode, selectedFloorId, levels])

  return <></>
}
