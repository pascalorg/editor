'use client'

import { Minus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { getAllWallsOnLevel, wallSegmentsOverlap } from '@/lib/geometry/wall-overlap'
import { registerComponent } from '@/lib/nodes/registry'
import { WallNode } from '@/lib/scenegraph/schema/nodes/wall'
import { WallRenderer } from './wall-renderer'

// ============================================================================
// WALL NODE EDITOR
// ============================================================================

/**
 * Wall node editor component
 * Uses useEditor hooks directly to manage wall creation
 */
const EMPTY_LEVELS: any[] = []

export function WallNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
    return building ? building.children : EMPTY_LEVELS
  })

  // Use ref to persist values across renders without triggering re-renders
  const wallStateRef = useRef<{
    startPoint: [number, number] | null
    previewWallId: string | null
    lastEndPoint: [number, number] | null
  }>({
    startPoint: null,
    previewWallId: null,
    lastEndPoint: null,
  })

  useEffect(() => {
    const calculateWallEndPoint = (x: number, y: number): [number, number] => {
      const wallStartPoint = wallStateRef.current.startPoint
      if (wallStartPoint === null) {
        return [x, y]
      }
      const [x1, y1] = wallStartPoint

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

      const [x, y] = e.position
      if (wallStateRef.current.startPoint === null) {
        // First click: set start point and create preview node
        wallStateRef.current.startPoint = [x, y]
        wallStateRef.current.lastEndPoint = null // Reset last end point

        // Create preview wall node
        const previewWallId = addNode(
          WallNode.parse({
            name: 'Wall Preview',
            position: [x, y],
            rotation: 0,
            size: [0, 0.2], // Zero length initially
            start: [x, y],
            end: [x, y],
            editor: { preview: true },
          }),
          selectedFloorId,
        )

        wallStateRef.current.previewWallId = previewWallId
      } else {
        // Second click: commit or delete the preview wall based on canPlace
        const previewWallId = wallStateRef.current.previewWallId

        if (previewWallId) {
          // Get the wall node to check if it can be placed
          const currentLevel = levels.find((l) => l.id === selectedFloorId)
          const wallNode = currentLevel?.children.find((child: any) => child.id === previewWallId)

          if (wallNode && 'canPlace' in wallNode && wallNode.canPlace === false) {
            // Wall is invalid (overlapping or zero length), delete it
            deleteNode(previewWallId)
          } else {
            // Wall is valid, commit the preview by setting preview: false
            updateNode(previewWallId, { editor: { preview: false } })
          }
        }

        // Reset state
        wallStateRef.current.startPoint = null
        wallStateRef.current.previewWallId = null
        wallStateRef.current.lastEndPoint = null
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position
      const wallStartPoint = wallStateRef.current.startPoint
      const previewWallId = wallStateRef.current.previewWallId

      if (wallStartPoint !== null && previewWallId) {
        const [x1, y1] = wallStartPoint
        const [x2, y2] = calculateWallEndPoint(x, y)

        // Only update if the end point has changed
        const lastEndPoint = wallStateRef.current.lastEndPoint
        if (!lastEndPoint || lastEndPoint[0] !== x2 || lastEndPoint[1] !== y2) {
          wallStateRef.current.lastEndPoint = [x2, y2]

          // Calculate new wall properties
          const dx = x2 - x1
          const dy = y2 - y1
          const length = Math.sqrt(dx * dx + dy * dy)
          const rotation = Math.atan2(-dy, dx) // Negate dy to match 3D z-axis direction

          // Wall can only be placed if it has non-zero length
          let canPlace = length >= 1

          // Check for overlap with existing walls on the same level (including walls inside rooms)
          if (canPlace) {
            const currentLevel = levels.find((l) => l.id === selectedFloorId)
            if (currentLevel?.children) {
              // Get all walls on the level, excluding walls from our preview
              const existingWalls = getAllWallsOnLevel(currentLevel.children, previewWallId)

              // Check if new wall overlaps with any existing wall
              for (const existingWall of existingWalls) {
                if (wallSegmentsOverlap({ x1, y1, x2, y2 }, existingWall)) {
                  canPlace = false
                  break
                }
              }
            }
          }

          // Update preview wall
          updateNode(previewWallId, {
            size: [length, 0.2] as [number, number],
            rotation,
            start: [x1, y1],
            end: [x2, y2],
            editor: { canPlace, preview: true },
          })
        }
      }
    }

    const handleToolCancel = () => {
      // Only cancel if we've started drawing (first click done)
      if (wallStateRef.current.startPoint !== null && wallStateRef.current.previewWallId) {
        deleteNode(wallStateRef.current.previewWallId)
        wallStateRef.current.startPoint = null
        wallStateRef.current.previewWallId = null
        wallStateRef.current.lastEndPoint = null
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
// REGISTER WALL COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'wall',
  nodeName: 'Wall',
  editorMode: 'building',
  toolName: 'wall',
  toolIcon: Minus,
  schema: WallNode,
  nodeEditor: WallNodeEditor,
  nodeRenderer: WallRenderer,
})
