'use client'

import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { createId } from '@/lib/utils'
import { useEffect, useRef } from 'react'

export function RoomBuilder() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levels = useEditor((state) => state.levels)

  // Use ref to persist values across renders without triggering re-renders
  const roomStateRef = useRef<{
    startPoint: [number, number] | null
    previewRoomId: string | null
    lastEndPoint: [number, number] | null
  }>({
    startPoint: null,
    previewRoomId: null,
    lastEndPoint: null,
  })

  useEffect(() => {
    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position
      if (roomStateRef.current.startPoint === null) {
            // First click: set start corner and create preview room
            roomStateRef.current.startPoint = [x, y]
            roomStateRef.current.lastEndPoint = null

            // Count existing rooms to auto-increment the number
            const currentLevel = levels.find((l) => l.id === selectedFloorId)
            const existingRooms =
              currentLevel?.children.filter(
                (child) => child.type === 'group' && (child as any).groupType === 'room',
              ) || []
            const roomNumber = existingRooms.length + 1

            // Create preview room group with 4 walls
            // Pre-generate wall IDs so we can update their parent after the group is created
            const topWallId = createId('wall')
            const bottomWallId = createId('wall')
            const leftWallId = createId('wall')
            const rightWallId = createId('wall')

            const previewRoomId = addNode(
              {
                type: 'group',
                name: `Room ${roomNumber} Preview`,
                groupType: 'room',
                visible: true,
                opacity: 100,
                preview: true, // Mark as preview
                children: [
                  // Top wall
                  {
                    id: topWallId,
                    type: 'wall',
                    name: 'Wall Preview Top',
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
                  // Bottom wall
                  {
                    id: bottomWallId,
                    type: 'wall',
                    name: 'Wall Preview Bottom',
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
                  // Left wall
                  {
                    id: leftWallId,
                    type: 'wall',
                    name: 'Wall Preview Left',
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
                  // Right wall
                  {
                    id: rightWallId,
                    type: 'wall',
                    name: 'Wall Preview Right',
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

            // Now update each wall's parent to the actual group ID returned by addNode
            updateNode(topWallId, { parent: previewRoomId })
            updateNode(bottomWallId, { parent: previewRoomId })
            updateNode(leftWallId, { parent: previewRoomId })
            updateNode(rightWallId, { parent: previewRoomId })

            roomStateRef.current.previewRoomId = previewRoomId
          } else {
            // Second click: commit the preview room
            const previewRoomId = roomStateRef.current.previewRoomId

            if (previewRoomId) {
              // Find the room node to get its children
              const currentLevel = levels.find((l) => l.id === selectedFloorId)
              const roomNode = currentLevel?.children.find((child) => child.id === previewRoomId)

              // Update the room group to remove preview flag
              updateNode(previewRoomId, {
                preview: false as any,
                name: roomNode?.name.replace(' Preview', '') || 'Room',
              })

              // Update all child walls to remove preview flag
              if (roomNode && 'children' in roomNode) {
                roomNode.children.forEach((wall) => {
                  updateNode(wall.id, {
                    preview: false as any,
                    name: wall.name.replace(' Preview', '').replace('Preview ', ''),
                  })
                })
              }
            }

            // Reset state
            roomStateRef.current.startPoint = null
            roomStateRef.current.previewRoomId = null
            roomStateRef.current.lastEndPoint = null
          }
        }
    

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position
      const roomStartPoint = roomStateRef.current.startPoint
      const previewRoomId = roomStateRef.current.previewRoomId

      if (roomStartPoint !== null && previewRoomId) {
            const [x1, y1] = roomStartPoint
            const [x2, y2] = [x, y]

            // Only update if the end point has changed
            const lastEndPoint = roomStateRef.current.lastEndPoint
            if (!lastEndPoint || lastEndPoint[0] !== x2 || lastEndPoint[1] !== y2) {
              roomStateRef.current.lastEndPoint = [x2, y2]

              // Get the room node and update its walls
              const currentLevel = levels.find((l) => l.id === selectedFloorId)
              const roomNode = currentLevel?.children.find((child) => child.id === previewRoomId)

              if (roomNode && 'children' in roomNode && roomNode.children.length === 4) {
                const [topWall, bottomWall, leftWall, rightWall] = roomNode.children

                // Update Top wall (x1,y2 -> x2,y2)
                const topDx = x2 - x1
                const topLength = Math.abs(topDx)
                const topRotation = Math.atan2(0, topDx)
                updateNode(topWall.id, {
                  position: [x1, y2],
                  size: [topLength, 0.2],
                  rotation: topRotation,
                  start: { x: x1, z: y2 },
                  end: { x: x2, z: y2 },
                })

                // Update Bottom wall (x1,y1 -> x2,y1)
                const bottomDx = x2 - x1
                const bottomLength = Math.abs(bottomDx)
                const bottomRotation = Math.atan2(0, bottomDx)
                updateNode(bottomWall.id, {
                  position: [x1, y1],
                  size: [bottomLength, 0.2],
                  rotation: bottomRotation,
                  start: { x: x1, z: y1 },
                  end: { x: x2, z: y1 },
                })

                // Update Left wall (x1,y1 -> x1,y2)
                const leftDy = y2 - y1
                const leftLength = Math.abs(leftDy)
                const leftRotation = Math.atan2(-leftDy, 0)
                updateNode(leftWall.id, {
                  position: [x1, y1] as [number, number],
                  size: [leftLength, 0.2] as [number, number],
                  rotation: leftRotation,
                  start: { x: x1, z: y1 } as any,
                  end: { x: x1, z: y2 } as any,
                })

                // Update Right wall (x2,y1 -> x2,y2)
                const rightDy = y2 - y1
                const rightLength = Math.abs(rightDy)
                const rightRotation = Math.atan2(-rightDy, 0)
                updateNode(rightWall.id, {
                  position: [x2, y1],
                  size: [rightLength, 0.2],
                  rotation: rightRotation,
                  start: { x: x2, z: y1 },
                  end: { x: x2, z: y2 },
                })
              }
            }
          }
        }
      
    

    // Register event listeners
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)

    // Cleanup event listeners
    return () => {
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)
    }
  }, [addNode, updateNode, selectedFloorId, levels])

  return <></>
}
