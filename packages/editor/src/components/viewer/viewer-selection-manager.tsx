'use client'

import { type AnyNodeId, emitter, type NodeEvent, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { selectionModifiersFromEvent } from '../../lib/selection-routing'
import {
  applyViewerClick,
  applyViewerHover,
  viewerPickFromNodeEvent,
} from '../../lib/viewer-selection'

/**
 * Selection for a parametric viewer surface (the published viewer's fallback,
 * its embed, the editor's Preview): free-form and room-first, through the same
 * rules as the baked viewer. Mount it with `<Viewer selectionManager="custom">`.
 */
export function ViewerSelectionManager() {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    let clickHandled = false
    let hoveredFrom: string | null = null
    const pendingClicks = new Set<number>()

    const onMove = (event: NodeEvent) => {
      if (useViewer.getState().walkthroughMode) return
      const pick = viewerPickFromNodeEvent(event, useScene.getState().nodes)
      if (!pick) return
      event.stopPropagation()
      hoveredFrom = event.node.id
      applyViewerHover(pick, useScene.getState().nodes)
    }
    const onLeave = (event: NodeEvent) => {
      if (event.node.id !== hoveredFrom) return
      hoveredFrom = null
      useViewer.getState().setHoveredId(null)
    }
    const onClick = (event: NodeEvent) => {
      if (useViewer.getState().walkthroughMode) return
      const pick = viewerPickFromNodeEvent(event, useScene.getState().nodes)
      if (!pick) return
      event.stopPropagation()
      clickHandled = true
      applyViewerClick(
        pick,
        useScene.getState().nodes,
        selectionModifiersFromEvent(event.nativeEvent),
      )
    }
    // A click on nothing selectable clears the room and the element.
    const onCanvasClick = (event: MouseEvent) => {
      const viewer = useViewer.getState()
      if (event.button !== 0 || viewer.walkthroughMode) return
      if (viewer.cameraDragging || viewer.inputDragging) return
      const frame = requestAnimationFrame(() => {
        pendingClicks.delete(frame)
        if (useViewer.getState().walkthroughMode) return
        if (clickHandled) {
          clickHandled = false
          return
        }
        applyViewerClick(null, useScene.getState().nodes)
      })
      pendingClicks.add(frame)
    }

    emitter.on('node:move', onMove)
    emitter.on('node:enter', onMove)
    emitter.on('node:leave', onLeave)
    emitter.on('node:click', onClick)
    const canvas = gl.domElement
    canvas.addEventListener('click', onCanvasClick)
    return () => {
      emitter.off('node:move', onMove)
      emitter.off('node:enter', onMove)
      emitter.off('node:leave', onLeave)
      emitter.off('node:click', onClick)
      canvas.removeEventListener('click', onCanvasClick)
      for (const frame of pendingClicks) cancelAnimationFrame(frame)
      useViewer.getState().setHoveredId(null)
    }
  }, [gl])

  return <ViewerOutlineSync />
}

/** The selected elements and the hovered one, outlined (rooms highlight instead). */
function ViewerOutlineSync() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const externalSelectedIds = useViewer((s) => s.externalSelectedIds)
  const hoveredId = useViewer((s) => s.hoveredId)
  const outliner = useViewer((s) => s.outliner)
  const geometryRevision = useViewer((s) => s.geometryRevision)
  const walkthrough = useViewer((s) => s.walkthroughMode)
  const nodes = useScene((s) => s.nodes)

  useEffect(() => {
    void geometryRevision
    outliner.selectedObjects.length = 0
    outliner.hoveredObjects.length = 0
    if (walkthrough) return
    for (const id of new Set([...selectedIds, ...externalSelectedIds])) {
      const object = sceneRegistry.nodes.get(id)
      if (object) outliner.selectedObjects.push(object)
    }
    const hovered = hoveredId ? nodes[hoveredId as AnyNodeId] : undefined
    if (hovered && hovered.type !== 'zone') {
      const object = sceneRegistry.nodes.get(hovered.id)
      if (object) outliner.hoveredObjects.push(object)
    }
  }, [selectedIds, externalSelectedIds, hoveredId, outliner, nodes, geometryRevision, walkthrough])

  useEffect(
    () => () => {
      outliner.selectedObjects.length = 0
      outliner.hoveredObjects.length = 0
    },
    [outliner],
  )

  return null
}
