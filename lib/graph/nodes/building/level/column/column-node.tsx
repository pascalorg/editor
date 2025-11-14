'use client'

import { Circle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { ColumnRenderer } from '@/components/nodes/column/column-renderer'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/graph/registry'

// ============================================================================
// COLUMN RENDERER PROPS SCHEMA
// ============================================================================

/**
 * Zod schema for column renderer props
 * These are renderer-specific properties, not the full node structure
 */
export const ColumnRendererPropsSchema = z.object({
  height: z.number(),
  diameter: z.number(),
})

export type ColumnRendererProps = z.infer<typeof ColumnRendererPropsSchema>

// ============================================================================
// COLUMN BUILDER COMPONENT
// ============================================================================

/**
 * Column builder component
 * Uses useEditor hooks directly to manage column placement
 */
export function ColumnNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levels = useEditor((state) => state.levels)

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
          (child as any).position[0] === x &&
          (child as any).position[1] === y &&
          !child.preview,
      )

      if (!existingColumn) {
        // Create column node
        addNode(
          {
            type: 'column' as const,
            name: `Column at ${x},${y}`,
            position: [x, y],
            rotation: 0,
            size: [0.3, 0.3], // 30cm x 30cm column
            visible: true,
            opacity: 100,
            children: [],
          } as any,
          selectedFloorId,
        )
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
            (child as any).position[0] === x &&
            (child as any).position[1] === y &&
            !child.preview,
        )

        if (existingColumn) {
          // Don't show preview if there's already a column here
          if (previewStateRef.current.previewColumnId) {
            updateNode(previewStateRef.current.previewColumnId, { visible: false } as any)
          }
        } else {
          // Show preview
          const previewId = previewStateRef.current.previewColumnId

          if (previewId) {
            // Update existing preview position
            updateNode(previewId, {
              position: [x, y] as [number, number],
              visible: true,
            } as any)
          } else {
            // Create new preview column
            const newPreviewId = addNode(
              {
                type: 'column' as const,
                name: 'Column Preview',
                position: [x, y] as [number, number],
                rotation: 0,
                size: [0.3, 0.3] as [number, number],
                visible: true,
                opacity: 100,
                preview: true,
                children: [] as [],
              } as any,
              selectedFloorId,
            )
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
  toolIcon: Circle,
  rendererPropsSchema: ColumnRendererPropsSchema,
  nodeEditor: ColumnNodeEditor,
  nodeRenderer: ColumnRenderer,
})
