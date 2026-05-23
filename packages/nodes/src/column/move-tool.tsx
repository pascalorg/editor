'use client'

import {
  type AnyNodeId,
  type ColumnNode,
  ColumnNode as ColumnNodeSchema,
  emitter,
  type GridEvent,
  sceneRegistry,
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
const roundToHalf = (value: number) => Math.round(value * 2) / 2

function MoveColumnTool({ node }: { node: ColumnNode }) {
  const [previewPosition, setPreviewPosition] = useState<[number, number, number]>(node.position)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()
    let committed = false
    const meta =
      typeof node.metadata === 'object' && node.metadata !== null
        ? (node.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew

    const applyPreview = (position: [number, number, number]) => {
      setPreviewPosition(position)
      useLiveTransforms.getState().set(node.id, {
        position,
        rotation: node.rotation,
      })
      sceneRegistry.nodes.get(node.id)?.position.set(position[0], position[1], position[2])
    }

    const onGridMove = (event: GridEvent) => {
      applyPreview([roundToHalf(event.localPosition[0]), 0, roundToHalf(event.localPosition[2])])
    }

    const onGridClick = (event: GridEvent) => {
      const position: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        0,
        roundToHalf(event.localPosition[2]),
      ]
      const nodeId = (node as { id?: ColumnNode['id'] }).id

      if (nodeId && useScene.getState().nodes[nodeId]) {
        committed = true
        useLiveTransforms.getState().clear(nodeId)
        useScene.temporal.getState().resume()
        useScene.getState().updateNode(nodeId, { position, ...(isNew ? { metadata: {} } : {}) })
      } else if (node.parentId) {
        const column = ColumnNodeSchema.parse({
          ...node,
          id: undefined,
          metadata: {},
          position,
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
      sceneRegistry.nodes
        .get(node.id)
        ?.position.set(node.position[0], node.position[1], node.position[2])
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      useLiveTransforms.getState().clear(node.id)
      if (!committed) {
        sceneRegistry.nodes
          .get(node.id)
          ?.position.set(node.position[0], node.position[1], node.position[2])
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, node])

  return <CursorSphere color="#a78bfa" height={node.height} position={previewPosition} />
}

export default MoveColumnTool
