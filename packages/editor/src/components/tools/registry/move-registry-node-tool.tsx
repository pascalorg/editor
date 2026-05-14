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
import {
  type ComponentType,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const roundToHalf = (value: number) => Math.round(value * 2) / 2

// Cache lazy preview components keyed by their module loader so React.lazy
// isn't re-invoked across renders.
const previewCache = new WeakMap<() => Promise<unknown>, ComponentType<{ node: AnyNode }>>()

function loadPreview(node: AnyNode): ComponentType<{ node: AnyNode }> | null {
  const def = nodeRegistry.get(node.type)
  if (!def?.preview) return null
  const cached = previewCache.get(def.preview)
  if (cached) return cached
  const Comp = lazy(def.preview as () => Promise<{ default: ComponentType<{ node: AnyNode }> }>)
  previewCache.set(def.preview, Comp)
  return Comp
}

/**
 * Generic move tool for any registry-backed kind.
 *
 * Behavior mirrors MoveColumnTool's shape:
 * - Pauses scene history on activation, resumes on commit / cancel / unmount.
 * - On each `grid:move`, applies a live transform to the original node so it
 *   visibly follows the cursor (no second copy of the node).
 * - On `grid:click`, commits the position to the scene store.
 * - If the kind exposes a `preview` component on its NodeDefinition, render
 *   it as a translucent ghost at the cursor too — the user sees the shape
 *   they're moving (better UX than just CursorSphere's line).
 *
 * Phase 4 may merge the preview slot with the renderer behind an `opacity`
 * prop. Until then, defining `preview` on a NodeDefinition gives nice move
 * + placement UX for free.
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

  const Preview = loadPreview(node)

  return (
    <>
      <CursorSphere color="#a78bfa" height={2.5} position={previewPosition} />
      {Preview && (
        <Suspense fallback={null}>
          <group position={previewPosition}>
            <Preview node={node} />
          </group>
        </Suspense>
      )}
    </>
  )
}
