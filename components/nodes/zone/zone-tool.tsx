'use client'

import { Hexagon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'

// ============================================================================
// ZONE TOOL EDITOR
// ============================================================================

/**
 * Zone tool editor component
 * Uses multi-point polygon drawing to create zones
 */
export function ZoneToolEditor() {
  const addZone = useEditor((state) => state.addZone)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const setActiveTool = useEditor((state) => state.setActiveTool)

  // Use ref to persist state across renders
  const zoneStateRef = useRef<{
    points: Array<[number, number]>
    lastCursorPoint: [number, number] | null
  }>({
    points: [],
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

      const points = zoneStateRef.current.points
      let [x, y] = e.position

      // Snap to grid from last point if we have points
      if (points.length > 0) {
        ;[x, y] = calculateSnapPoint(points[points.length - 1], [x, y])
      }

      // Check if clicking on the first point to close the shape
      if (points.length >= 3 && x === points[0][0] && y === points[0][1]) {
        // Create the zone with the polygon
        const zoneName = `Zone ${Date.now().toString(36).slice(-4)}`
        addZone(zoneName, selectedFloorId, points)

        // Reset state
        zoneStateRef.current.points = []
        zoneStateRef.current.lastCursorPoint = null

        // Emit event for preview cleanup
        emitter.emit('zone:preview', { points: [] })

        // Deactivate tool after creating zone
        setActiveTool(null)
      } else {
        // Add point to polygon
        const newPoints = [...points, [x, y] as [number, number]]
        zoneStateRef.current.points = newPoints
        zoneStateRef.current.lastCursorPoint = null

        // Emit event for preview
        emitter.emit('zone:preview', { points: newPoints, cursorPoint: null })
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const points = zoneStateRef.current.points
      if (points.length === 0) return

      let [x, y] = e.position

      // Snap to grid from last point
      ;[x, y] = calculateSnapPoint(points[points.length - 1], [x, y])

      // Only update if cursor point changed
      const lastCursorPoint = zoneStateRef.current.lastCursorPoint
      if (!lastCursorPoint || lastCursorPoint[0] !== x || lastCursorPoint[1] !== y) {
        zoneStateRef.current.lastCursorPoint = [x, y]

        // Emit event for preview with cursor point
        emitter.emit('zone:preview', { points, cursorPoint: [x, y] })
      }
    }

    const handleGridDoubleClick = (_e: GridEvent) => {
      if (!selectedFloorId) return

      const points = zoneStateRef.current.points

      // Need at least 3 points to form a polygon
      if (points.length >= 3) {
        // Create the zone with the polygon
        const zoneName = `Zone ${Date.now().toString(36).slice(-4)}`
        addZone(zoneName, selectedFloorId, points)

        // Reset state
        zoneStateRef.current.points = []
        zoneStateRef.current.lastCursorPoint = null

        // Emit event for preview cleanup
        emitter.emit('zone:preview', { points: [] })

        // Deactivate tool after creating zone
        setActiveTool(null)
      }
    }

    const handleToolCancel = () => {
      // Cancel if we've started drawing
      if (zoneStateRef.current.points.length > 0) {
        zoneStateRef.current.points = []
        zoneStateRef.current.lastCursorPoint = null

        // Emit event for preview cleanup
        emitter.emit('zone:preview', { points: [] })
      }
    }

    // Register event listeners
    emitter.on('grid:click', handleGridClick)
    emitter.on('grid:move', handleGridMove)
    emitter.on('grid:double-click', handleGridDoubleClick)
    emitter.on('tool:cancel', handleToolCancel)

    // Cleanup event listeners
    return () => {
      emitter.off('grid:click', handleGridClick)
      emitter.off('grid:move', handleGridMove)
      emitter.off('grid:double-click', handleGridDoubleClick)
      emitter.off('tool:cancel', handleToolCancel)

      // Also cleanup preview on unmount
      emitter.emit('zone:preview', { points: [] })
    }
  }, [addZone, selectedFloorId, setActiveTool])

  return null
}

// ============================================================================
// REGISTER ZONE COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'zone',
  nodeName: 'Zone',
  editorMode: 'building',
  toolName: 'zone',
  toolIcon: Hexagon,
  schema: undefined, // Not a node, just a tool that creates zones
  nodeEditor: ZoneToolEditor,
  nodeRenderer: null,
})
