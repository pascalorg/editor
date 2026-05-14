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
 * Imperative-only motion during drag:
 * - On every `grid:move` we mutate `sceneRegistry.nodes.get(id).position`
 *   directly. The node's store data is unchanged → the renderer doesn't
 *   re-render → R3F doesn't reapply `position={node.position}` → the
 *   imperative mutation sticks. Movement is smooth, framerate-locked,
 *   and React-free.
 *
 * Store update happens only on commit (single undoable action).
 *
 * Cancel imperatively snaps the mesh back to its original position and
 * resumes history without ever having touched the store mid-drag.
 *
 * This is faster than the items pattern (which updates the store per tick
 * and re-renders the renderer on every mouse move). Trade-off: if the
 * renderer happens to re-render for some other reason mid-drag, R3F will
 * reapply node.position and snap the mesh back. Mitigation: history is
 * paused, no upstream state subscribed by the renderer changes during the
 * drag, so re-renders are rare in practice. If a kind needs guaranteed
 * stability, it can opt into a "live position" hook in Phase 4.
 */
export function MoveRegistryNodeTool({ node }: { node: AnyNode }) {
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
    // Pause history so the eventual commit lands as a single undoable step,
    // not the per-tick spam that would happen if we updated the store on
    // each move.
    useScene.temporal.getState().pause()
    previousSnapRef.current = null
    let committed = false

    const onGridMove = (event: GridEvent) => {
      const x = roundToHalf(event.localPosition[0])
      const z = roundToHalf(event.localPosition[2])
      setCursorPosition([x, 0, z])

      // Pure imperative: move the mesh via its registered Object3D ref.
      // No React re-render. No store update. The shelf (or any registry
      // kind) follows the cursor smoothly because nothing competes with
      // this position write until commit.
      sceneRegistry.nodes.get(node.id)?.position.set(x, 0, z)

      // SFX on cell-cross, matching placement.
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
        // Store still has the original position (we didn't touch it during
        // drag). Resume history and do one tracked update. Undo replays the
        // (original → final) single step.
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
      // Snap mesh back to original visually. Store was never touched.
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
      // If we unmount without committing (e.g., the user switches tools or
      // navigates away), restore the mesh imperatively and resume history.
      // Store was never touched so no data revert is needed.
      if (!committed) {
        sceneRegistry.nodes
          .get(node.id)
          ?.position.set(originalPosition[0], originalPosition[1], originalPosition[2])
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, node, originalPosition])

  return <CursorSphere color="#a78bfa" height={2.5} position={cursorPosition} />
}
