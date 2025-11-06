'use client'

import { emitter, type GridEvent } from '@/events/bus'
import { useEditor, type WallSegment } from '@/hooks/use-editor'
import { useDoors, useWalls, useWindows } from '@/hooks/use-nodes'
import { validateWallElementPlacement } from '@/lib/wall-element-validation'
import { useEffect, useMemo, useRef } from 'react'

export function WindowBuilder() {
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
        const y2 = y1 - Math.sin(node.rotation) * length // Note: minus sign to match wall coordinate system

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
      currentFloorDoors.filter(door => !door.preview).map((node) => ({
        position: node.position,
        rotation: node.rotation,
      })),
    [currentFloorDoors],
  )

  const existingWindows = useMemo(
    () =>
      currentFloorWindows.filter(window => !window.preview).map((node) => ({
        position: node.position,
        rotation: node.rotation,
      })),
    [currentFloorWindows],
  )

  // Track preview window state and validation data in refs
  const windowStateRef = useRef<{
    previewWindowId: string | null
    lastValidRotation: number
    lastWallId: string | null // Track current parent (wall ID or level ID)
    lastGridPosition: [number, number] | null // Track last processed grid position
  }>({
    previewWindowId: null,
    lastValidRotation: 0,
    lastWallId: null,
    lastGridPosition: null,
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
    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position

      // Validate placement using ref data
      const placement = validateWallElementPlacement({
        mouseGridPosition: [x, y],
        wallSegments: validationDataRef.current.wallSegments,
        existingElements: [
          ...validationDataRef.current.existingDoors,
          ...validationDataRef.current.existingWindows,
        ],
        elementWidth: 2, // Windows are 2 cells wide
      })

      if (placement?.canPlace && placement?.nearestWall) {
            // Delete the preview before placing final window
            if (windowStateRef.current.previewWindowId) {
              deleteNode(windowStateRef.current.previewWindowId)
              windowStateRef.current.previewWindowId = null
              windowStateRef.current.lastWallId = null
              windowStateRef.current.lastGridPosition = null
            }

            // Create window node as child of the nearest wall
            const windowNode = {
              type: 'window',
              name: 'Window',
              position: placement.gridPosition,
              rotation: placement.rotation,
              size: [1, 1.2] as [number, number], // 1m x 1.2m window
              visible: true,
              opacity: 100,
              children: [],
            } as any

            // Add window to the nearest wall
            const wallId = placement.nearestWall.id
            addNode(windowNode, wallId)
          }
        }
    

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position

      // Only process if we're on a new grid position
      const lastGridPosition = windowStateRef.current.lastGridPosition
      if (lastGridPosition && lastGridPosition[0] === x && lastGridPosition[1] === y) {
        return
      }
      windowStateRef.current.lastGridPosition = [x, y]

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
        elementWidth: 2, // Windows are 2 cells wide
      })

      if (!placement) {
            // No valid placement at all, delete preview
            if (windowStateRef.current.previewWindowId) {
              deleteNode(windowStateRef.current.previewWindowId)
              windowStateRef.current.previewWindowId = null
              windowStateRef.current.lastWallId = null
              windowStateRef.current.lastGridPosition = null
            }
            return
          }

          // Update last valid rotation if we have a valid rotation
          if (placement.rotation !== 0) {
            windowStateRef.current.lastValidRotation = placement.rotation
          }

          // Determine parent: wall if snapped, level if free-floating
          const currentParentId = placement.nearestWall ? placement.nearestWall.id : selectedFloorId
          const needsToMoveParent =
            windowStateRef.current.previewWindowId &&
            windowStateRef.current.lastWallId !== currentParentId

          const rotation = placement.rotation || windowStateRef.current.lastValidRotation

          // Create or update preview window
          if (windowStateRef.current.previewWindowId) {
            if (needsToMoveParent) {
              // Move to different parent: delete old preview and create new one
              deleteNode(windowStateRef.current.previewWindowId)

              const previewWindowId = addNode(
                {
                  type: 'window',
                  name: 'Window Preview',
                  position: placement.gridPosition,
                  rotation,
                  size: [1, 1.2] as [number, number],
                  visible: true,
                  opacity: 100,
                  preview: true,
                  canPlace: placement.canPlace,
                  children: [],
                } as any,
                currentParentId, // Parent is either wall or level
              )

              windowStateRef.current.previewWindowId = previewWindowId
              windowStateRef.current.lastWallId = currentParentId
            } else {
              // Update existing preview (same parent)
              updateNode(windowStateRef.current.previewWindowId, {
                position: placement.gridPosition,
                rotation,
                visible: true,
                canPlace: placement.canPlace,
              } as any)
            }
          } else {
            // Create initial preview window node
            const previewWindowId = addNode(
              {
                type: 'window',
                name: 'Window Preview',
                position: placement.gridPosition,
                rotation,
                size: [1, 1.2] as [number, number],
                visible: true,
                opacity: 100,
                preview: true,
                canPlace: placement.canPlace,
                children: [],
              } as any,
              currentParentId, // Parent is either wall or level
            )

            windowStateRef.current.previewWindowId = previewWindowId
            windowStateRef.current.lastWallId = currentParentId
          }
        }
      
    

    // Register event listeners
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)

    // Cleanup event listeners
    return () => {
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)

      // Clean up preview on unmount
      if (windowStateRef.current.previewWindowId) {
        deleteNode(windowStateRef.current.previewWindowId)
        windowStateRef.current.previewWindowId = null
        windowStateRef.current.lastWallId = null
        windowStateRef.current.lastGridPosition = null
      }
    }
  }, [addNode, updateNode, deleteNode, selectedFloorId])

  return <></>
}
