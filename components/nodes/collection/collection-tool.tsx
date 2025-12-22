'use client'

import { Hexagon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'

// ============================================================================
// COLLECTION TOOL EDITOR
// ============================================================================

/**
 * Collection tool editor component
 * Uses multi-point polygon drawing to create collection zones
 */
export function CollectionToolEditor() {
  const addCollection = useEditor((state) => state.addCollection)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const setActiveTool = useEditor((state) => state.setActiveTool)

  // Use ref to persist state across renders
  const collectionStateRef = useRef<{
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

      const points = collectionStateRef.current.points
      let [x, y] = e.position

      // Snap to grid from last point if we have points
      if (points.length > 0) {
        ;[x, y] = calculateSnapPoint(points[points.length - 1], [x, y])
      }

      // Check if clicking on the first point to close the shape
      if (points.length >= 3 && x === points[0][0] && y === points[0][1]) {
        // Create the collection with the polygon
        const collectionName = `Zone ${Date.now().toString(36).slice(-4)}`
        addCollection(collectionName, selectedFloorId, points)

        // Reset state
        collectionStateRef.current.points = []
        collectionStateRef.current.lastCursorPoint = null

        // Emit event for preview cleanup
        emitter.emit('collection:preview', { points: [] })

        // Deactivate tool after creating collection
        setActiveTool(null)
      } else {
        // Add point to polygon
        const newPoints = [...points, [x, y] as [number, number]]
        collectionStateRef.current.points = newPoints
        collectionStateRef.current.lastCursorPoint = null

        // Emit event for preview
        emitter.emit('collection:preview', { points: newPoints, cursorPoint: null })
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const points = collectionStateRef.current.points
      if (points.length === 0) return

      let [x, y] = e.position

      // Snap to grid from last point
      ;[x, y] = calculateSnapPoint(points[points.length - 1], [x, y])

      // Only update if cursor point changed
      const lastCursorPoint = collectionStateRef.current.lastCursorPoint
      if (!lastCursorPoint || lastCursorPoint[0] !== x || lastCursorPoint[1] !== y) {
        collectionStateRef.current.lastCursorPoint = [x, y]

        // Emit event for preview with cursor point
        emitter.emit('collection:preview', { points, cursorPoint: [x, y] })
      }
    }

    const handleGridDoubleClick = (_e: GridEvent) => {
      if (!selectedFloorId) return

      const points = collectionStateRef.current.points

      // Need at least 3 points to form a polygon
      if (points.length >= 3) {
        // Create the collection with the polygon
        const collectionName = `Zone ${Date.now().toString(36).slice(-4)}`
        addCollection(collectionName, selectedFloorId, points)

        // Reset state
        collectionStateRef.current.points = []
        collectionStateRef.current.lastCursorPoint = null

        // Emit event for preview cleanup
        emitter.emit('collection:preview', { points: [] })

        // Deactivate tool after creating collection
        setActiveTool(null)
      }
    }

    const handleToolCancel = () => {
      // Cancel if we've started drawing
      if (collectionStateRef.current.points.length > 0) {
        collectionStateRef.current.points = []
        collectionStateRef.current.lastCursorPoint = null

        // Emit event for preview cleanup
        emitter.emit('collection:preview', { points: [] })
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
      emitter.emit('collection:preview', { points: [] })
    }
  }, [addCollection, selectedFloorId, setActiveTool])

  return null
}

// ============================================================================
// REGISTER COLLECTION COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'collection',
  nodeName: 'Zone',
  editorMode: 'building',
  toolName: 'collection',
  toolIcon: Hexagon,
  schema: undefined, // Not a node, just a tool that creates collections
  nodeEditor: CollectionToolEditor,
  nodeRenderer: null,
})
