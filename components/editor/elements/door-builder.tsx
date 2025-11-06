'use client'

import { useEffect, useMemo, useRef } from 'react'
import { type GridEvent, useEditor, type WallSegment } from '@/hooks/use-editor'
import { useDoors, useWalls, useWindows } from '@/hooks/use-nodes'
import { validateWallElementPlacement } from '@/lib/wall-element-validation'

export function DoorBuilder() {
  const registerHandler = useEditor((state) => state.registerHandler)
  const unregisterHandler = useEditor((state) => state.unregisterHandler)
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levels = useEditor((state) => state.levels)

  // Get walls, doors, and windows for the current floor for validation
  const currentFloorWalls = useWalls(selectedFloorId || '')
  const currentFloorDoors = useDoors(selectedFloorId || '')
  const currentFloorWindows = useWindows(selectedFloorId || '')

  // Convert wall nodes to wall segments for validation
  const wallSegments = useMemo(
    (): WallSegment[] =>
      currentFloorWalls.map((node) => {
        const [x1, y1] = node.position
        const length = node.size[0]
        const x2 = x1 + Math.cos(node.rotation) * length
        const y2 = y1 + Math.sin(node.rotation) * length

        return {
          start: [x1, y1] as [number, number],
          end: [x2, y2] as [number, number],
          id: node.id,
          isHorizontal: Math.abs(node.rotation) < 0.1 || Math.abs(node.rotation - Math.PI) < 0.1,
          visible: node.visible ?? true,
          opacity: node.opacity ?? 100,
        }
      }),
    [currentFloorWalls],
  )

  // Existing doors and windows for validation
  const existingDoors = useMemo(
    () =>
      currentFloorDoors.map((node) => ({
        position: node.position,
        rotation: node.rotation,
      })),
    [currentFloorDoors],
  )

  const existingWindows = useMemo(
    () =>
      currentFloorWindows.map((node) => ({
        position: node.position,
        rotation: node.rotation,
      })),
    [currentFloorWindows],
  )

  // Track preview door state and validation data in refs
  const doorStateRef = useRef<{
    previewDoorId: string | null
    lastValidRotation: number
    lastWallId: string | null // Track current parent (wall ID or level ID)
  }>({
    previewDoorId: null,
    lastValidRotation: 0,
    lastWallId: null,
  })

  // Store validation data in refs to avoid re-registering handlers
  const validationDataRef = useRef({
    wallSegments,
    existingDoors,
    existingWindows,
  })

  // Update refs when validation data changes
  useEffect(() => {
    validationDataRef.current = {
      wallSegments,
      existingDoors,
      existingWindows,
    }
  }, [wallSegments, existingDoors, existingWindows])

  useEffect(() => {
    const handleGridEvent = (e: GridEvent) => {
      if (!selectedFloorId) return

      switch (e.type) {
        case 'click': {
          const [x, y] = e.position

          // Validate placement using ref data
          const placement = validateWallElementPlacement({
            mouseGridPosition: [x, y],
            wallSegments: validationDataRef.current.wallSegments,
            existingElements: [
              ...validationDataRef.current.existingDoors,
              ...validationDataRef.current.existingWindows,
            ],
            elementWidth: 2, // Doors are 2 cells wide
          })

          if (placement?.canPlace && placement?.nearestWall) {
            // Delete the preview before placing final door
            if (doorStateRef.current.previewDoorId) {
              deleteNode(doorStateRef.current.previewDoorId)
              doorStateRef.current.previewDoorId = null
              doorStateRef.current.lastWallId = null
            }

            // Create door node as child of the nearest wall
            const doorNode = {
              type: 'door',
              name: 'Door',
              position: placement.gridPosition,
              rotation: placement.rotation,
              size: [1, 2] as [number, number], // 1m x 2m door
              visible: true,
              opacity: 100,
              children: [],
            } as any

            // Add door to the nearest wall
            const wallId = placement.nearestWall.id
            addNode(doorNode, wallId)
          }

          break
        }
        case 'move': {
          const [x, y] = e.position

          // Combine existing doors and windows to check for conflicts
          const existingElements = [
            ...validationDataRef.current.existingDoors,
            ...validationDataRef.current.existingWindows,
          ]

          // Validate placement using ref data
          const placement = validateWallElementPlacement({
            mouseGridPosition: [x, y],
            wallSegments: validationDataRef.current.wallSegments,
            existingElements,
            elementWidth: 2, // Doors are 2 cells wide
          })

          if (!placement) {
            // No valid placement at all, delete preview
            if (doorStateRef.current.previewDoorId) {
              deleteNode(doorStateRef.current.previewDoorId)
              doorStateRef.current.previewDoorId = null
              doorStateRef.current.lastWallId = null
            }
            return
          }

          // Update last valid rotation if we have a valid rotation
          if (placement.rotation !== 0) {
            doorStateRef.current.lastValidRotation = placement.rotation
          }

          // Determine parent: wall if snapped, level if free-floating
          const currentParentId = placement.nearestWall ? placement.nearestWall.id : selectedFloorId
          const needsToMoveParent =
            doorStateRef.current.previewDoorId &&
            doorStateRef.current.lastWallId !== currentParentId

          const rotation = placement.rotation || doorStateRef.current.lastValidRotation

          // Create or update preview door
          if (doorStateRef.current.previewDoorId) {
            if (needsToMoveParent) {
              // Move to different parent: delete old preview and create new one
              deleteNode(doorStateRef.current.previewDoorId)

              const previewDoorId = addNode(
                {
                  type: 'door',
                  name: 'Door Preview',
                  position: placement.gridPosition,
                  rotation,
                  size: [1, 2] as [number, number],
                  visible: true,
                  opacity: 100,
                  preview: true,
                  canPlace: placement.canPlace,
                  children: [],
                } as any,
                currentParentId, // Parent is either wall or level
              )

              doorStateRef.current.previewDoorId = previewDoorId
              doorStateRef.current.lastWallId = currentParentId
            } else {
              // Update existing preview (same parent)
              updateNode(doorStateRef.current.previewDoorId, {
                position: placement.gridPosition,
                rotation,
                visible: true,
                canPlace: placement.canPlace,
              } as any)
            }
          } else {
            // Create initial preview door node
            const previewDoorId = addNode(
              {
                type: 'door',
                name: 'Door Preview',
                position: placement.gridPosition,
                rotation,
                size: [1, 2] as [number, number],
                visible: true,
                opacity: 100,
                preview: true,
                canPlace: placement.canPlace,
                children: [],
              } as any,
              currentParentId, // Parent is either wall or level
            )

            doorStateRef.current.previewDoorId = previewDoorId
            doorStateRef.current.lastWallId = currentParentId
          }

          break
        }
        default: {
          break
        }
      }
    }

    const handlerId = 'door-builder-handler'
    registerHandler(handlerId, handleGridEvent)

    return () => {
      unregisterHandler(handlerId)
      // Clean up preview on unmount
      if (doorStateRef.current.previewDoorId) {
        deleteNode(doorStateRef.current.previewDoorId)
        doorStateRef.current.previewDoorId = null
        doorStateRef.current.lastWallId = null
      }
    }
    // Only re-register when these core dependencies change
  }, [registerHandler, unregisterHandler, addNode, updateNode, deleteNode, selectedFloorId])

  return <></>
}
