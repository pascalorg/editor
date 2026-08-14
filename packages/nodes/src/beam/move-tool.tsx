'use client'

import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  type LevelNode,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  getSegmentGridStep,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  snapFenceDraftPoint,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BeamNode } from './schema'
import { BeamGhost } from './tool'

/**
 * Beam whole-move tool.
 *
 * The generic `movable` mover translates `position`, which the beam body
 * ignores — the beam is a centreline element whose geometry is built from
 * world `start` / `end`. So the beam owns a bespoke mover that translates
 * both endpoints by the same delta, keeping the centreline parallel and
 * the span length intact.
 *
 * Live-drag pattern (same as the fence mover): preview through live node
 * overrides, write the final position once on commit for a single undo
 * step. Grid snap follows the active mode; magnetic snap runs against the
 * level's walls + fences. Linked beams are NOT carried by a body move
 * (only endpoint drags cascade), and there is no support-slab election.
 *
 * Wired via `def.affordanceTools.move`. The editor's `MoveTool`
 * dispatcher picks this up before its legacy chain.
 */
export const MoveBeamTool: React.FC<{ node: BeamNode }> = ({ node }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const originalStartRef = useRef<[number, number]>([...node.start] as [number, number])
  const originalEndRef = useRef<[number, number]>([...node.end] as [number, number])
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const previewRef = useRef<{ start: [number, number]; end: [number, number] } | null>(null)

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const centerX = (node.start[0] + node.end[0]) / 2
    const centerZ = (node.start[1] + node.end[1]) / 2
    return [centerX, 0, centerZ]
  })
  // The live preview span — mirrors the override-merged endpoints so the
  // translucent ghost renders at the dragged position.
  const [previewSpan, setPreviewSpan] = useState<{
    start: [number, number]
    end: [number, number]
  } | null>(null)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    const beamId = node.id
    const originalStart = originalStartRef.current
    const originalEnd = originalEndRef.current

    const levelNode =
      node.parentId && useScene.getState().nodes[node.parentId as AnyNodeId]?.type === 'level'
        ? (useScene.getState().nodes[node.parentId as AnyNodeId] as LevelNode)
        : null
    const levelChildren = levelNode?.children ?? []
    const levelWalls = levelChildren
      .map((childId) => useScene.getState().nodes[childId as AnyNodeId])
      .filter((child): child is WallNode => child?.type === 'wall')

    useScene.temporal.getState().pause()
    let wasCommitted = false

    const restoreOriginal = () => {
      useLiveNodeOverrides.getState().clear(beamId)
      useScene.getState().markDirty(beamId)
      setPreviewSpan(null)
    }

    const applyPreview = (nextStart: [number, number], nextEnd: [number, number]) => {
      previewRef.current = { start: nextStart, end: nextEnd }
      const centerX = (nextStart[0] + nextEnd[0]) / 2
      const centerZ = (nextStart[1] + nextEnd[1]) / 2
      setCursorLocalPos([centerX, 0, centerZ])
      setPreviewSpan({ start: nextStart, end: nextEnd })
      useLiveNodeOverrides.getState().set(beamId as AnyNodeId, { start: nextStart, end: nextEnd })
      useScene.getState().markDirty(beamId)
    }

    const onGridMove = (event: GridEvent) => {
      const gridSnapActive = isGridSnapActive()
      const magneticSnapActive = isMagneticSnapActive()
      const [localX, localZ] = snapFenceDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls: levelWalls,
        fences: [],
        ignoreFenceIds: [beamId as string],
        magnetic: magneticSnapActive,
        step: gridSnapActive ? getSegmentGridStep() : 0,
      })

      const anchor = dragAnchorRef.current ?? [localX, localZ]
      dragAnchorRef.current = anchor

      const rawDeltaX = localX - anchor[0]
      const rawDeltaZ = localZ - anchor[1]

      const nextStart: [number, number] = [
        originalStart[0] + rawDeltaX,
        originalStart[1] + rawDeltaZ,
      ]
      const nextEnd: [number, number] = [originalEnd[0] + rawDeltaX, originalEnd[1] + rawDeltaZ]

      applyPreview(nextStart, nextEnd)
    }

    const onGridClick = (event: GridEvent) => {
      if (wasCommitted) return
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      wasCommitted = true

      const preview = previewRef.current
      if (!preview) {
        exitMoveMode()
        event.nativeEvent?.stopPropagation?.()
        return
      }

      useScene.temporal.getState().resume()
      useScene
        .getState()
        .updateNodes([{ id: beamId, data: { start: preview.start, end: preview.end } }])
      restoreOriginal()
      useScene.temporal.getState().pause()

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [beamId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [beamId] })
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      useEditor.getState().setMovingNodeOrigin('3d')
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!wasCommitted) {
        // The 2D `FloorplanRegistryMoveOverlay` mounts in parallel with
        // this 3D tool whenever the user enters beam move mode from the
        // floor plan. When the 2D overlay commits via
        // `beamFloorplanMoveTarget.commit()` it calls
        // `setMovingNode(null)`, which unmounts this tool. Our local
        // `wasCommitted` is still false (its own `onGridClick` never
        // ran), so a blind `restoreOriginal()` here would overwrite the
        // just-committed new positions back to the originals — the
        // "beam reverts on commit" symptom. The 2D overlay sets
        // `movingNodeOrigin = '2d'` before clearing movingNode; respect
        // that flag and skip the restore. Mirrors the wall/fence move
        // tools' guard.
        const finalisedBy2D = useEditor.getState().movingNodeOrigin === '2d'
        if (!finalisedBy2D) {
          restoreOriginal()
        }
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [exitMoveMode, node])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
      {previewSpan && (
        <BeamGhost
          start={previewSpan.start}
          end={previewSpan.end}
          width={node.width ?? 0.3}
          depth={node.depth ?? 0.6}
          elevation={node.elevation ?? 0}
        />
      )}
    </group>
  )
}

export default MoveBeamTool
