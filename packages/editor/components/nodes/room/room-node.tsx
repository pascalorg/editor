'use client'

import { BoxSelect } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { emitter, type GridEvent } from '@pascal/core/events'
import { useEditor } from '@/hooks/use-editor'
import { checkWallsOverlap, getAllWallsOnLevel } from '@/lib/geometry/wall-overlap'
import { registerComponent } from '@/lib/nodes/registry'
import { GroupNode } from '@pascal/core/scenegraph/schema/nodes/group'
import { WallNode } from '@pascal/core/scenegraph/schema/nodes/wall'
import { createId } from '@/lib/utils'

// ============================================================================
// ROOM NODE EDITOR
// ============================================================================

/**
 * Room node editor component
 * Uses useEditor hooks directly to manage room creation via two-click area selection
 */
const EMPTY_LEVELS: any[] = []

export function RoomNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
    return building ? building.children : EMPTY_LEVELS
  })

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
            (child: any) => child.type === 'group' && (child as any).groupType === 'room',
          ) || []
        const roomNumber = existingRooms.length + 1

        // Create preview room group with 4 walls
        // Room will be positioned at the start point with zero size initially
        // Pre-generate wall IDs so we can update their parent after the group is created
        const topWallId = createId('wall')
        const bottomWallId = createId('wall')
        const leftWallId = createId('wall')
        const rightWallId = createId('wall')

        const previewRoomId = addNode(
          GroupNode.parse({
            type: 'group',
            name: `Room ${roomNumber} Preview`,
            position: [x, y], // Room position (bottom-left corner)
            rotation: 0,
            visible: true,
            opacity: 100,
            editor: { preview: true },
            children: [
              // Bottom wall (relative position [0, 0])
              WallNode.parse({
                id: bottomWallId,
                type: 'wall',
                name: 'Wall Preview Bottom',
                position: [0, 0], // RELATIVE to room
                rotation: 0,
                size: [0, 0.2],
                start: [0, 0], // RELATIVE to room
                end: [0, 0],
                visible: true,
                opacity: 100,
                editor: { preview: true },
                children: [],
              }),
              // Right wall (relative position [0, 0])
              WallNode.parse({
                id: rightWallId,
                type: 'wall',
                name: 'Wall Preview Right',
                position: [0, 0], // RELATIVE to room
                rotation: 0,
                size: [0, 0.2],
                start: [0, 0], // RELATIVE to room
                end: [0, 0],
                visible: true,
                opacity: 100,
                editor: { preview: true },
                children: [],
              }),
              // Top wall (relative position [0, 0])
              WallNode.parse({
                id: topWallId,
                type: 'wall',
                name: 'Wall Preview Top',
                position: [0, 0], // RELATIVE to room
                rotation: 0,
                size: [0, 0.2],
                start: [0, 0], // RELATIVE to room
                end: [0, 0],
                visible: true,
                opacity: 100,
                editor: { preview: true },
                children: [],
              }),
              // Left wall (relative position [0, 0])
              WallNode.parse({
                id: leftWallId,
                type: 'wall',
                name: 'Wall Preview Left',
                position: [0, 0], // RELATIVE to room
                rotation: 0,
                size: [0, 0.2],
                start: [0, 0], // RELATIVE to room
                end: [0, 0],
                visible: true,
                opacity: 100,
                editor: { preview: true },
                children: [],
              }),
            ],
          }),
          selectedFloorId,
        )

        // Now update each wall's parent to the actual group ID returned by addNode
        updateNode(topWallId, { parentId: previewRoomId })
        updateNode(bottomWallId, { parentId: previewRoomId })
        updateNode(leftWallId, { parentId: previewRoomId })
        updateNode(rightWallId, { parentId: previewRoomId })

        roomStateRef.current.previewRoomId = previewRoomId
      } else {
        // Second click: commit or delete the preview room based on canPlace
        const previewRoomId = roomStateRef.current.previewRoomId

        if (previewRoomId) {
          // Get the room node to check if it can be placed
          const currentLevel = levels.find((l) => l.id === selectedFloorId)
          const roomNode = currentLevel?.children.find((child: any) => child.id === previewRoomId)

          if (roomNode && 'canPlace' in roomNode && roomNode.canPlace === false) {
            // Room is invalid (too small), delete it
            deleteNode(previewRoomId)
          } else {
            // Room is valid, commit the preview by setting preview: false
            updateNode(previewRoomId, { editor: { preview: false } })
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

          // Calculate room position (bottom-left corner) and size
          const roomX = Math.min(x1, x2)
          const roomY = Math.min(y1, y2)
          const roomWidth = Math.abs(x2 - x1)
          const roomHeight = Math.abs(y2 - y1)

          // Room can only be placed if both width and height are at least 1 grid unit
          // This ensures walls don't overlap (e.g., when width=0, left and right walls would be at same position)
          let canPlace = roomWidth >= 1 && roomHeight >= 1

          // Check for overlap with existing walls on the same level
          if (canPlace) {
            const currentLevel = levels.find((l) => l.id === selectedFloorId)
            if (currentLevel?.children) {
              // Get all existing walls, excluding walls from our preview room
              const existingWalls = getAllWallsOnLevel(currentLevel.children, previewRoomId)

              // Define the 4 walls of the room in absolute coordinates
              const roomWalls = [
                // Bottom wall: (roomX, roomY) -> (roomX + roomWidth, roomY)
                { x1: roomX, y1: roomY, x2: roomX + roomWidth, y2: roomY },
                // Right wall: (roomX + roomWidth, roomY) -> (roomX + roomWidth, roomY + roomHeight)
                { x1: roomX + roomWidth, y1: roomY, x2: roomX + roomWidth, y2: roomY + roomHeight },
                // Top wall: (roomX + roomWidth, roomY + roomHeight) -> (roomX, roomY + roomHeight)
                { x1: roomX + roomWidth, y1: roomY + roomHeight, x2: roomX, y2: roomY + roomHeight },
                // Left wall: (roomX, roomY + roomHeight) -> (roomX, roomY)
                { x1: roomX, y1: roomY + roomHeight, x2: roomX, y2: roomY },
              ]

              if (checkWallsOverlap(roomWalls, existingWalls)) {
                canPlace = false
              }
            }
          }

          // Update room group with position and size
          updateNode(previewRoomId, {
            position: [roomX, roomY] as [number, number],
            size: [roomWidth, roomHeight] as [number, number],
            editor: { canPlace, preview: true },
          })

          // Get the room node and update its walls with RELATIVE positions
          const currentLevel = levels.find((l) => l.id === selectedFloorId)
          const roomNode = currentLevel?.children.find((child: any) => child.id === previewRoomId)

          if (roomNode && 'children' in roomNode && roomNode.children.length === 4) {
            const [bottomWall, rightWall, topWall, leftWall] = roomNode.children

            // All walls inherit the room's canPlace status since walls overlapping means the room is invalid
            // Bottom wall: (0,0) -> (roomWidth,0) - horizontal, going right
            const bottomRotation = Math.atan2(0, roomWidth)
            updateNode(bottomWall.id, {
              position: [0, 0] as [number, number], // RELATIVE to room
              size: [roomWidth, 0.2] as [number, number],
              rotation: bottomRotation,
              start: [0, 0], // RELATIVE to room
              end: [roomWidth, 0],
              editor: { canPlace, preview: true },
            })

            // Right wall: (roomWidth,0) -> (roomWidth,roomHeight) - vertical, going up
            const rightRotation = Math.atan2(-roomHeight, 0)
            updateNode(rightWall.id, {
              position: [roomWidth, 0] as [number, number], // RELATIVE to room
              size: [roomHeight, 0.2] as [number, number],
              rotation: rightRotation,
              start: [roomWidth, 0], // RELATIVE to room
              end: [roomWidth, roomHeight],
              editor: { canPlace, preview: true },
            })

            // Top wall: (roomWidth,roomHeight) -> (0,roomHeight) - horizontal, going left
            const topRotation = Math.atan2(0, -roomWidth)
            updateNode(topWall.id, {
              position: [roomWidth, roomHeight] as [number, number], // RELATIVE to room
              size: [roomWidth, 0.2] as [number, number],
              rotation: topRotation,
              start: [roomWidth, roomHeight], // RELATIVE to room
              end: [0, roomHeight],
              editor: { canPlace, preview: true },
            })

            // Left wall: (0,roomHeight) -> (0,0) - vertical, going down
            const leftRotation = Math.atan2(roomHeight, 0)
            updateNode(leftWall.id, {
              position: [0, roomHeight] as [number, number], // RELATIVE to room
              size: [roomHeight, 0.2] as [number, number],
              rotation: leftRotation,
              start: [0, roomHeight], // RELATIVE to room
              end: [0, 0],
              editor: { canPlace, preview: true },
            })
          }
        }
      }
    }

    const handleToolCancel = () => {
      // Only cancel if we've started drawing (first click done)
      if (roomStateRef.current.startPoint !== null && roomStateRef.current.previewRoomId) {
        deleteNode(roomStateRef.current.previewRoomId)
        roomStateRef.current.startPoint = null
        roomStateRef.current.previewRoomId = null
        roomStateRef.current.lastEndPoint = null
      }
    }

    // Register event listeners
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)
    emitter.on('tool:cancel', handleToolCancel)

    // Cleanup event listeners
    return () => {
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)
      emitter.off('tool:cancel', handleToolCancel)
    }
  }, [addNode, updateNode, deleteNode, selectedFloorId, levels])

  return null
}

// ============================================================================
// REGISTER ROOM COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'room', // Unique type for registry, even though it creates 'group' nodes
  nodeName: 'Room',
  editorMode: 'building',
  toolName: 'room',
  toolIcon: BoxSelect,
  schema: GroupNode,
  nodeEditor: RoomNodeEditor,
  nodeRenderer: null,
})
