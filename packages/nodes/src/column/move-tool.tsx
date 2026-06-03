'use client'

import {
  type AnyNodeId,
  type ColumnNode,
  ColumnNode as ColumnNodeSchema,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  movingFootprintAnchors,
  resolveAlignment,
  sceneRegistry,
  useAlignmentGuides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { CursorSphere, markToolCancelConsumed, triggerSFX, useEditor } from '@pascal-app/editor'
import { useCallback, useEffect, useState } from 'react'

/**
 * Phase 5 Stage D — column's registry-driven 3D move affordance.
 *
 * Replaces the legacy `MoveColumnTool` in `editor/src/components/tools/
 * column/move-column-tool.tsx`. Behaviour is identical: grid:move
 * snaps the cursor to a 0.5m grid and previews the column at that
 * position via `useLiveTransforms` + a direct `sceneRegistry.nodes.get
 * (id).position.set(...)` (the live-drag exception documented in
 * `wiki/architecture/tools.md`); grid:click commits via `useScene.
 * updateNode`. Cancel restores the pre-drag position.
 *
 * Wired via `def.affordanceTools.move`. The editor's `MoveTool`
 * dispatcher's `getRegistryAffordanceTool('column', 'move')` lookup
 * picks this up before its legacy chain reaches `<MoveColumnTool>`.
 */
/** Snap to the editor's active grid step (0.5 / 0.25 / 0.1 / 0.05), read live. */
const snapToGridStep = (value: number) => {
  const step = useEditor.getState().gridSnapStep
  return Math.round(value / step) * step
}

/** 90° steps, matching the GLB item / shelf placement rotation. */
const ROTATION_STEP = Math.PI / 2

/** Figma-style alignment-snap threshold (meters), matching the other tools. */
const ALIGNMENT_THRESHOLD_M = 0.08

function MoveColumnTool({ node }: { node: ColumnNode }) {
  const [previewPosition, setPreviewPosition] = useState<[number, number, number]>(node.position)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()
    let committed = false
    // Ignore a commit before the cursor has moved into place: it's the stray
    // trailing click of whatever armed this move (e.g. a preset re-arming the
    // next copy right after a placement click), not a deliberate drop.
    let hasMoved = false
    // Live Y-rotation, seeded from the column and bumped by R/T.
    let rotationY = node.rotation
    // Latest previewed position, so an R/T press can re-apply at the spot.
    let lastPosition: [number, number, number] = node.position
    const meta =
      typeof node.metadata === 'object' && node.metadata !== null
        ? (node.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew

    // Alignment candidates — every other alignable object's anchors, gathered
    // once (the scene graph is stable during the imperative drag).
    const alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, node.id)

    const applyPreview = (position: [number, number, number]) => {
      lastPosition = position
      setPreviewPosition(position)
      useLiveTransforms.getState().set(node.id, {
        position,
        rotation: rotationY,
      })
      const m = sceneRegistry.nodes.get(node.id)
      if (m) {
        m.position.set(position[0], position[1], position[2])
        m.rotation.y = rotationY
      }
    }

    const onGridMove = (event: GridEvent) => {
      hasMoved = true
      let x = snapToGridStep(event.localPosition[0])
      let z = snapToGridStep(event.localPosition[2])

      // Figma-style alignment snap on top of grid snap; Alt bypasses. The
      // guide connects to the candidate's nearest real anchor (resolver
      // tie-break), so the dot always sits on an actual point.
      const bypass = event.nativeEvent?.altKey === true
      if (!bypass && alignmentCandidates.length > 0) {
        const result = resolveAlignment({
          moving: movingFootprintAnchors(node, x, z, rotationY),
          candidates: alignmentCandidates,
          threshold: ALIGNMENT_THRESHOLD_M,
        })
        if (result.snap) {
          x += result.snap.dx
          z += result.snap.dz
        }
        useAlignmentGuides.getState().set(result.guides)
      } else {
        useAlignmentGuides.getState().clear()
      }

      applyPreview([x, 0, z])
    }

    // R / T rotate the dragged column about Y in 90° steps (matches the move
    // HUD's "Rotate" hints), committed on drop.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      let delta = 0
      if (e.key === 'r' || e.key === 'R') delta = ROTATION_STEP
      else if (e.key === 't' || e.key === 'T') delta = -ROTATION_STEP
      else return
      e.preventDefault()
      rotationY += delta
      applyPreview(lastPosition)
    }

    const onGridClick = (event: GridEvent) => {
      if (!hasMoved) return
      useAlignmentGuides.getState().clear()
      // Commit at the last previewed position so the alignment snap (which
      // may pull off-grid) is preserved, rather than re-snapping the raw
      // click to the grid.
      const position: [number, number, number] = [...lastPosition]
      const nodeId = (node as { id?: ColumnNode['id'] }).id

      if (nodeId && useScene.getState().nodes[nodeId]) {
        committed = true
        useLiveTransforms.getState().clear(nodeId)
        useScene.temporal.getState().resume()
        useScene
          .getState()
          .updateNode(nodeId, { position, rotation: rotationY, ...(isNew ? { metadata: {} } : {}) })
      } else if (node.parentId) {
        const column = ColumnNodeSchema.parse({
          ...node,
          id: undefined,
          metadata: {},
          position,
          rotation: rotationY,
        })
        committed = true
        useScene.temporal.getState().resume()
        useScene.getState().createNode(column, node.parentId as AnyNodeId)
      }

      useLiveTransforms.getState().clear(node.id)
      triggerSFX('sfx:item-place')
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(node.id)
      useAlignmentGuides.getState().clear()
      const m = sceneRegistry.nodes.get(node.id)
      if (m) {
        m.position.set(node.position[0], node.position[1], node.position[2])
        m.rotation.y = node.rotation
      }
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    window.addEventListener('keydown', onKeyDown)
    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      useLiveTransforms.getState().clear(node.id)
      useAlignmentGuides.getState().clear()
      if (!committed) {
        const m = sceneRegistry.nodes.get(node.id)
        if (m) {
          m.position.set(node.position[0], node.position[1], node.position[2])
          m.rotation.y = node.rotation
        }
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, node])

  return <CursorSphere color="#a78bfa" height={node.height} position={previewPosition} />
}

export default MoveColumnTool
