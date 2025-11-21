'use client'

import { Minus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
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
export function WallNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

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
          {
            type: 'wall',
            name: 'Wall Preview',
            position: [x, y] as [number, number],
            rotation: 0,
            size: [0, 0.2] as [number, number], // Zero length initially
            start: { x, z: y },
            end: { x, z: y },
            visible: true,
            opacity: 100,
            editor: { preview: true },
            children: [],
          } as any,
          selectedFloorId,
        )

        wallStateRef.current.previewWallId = previewWallId
      } else {
        // Second click: commit the preview wall
        const previewWallId = wallStateRef.current.previewWallId

        if (previewWallId) {
          // Commit the preview by setting preview: false (useEditor handles the conversion)
          updateNode(previewWallId, { editor: { preview: false } })
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

          // Update preview wall
          updateNode(previewWallId, {
            size: [length, 0.2] as [number, number],
            rotation,
            start: [x1, y1],
            end: [x2, y2],
          })
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
  }, [addNode, updateNode, selectedFloorId])

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
