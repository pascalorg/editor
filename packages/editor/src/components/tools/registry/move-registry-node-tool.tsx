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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const roundToHalf = (value: number) => Math.round(value * 2) / 2

/**
 * Generic move tool for any registry-backed kind.
 *
 * The node's actual mesh — registered with `sceneRegistry` via the kind's
 * renderer — follows the cursor via:
 * - `useLiveTransforms.set(node.id, { position, rotation })` triggers a
 *   re-render of the renderer, which applies the new position via R3F.
 * - `sceneRegistry.nodes.get(node.id).position.set(...)` is a defensive
 *   imperative update so the move feels snappy even if the React render
 *   tick is delayed.
 *
 * No separate translucent ghost — the actual rendered mesh IS the preview.
 * The cursor sphere is just a visual aim point (ring + line on the floor).
 *
 * Re-creation path: if the node was somehow orphaned (no entry in
 * `useScene.nodes`), the registry's schema parses a fresh node at the
 * committed position. Mirrors MoveColumnTool's behavior.
 */
export function MoveRegistryNodeTool({ node }: { node: AnyNode }) {
  const initialPosition: [number, number, number] = useMemo(
    () =>
      'position' in node && Array.isArray((node as { position?: unknown }).position)
        ? ((node as { position: [number, number, number] }).position ?? [0, 0, 0])
        : [0, 0, 0],
    [node],
  )
  const [previewPosition, setPreviewPosition] = useState<[number, number, number]>(initialPosition)
  const previousSnapRef = useRef<[number, number] | null>(null)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()
    previousSnapRef.current = null
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
      const x = roundToHalf(event.localPosition[0])
      const z = roundToHalf(event.localPosition[2])
      applyPreview([x, 0, z])

      // Click sound on grid-cell cross, matching the placement tools.
      const prev = previousSnapRef.current
      if (!prev || prev[0] !== x || prev[1] !== z) {
        sfxEmitter.emit('sfx:grid-snap')
        previousSnapRef.current = [x, z]
      }
    }

    const onGridClick = (event: GridEvent) => {
      const position: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        0,
        roundToHalf(event.localPosition[2]),
      ]
      const nodeId = node.id

      if (nodeId && useScene.getState().nodes[nodeId]) {
        committed = true
        useLiveTransforms.getState().clear(nodeId)
        useScene.temporal.getState().resume()
        useScene.getState().updateNode(nodeId, { position } as Partial<AnyNode>)
      } else if (node.parentId) {
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

  // Cursor sphere is just the aim point — the actual node's rendered mesh
  // is what follows via live transforms. Visible alongside.
  return <CursorSphere color="#a78bfa" height={2.5} position={previewPosition} />
}
