'use client'

import '../../../three-types'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  nodeRegistry,
  sceneRegistry,
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
 * Pattern: matches the item move tool (which works). The
 * `useLiveTransforms` + `sceneRegistry.position.set` approach used by
 * MoveColumnTool is broken — the renderer doesn't visibly follow.
 *
 * Instead, on every `grid:move` we directly `useScene.updateNode(id, { position })`
 * while history is paused. The kind's renderer already reads
 * `node.position` from the store, so the mesh visibly follows the cursor.
 *
 * Commit: pause-revert-resume-update sequence so undo replays one
 * coherent action (revert → final position) instead of the per-tick
 * spam that the move generated.
 *
 * Cancel: restore the original position before unmounting.
 */
export function MoveRegistryNodeTool({ node }: { node: AnyNode }) {
  // Snapshot the original position once at mount — used for cancel revert
  // and for the pause-revert-resume sequence at commit.
  const originalPosition: [number, number, number] = useMemo(
    () =>
      'position' in node && Array.isArray((node as { position?: unknown }).position)
        ? ((node as { position: [number, number, number] }).position ?? [0, 0, 0])
        : [0, 0, 0],
    [node],
  )
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>(originalPosition)
  const previousSnapRef = useRef<[number, number] | null>(null)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    // Pause history so per-tick updateNode calls don't fill the undo stack.
    useScene.temporal.getState().pause()
    previousSnapRef.current = null
    let committed = false

    const applyPreview = (position: [number, number, number]) => {
      setCursorPosition(position)
      // Update the actual scene node — the renderer reads node.position and
      // re-renders. The mesh visibly follows. Same pattern as the item move
      // tool (useDraftNode.adopt).
      useScene.getState().updateNode(node.id, { position } as Partial<AnyNode>)
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

      if (useScene.getState().nodes[node.id]) {
        // Restore original position while still paused, then resume and
        // do a single tracked update. Undo replays the (original → final)
        // single step, not every grid-move tick.
        useScene.getState().updateNode(node.id, {
          position: originalPosition,
        } as Partial<AnyNode>)
        useScene.temporal.getState().resume()
        useScene.getState().updateNode(node.id, { position } as Partial<AnyNode>)
        useScene.temporal.getState().pause()
        committed = true
      } else if (node.parentId) {
        // Orphan re-create path: re-parse via the registry's schema.
        const def = nodeRegistry.get(node.type)
        if (def) {
          const reparsed = def.schema.parse({
            ...(node as Record<string, unknown>),
            id: undefined,
            metadata: {},
            position,
          })
          useScene.temporal.getState().resume()
          useScene.getState().createNode(reparsed as AnyNode, node.parentId as AnyNodeId)
          useScene.temporal.getState().pause()
          committed = true
        }
      }

      sfxEmitter.emit('sfx:item-place')
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      // Restore original position while paused — this won't enter undo.
      useScene.getState().updateNode(node.id, {
        position: originalPosition,
      } as Partial<AnyNode>)
      // Defensive Three.js reset in case React render lags.
      sceneRegistry.nodes
        .get(node.id)
        ?.position.set(originalPosition[0], originalPosition[1], originalPosition[2])
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
      // If we unmount without committing (e.g., user picks a different
      // tool), restore original position so the scene doesn't show the
      // stale preview state, and resume history.
      if (!committed) {
        useScene.getState().updateNode(node.id, {
          position: originalPosition,
        } as Partial<AnyNode>)
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, node, originalPosition])

  return <CursorSphere color="#a78bfa" height={2.5} position={cursorPosition} />
}
