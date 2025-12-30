'use client'

import { CylinderIcon } from '@phosphor-icons/react'
import { useEffect, useRef } from 'react'
import { ColumnRenderer } from '@/components/nodes/column/column-renderer'
import { emitter, type GridEvent } from '@pascal/core/events'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import type { BuildingNode } from '@pascal/core/scenegraph/schema/nodes/building'
import { ColumnNode } from '@pascal/core/scenegraph/schema/nodes/column'
import type { LevelNode } from '@pascal/core/scenegraph/schema/nodes/level'

// ============================================================================
// COLUMN BUILDER COMPONENT
// ============================================================================

/**
 * Column builder component
 * Uses useEditor hooks directly to manage column placement
 */
const EMPTY_LEVELS: LevelNode[] = []

export function ColumnNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levels = useEditor((state) => {
    // Use graph API to find building
    const buildingHandle = state.graph.nodes.find({ type: 'building' })[0]
    if (!buildingHandle) return EMPTY_LEVELS
    // Access data() to get the node structure
    return (buildingHandle.data() as BuildingNode).children
  })

  // Use ref to persist preview state across renders without triggering re-renders
  const previewStateRef = useRef<{
    previewColumnId: string | null
    lastPreviewPosition: [number, number] | null
  }>({
    previewColumnId: null,
    lastPreviewPosition: null,
  })

  useEffect(() => {
    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      const level = levels.find((l) => l.id === selectedFloorId)
      if (!level) return

      const [x, y] = e.position

      // Check if column already exists at this position (non-preview)
      const existingColumn = level.children.find(
        (child) =>
          child.type === 'column' &&
          child.position[0] === x &&
          child.position[1] === y &&
          !child.editor?.preview,
      )

      if (!existingColumn) {
        // Create column node
        updateNode(previewStateRef.current.previewColumnId!, {
          editor: { preview: false },
        })
        previewStateRef.current.previewColumnId = null
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const level = levels.find((l) => l.id === selectedFloorId)
      if (!level) return

      const [x, y] = e.position
      const lastPos = previewStateRef.current.lastPreviewPosition

      // Only update if position changed
      if (!lastPos || lastPos[0] !== x || lastPos[1] !== y) {
        previewStateRef.current.lastPreviewPosition = [x, y]

        // Check if there's already a non-preview column at this position
        const existingColumn = level.children.find(
          (child) =>
            child.type === 'column' &&
            child.position[0] === x &&
            child.position[1] === y &&
            !child.editor?.preview,
        )

        if (existingColumn) {
          // Don't show preview if there's already a column here
          if (previewStateRef.current.previewColumnId) {
            updateNode(previewStateRef.current.previewColumnId, { visible: false })
          }
        } else {
          // Show preview
          const previewId = previewStateRef.current.previewColumnId

          if (previewId) {
            // Update existing preview position
            updateNode(previewId, {
              position: [x, y] as [number, number],
              visible: true,
            })
          } else {
            // Create new preview column
            const columnData: Omit<ColumnNode, 'id'> = {
              type: 'column',
              name: 'Column Preview',
              position: [x, y],
              visible: true,
              opacity: 100,
              parentId: null,
              metadata: {},
              editor: { canPlace: true, preview: true },
              object: 'node', // Required discriminator
            }

            const newPreviewId = addNode(columnData, selectedFloorId)
            previewStateRef.current.previewColumnId = newPreviewId
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

  return null
}

// ============================================================================
// REGISTER COLUMN COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'column',
  nodeName: 'Column',
  editorMode: 'building',
  toolName: 'column',
  toolIcon: CylinderIcon,
  schema: ColumnNode,
  nodeEditor: ColumnNodeEditor,
  nodeRenderer: ColumnRenderer,
})
