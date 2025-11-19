'use client'

import { DoorOpen } from 'lucide-react'
import { useEffect } from 'react'
import { z } from 'zod'
import { emitter, type GridEvent, type WallEvent } from '@/events/bus'
import { type DoorNode, useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import { canPlaceGridItemOnWall } from '@/lib/utils'
import { DoorRenderer } from './door-renderer'

// ============================================================================
// DOOR RENDERER PROPS SCHEMA
// ============================================================================

/**
 * Zod schema for door renderer props
 * These are renderer-specific properties, not the full node structure
 */
export const DoorRendererPropsSchema = z
  .object({
    // Optional renderer configuration
    modelScale: z.number().optional(),
  })
  .optional()

export type DoorRendererProps = z.infer<typeof DoorRendererPropsSchema>

// ============================================================================
// DOOR NODE EDITOR
// ============================================================================

/**
 * Door node editor component
 * Handles placing doors on walls via wall events
 */
export function DoorNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  useEffect(() => {
    if (!selectedFloorId) return // Only register events if a floor is selected

    let ignoreGridMove = false
    let previewDoor: DoorNode | null = null
    let lastPosition: [number, number] | null = null
    let lastRotation = 0
    let canPlace = false

    const handleWallClick = (e: WallEvent) => {
      if (previewDoor && canPlace) {
        // Commit the preview by setting preview: false (useEditor handles the conversion)
        updateNode(previewDoor.id, { editor: { preview: false } })

        previewDoor = null
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
      if (previewDoor) {
        previewDoor.position = [x, y]
        previewDoor.rotation = lastRotation

        updateNode(previewDoor.id, previewDoor)
      } else {
        previewDoor = {
          type: 'door',
          name: 'Door Preview',
          position: [x, y],
          rotation: 0,
          size: [1, 2] as [number, number],
          editor: { preview: true, canPlace },
        } as DoorNode
        addNode(
          previewDoor,
          selectedFloorId, // Parent is either wall or level
        )
      }
    }

    const handleWallEnter = (e: WallEvent) => {
      if (previewDoor) {
        deleteNode(previewDoor.id)
      }
      ignoreGridMove = true
      lastRotation = e.node.rotation

      // gridPosition is already in wall's local coordinate system
      const localPos: [number, number] = [e.gridPosition.x, e.gridPosition.z]

      previewDoor = {
        parentId: e.node.id,
        type: 'door',
        name: 'Door Preview',
        position: localPos, // Position RELATIVE to wall (already in wall-local coords)
        rotation: 0, // Rotation relative to wall (always 0 since door aligns with wall)
        size: [1, 2] as [number, number],
        editor: { preview: true, canPlace },
      } as DoorNode
      canPlace = canPlaceGridItemOnWall(e.node, previewDoor, 2)
      addNode(previewDoor, e.node.id) // Parent is the wall
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
      if (previewDoor && e.node.id !== previewDoor.parentId) {
        // Wall changed, remove old preview
        deleteNode(previewDoor.id)
        previewDoor = null
      }
      lastPosition = [e.gridPosition.x, e.gridPosition.z]

      // gridPosition is already in wall's local coordinate system
      const localPos: [number, number] = [e.gridPosition.x, e.gridPosition.z]

      if (previewDoor) {
        previewDoor.position = localPos // Position RELATIVE to wall
        previewDoor.rotation = 0
        canPlace = canPlaceGridItemOnWall(e.node, previewDoor, 2)
        previewDoor.editor = { ...previewDoor.editor, canPlace }
        updateNode(previewDoor.id, previewDoor)
      } else {
        previewDoor = {
          parentId: e.node.id,
          type: 'door',
          name: 'Door Preview',
          position: localPos, // Position RELATIVE to wall
          rotation: 0, // Rotation relative to wall
          size: [1, 2] as [number, number],
          editor: { preview: true, canPlace },
        } as DoorNode

        canPlace = canPlaceGridItemOnWall(e.node, previewDoor, 2)
        previewDoor.editor = { ...previewDoor.editor, canPlace }
        addNode(
          previewDoor,
          e.node.id, // Parent is the wall
        )
      }
    }

    const handleWallLeave = (e: WallEvent) => {
      if (previewDoor) {
        deleteNode(previewDoor.id)
        previewDoor = null
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

      if (previewDoor) {
        deleteNode(previewDoor.id)
        previewDoor = null
      }
    }
  }, [addNode, updateNode, deleteNode, selectedFloorId])

  return null
}

// ============================================================================
// REGISTER DOOR COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'door',
  nodeName: 'Door',
  editorMode: 'building',
  toolName: 'door',
  toolIcon: DoorOpen,
  rendererPropsSchema: DoorRendererPropsSchema,
  nodeEditor: DoorNodeEditor,
  nodeRenderer: DoorRenderer,
})
