'use client'

import { emitter, type GridEvent } from '@pascal/core/events'
import { StairNode, type StairSegmentNode } from '@pascal/core/scenegraph/schema/nodes/stair'
import { StairsIcon } from '@phosphor-icons/react'
import { useEffect, useRef } from 'react'
import { useEditor } from '../../../hooks'
import { registerComponent } from '../../../registry'
import { StairRenderer } from '../stair/stair-renderer'

// ============================================================================
// STAIR BUILDER COMPONENT
// ============================================================================

export function StairNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  // Use ref to persist preview state across renders without triggering re-renders
  const previewStateRef = useRef<{
    previewStairId: string | null
    lastPreviewPosition: [number, number] | null
    currentRotation: number
  }>({
    previewStairId: null,
    lastPreviewPosition: null,
    currentRotation: 0,
  })

  // Cleanup preview on unmount
  useEffect(
    () => () => {
      const previewId = previewStateRef.current.previewStairId
      if (previewId) {
        deleteNode(previewId)
      }
    },
    [deleteNode],
  )

  // Right-click handler for rotation
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const previewId = previewStateRef.current.previewStairId
      // Only handle if there's an active preview
      if (previewId && selectedFloorId) {
        e.preventDefault()
        e.stopPropagation()

        // Rotate by 90 degrees
        previewStateRef.current.currentRotation += Math.PI / 2

        // Update preview with new rotation
        updateNode(previewId, {
          rotation: previewStateRef.current.currentRotation,
        })
      }
    }

    window.addEventListener('contextmenu', handleContextMenu)
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [selectedFloorId, updateNode])

  useEffect(() => {
    const handleGridClick = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position

      // Create default segment
      const defaultSegment: StairSegmentNode = {
        segmentType: 'stair',
        width: 1.0,
        length: 3.0,
        height: 2.0,
        stepCount: 10,
        attachmentSide: 'front',
        fillToFloor: true,
        thickness: 0.25,
      } as StairSegmentNode

      // Create stair node
      addNode(
        StairNode.parse({
          name: `Stair at ${x},${y}`,
          position: [x, y],
          rotation: previewStateRef.current.currentRotation,
          size: [1, 3], // Approximate size
          visible: true,
          opacity: 100,
          children: [defaultSegment],
        }),
        selectedFloorId,
      )

      // Let's just let the preview persist for continuous placement
    }

    const handleGridMove = (e: GridEvent) => {
      if (!selectedFloorId) return

      const [x, y] = e.position
      const lastPos = previewStateRef.current.lastPreviewPosition

      // Only update if position changed
      if (!lastPos || lastPos[0] !== x || lastPos[1] !== y) {
        previewStateRef.current.lastPreviewPosition = [x, y]

        const previewId = previewStateRef.current.previewStairId

        if (previewId) {
          // Update existing preview position
          updateNode(previewId, {
            position: [x, y] as [number, number],
            rotation: previewStateRef.current.currentRotation,
            visible: true,
            editor: { preview: true },
          })
        } else {
          // Create default segment for preview
          const defaultSegment: StairSegmentNode = {
            segmentType: 'stair',
            width: 1.0,
            length: 3.0,
            height: 2.0,
            stepCount: 10,
            attachmentSide: 'front',
            fillToFloor: true,
            thickness: 0.25,
          } as StairSegmentNode

          // Create new preview item
          const newPreviewId = addNode(
            StairNode.parse({
              name: 'Stair Preview',
              position: [x, y] as [number, number],
              rotation: previewStateRef.current.currentRotation,
              size: [1, 3],
              visible: true,
              opacity: 100,
              editor: { preview: true },
              children: [defaultSegment],
            }),
            selectedFloorId,
          )
          previewStateRef.current.previewStairId = newPreviewId
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
// REGISTER STAIR COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'stair',
  nodeName: 'Stair',
  editorMode: 'building',
  toolName: 'stair',
  toolIcon: StairsIcon,
  schema: StairNode,
  nodeEditor: StairNodeEditor,
  nodeRenderer: StairRenderer,
})
