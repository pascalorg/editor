'use client'

import '../../../three-types'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  nodeRegistry,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useCallback, useEffect, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const roundToHalf = (value: number) => Math.round(value * 2) / 2

/**
 * Generic move tool for any registry-backed kind. Mirrors MoveColumnTool's
 * shape but parses re-creation through `nodeRegistry.get(kind).schema`
 * instead of a hardcoded schema reference. Used as the fallback in
 * `<MoveTool>` for kinds without a bespoke mover.
 *
 * Phase 4 may consolidate this with the per-kind movers if they all
 * collapse to the same position+rotation shape — until then they live
 * side by side.
 */
export function MoveRegistryNodeTool({ node }: { node: AnyNode }) {
  const initialPosition: [number, number, number] =
    'position' in node && Array.isArray((node as { position?: unknown }).position)
      ? ((node as { position: [number, number, number] }).position ?? [0, 0, 0])
      : [0, 0, 0]
  const [previewPosition, setPreviewPosition] = useState<[number, number, number]>(initialPosition)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()
    let committed = false

    const applyPreview = (position: [number, number, number]) => {
      setPreviewPosition(position)
      useLiveTransforms.getState().set(node.id, {
        position,
        rotation: 'rotation' in node ? ((node as { rotation?: number }).rotation ?? 0) : 0,
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
      const nodeId = node.id

      if (nodeId && useScene.getState().nodes[nodeId]) {
        // Existing node — just update its position.
        committed = true
        useLiveTransforms.getState().clear(nodeId)
        useScene.temporal.getState().resume()
        useScene.getState().updateNode(nodeId, { position } as Partial<AnyNode>)
      } else if (node.parentId) {
        // Orphan re-create path — re-parse the node fresh via the kind's
        // schema in the registry. Mirrors MoveColumnTool's behavior for
        // registry-supplied kinds.
        const def = nodeRegistry.get(node.type)
        if (def) {
          const reparsed = def.schema.parse({
            ...(node as Record<string, unknown>),
            id: undefined,
            metadata: {},
            position,
          })
          committed = true
          useScene.temporal.getState().resume()
          useScene.getState().createNode(reparsed as AnyNode, node.parentId as AnyNodeId)
        }
      }

      useLiveTransforms.getState().clear(node.id)
      sfxEmitter.emit('sfx:item-place')
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(node.id)
      sceneRegistry.nodes
        .get(node.id)
        ?.position.set(initialPosition[0], initialPosition[1], initialPosition[2])
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
          ?.position.set(initialPosition[0], initialPosition[1], initialPosition[2])
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, initialPosition, node])

  // Cursor color from the def's presentation if available, else a neutral fallback.
  const def = nodeRegistry.get(node.type)
  const cursorColor = def?.presentation?.icon.kind === 'iconify' ? '#a78bfa' : '#a78bfa'

  return <CursorSphere color={cursorColor} height={2.5} position={previewPosition} />
}
