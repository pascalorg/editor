'use client'

import { RectangleHorizontal } from 'lucide-react'
import { useEffect } from 'react'
import { z } from 'zod'
import { emitter, type GridEvent, type WallEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import { WindowNode } from '@/lib/scenegraph/schema/nodes/window'
import { canPlaceGridItemOnWall } from '@/lib/utils'
import { WindowRenderer } from './window-renderer'

// ============================================================================
// WINDOW NODE EDITOR
// ============================================================================

/**
 * Window node editor component
 * Handles placing windows on walls via wall events
 */
export function WindowNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  useEffect(() => {
    if (!selectedFloorId) return // Only register events if a floor is selected

    let ignoreGridMove = false
    let previewWindow: WindowNode | null = null
    let lastPosition: [number, number] | null = null
    let lastRotation = 0
    let canPlace = false

    const handleWallClick = (e: WallEvent) => {
      if (previewWindow && canPlace) {
        // Commit the preview by setting preview: false (useEditor handles the conversion)
        updateNode(previewWindow.id, { editor: { preview: false } })

        previewWindow = null
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (ignoreGridMove) {
        return
      }
      if (lastPosition && lastPosition[0] === e.position[0] && lastPosition[1] === e.position[1]) {
        return // Avoid computing for same position
      }

      const [x, y] = e.position
      lastPosition = [x, y]
      canPlace = false
      if (previewWindow) {
        previewWindow.position = [x, y]
        previewWindow.rotation = lastRotation

        updateNode(previewWindow.id, previewWindow)
      } else {
        const windowData = WindowNode.parse({
          type: 'window',
          name: 'Window Preview',
          position: [x, y],
          rotation: lastRotation,
          size: [1, 1.2],
          height: 1,
          editor: { canPlace, preview: true },
        })
        previewWindow = windowData as WindowNode
        previewWindow.id = addNode(previewWindow, selectedFloorId) as WindowNode['id']
      }
    }

    const handleWallEnter = (e: WallEvent) => {
      if (previewWindow) {
        deleteNode(previewWindow.id)
      }
      ignoreGridMove = true
      lastRotation = e.node.rotation

      // gridPosition is already in wall's local coordinate system
      const localPos: [number, number] = [e.gridPosition.x, e.gridPosition.z]

      const windowData = WindowNode.parse({
        parentId: e.node.id,
        type: 'window',
        name: 'Window Preview',
        position: localPos, // Position RELATIVE to wall (already in wall-local coords)
        rotation: 0, // Rotation relative to wall (always 0 since window aligns with wall)
        size: [1, 1.2],
        height: 1,
        editor: { canPlace, preview: true },
      })
      previewWindow = windowData as WindowNode
      canPlace = canPlaceGridItemOnWall(e.node, previewWindow, 2)
      previewWindow.editor = { ...previewWindow.editor, canPlace }
      previewWindow.id = addNode(previewWindow, e.node.id) as WindowNode['id'] // Parent is the wall
    }

    const handleWallMove = (e: WallEvent) => {
      if (
        lastPosition &&
        lastPosition[0] === e.gridPosition.x &&
        lastPosition[1] === e.gridPosition.z
      ) {
        return // Avoid computing for same position
      }

      ignoreGridMove = true
      if (previewWindow && e.node.id !== previewWindow.parentId) {
        // Wall changed, remove old preview
        deleteNode(previewWindow.id)
        previewWindow = null
      }
      lastPosition = [e.gridPosition.x, e.gridPosition.z]

      // gridPosition is already in wall's local coordinate system
      const localPos: [number, number] = [e.gridPosition.x, e.gridPosition.z]

      if (previewWindow) {
        previewWindow.position = localPos // Position RELATIVE to wall
        previewWindow.rotation = 0
        canPlace = canPlaceGridItemOnWall(e.node, previewWindow, 2)
        previewWindow.editor = { ...previewWindow.editor, canPlace }
        updateNode(previewWindow.id, previewWindow)
      } else {
        const windowData = WindowNode.parse({
          parentId: e.node.id,
          type: 'window',
          name: 'Window Preview',
          position: localPos, // Position RELATIVE to wall
          rotation: 0, // Rotation relative to wall
          size: [1, 1.2],
          height: 1,
          editor: { canPlace, preview: true },
        })
        previewWindow = windowData as WindowNode

        canPlace = canPlaceGridItemOnWall(e.node, previewWindow, 2)
        previewWindow.editor = { ...previewWindow.editor, canPlace }
        previewWindow.id = addNode(previewWindow, e.node.id) as WindowNode['id'] // Parent is the wall
      }
    }

    const handleWallLeave = (e: WallEvent) => {
      if (previewWindow) {
        deleteNode(previewWindow.id)
        previewWindow = null
      }
      ignoreGridMove = false
    }

    // Register event listeners
    emitter.on('wall:click', handleWallClick)
    emitter.on('grid:move', handleGridMove)
    emitter.on('wall:enter', handleWallEnter)
    emitter.on('wall:move', handleWallMove)
    emitter.on('wall:leave', handleWallLeave)

    // Cleanup event listeners
    return () => {
      emitter.off('wall:click', handleWallClick)
      emitter.off('grid:move', handleGridMove)
      emitter.off('wall:enter', handleWallEnter)
      emitter.off('wall:move', handleWallMove)
      emitter.off('wall:leave', handleWallLeave)

      if (previewWindow) {
        deleteNode(previewWindow.id)
        previewWindow = null
      }
    }
  }, [addNode, updateNode, deleteNode, selectedFloorId])

  return null
}

// ============================================================================
// REGISTER WINDOW COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'window',
  nodeName: 'Window',
  editorMode: 'building',
  toolName: 'window',
  toolIcon: RectangleHorizontal,
  schema: WindowNode,
  nodeEditor: WindowNodeEditor,
  nodeRenderer: WindowRenderer,
})
