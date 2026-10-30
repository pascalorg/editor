'use client'

import {
  type AnyNodeId,
  type BeamNode,
  beamTopElevation,
  emitter,
  type GridEvent,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  consumePlacementDragRelease,
  isFreshPlacementMetadata,
  markToolCancelConsumed,
  stripPlacementMetadataFlags,
  triggerSFX,
  useEditor,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createPortal } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { snapBeamPoint } from './drafting'
import { movedBeamEnds } from './floorplan-move'

/**
 * A beam moved in 3D, both ends together: its start follows the pointer, snapped as the beam tool
 * snaps (wall faces and ends, other beams, post centres, the grid; Alt free), the run keeping its
 * length and angle. Previews through live overrides and writes once on the click, one undo step;
 * Esc puts it back. Mounted by the move dispatcher from `affordanceTools.move`.
 */
export const MoveBeamTool: React.FC<{ node: BeamNode }> = ({ node }) => {
  const activatedAt = useRef(Date.now())
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)
  const top = useScene((state) => beamTopElevation(state.nodes, node))

  useEffect(() => {
    const id = node.id as AnyNodeId
    const origin: WallPlanPoint = [node.start[0], node.start[1]]
    const fresh = isFreshPlacementMetadata(node.metadata)
    let anchor: WallPlanPoint | null = null
    let delta: WallPlanPoint = [0, 0]
    let committed = false

    const exit = () => useEditor.getState().setMovingNode(null)
    const preview = () => {
      useLiveNodeOverrides.getState().set(id, movedBeamEnds(node, delta))
      useScene.getState().markDirty(id)
    }

    const onGridMove = (event: GridEvent) => {
      const raw: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]
      anchor ??= raw
      const at = node.parentId
        ? snapBeamPoint({
            point: [origin[0] + raw[0] - anchor[0], origin[1] + raw[1] - anchor[1]],
            nodes: useScene.getState().nodes,
            levelId: node.parentId,
            ignoreIds: [node.id],
            free: event.nativeEvent?.altKey === true,
          }).point
        : origin
      const next: WallPlanPoint = [at[0] - origin[0], at[1] - origin[1]]
      if (next[0] === delta[0] && next[1] === delta[1]) return
      delta = next
      triggerSFX('sfx:grid-snap')
      const moved = movedBeamEnds(node, delta)
      setCursor([(moved.start[0] + moved.end[0]) / 2, 0, (moved.start[1] + moved.end[1]) / 2])
      preview()
    }

    const onGridClick = (event: GridEvent) => {
      if (committed) return
      if (Date.now() - activatedAt.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }
      committed = true
      const moved = movedBeamEnds(node, delta)
      useScene.getState().updateNodes([
        {
          id,
          data: fresh
            ? {
                ...moved,
                metadata: stripPlacementMetadataFlags(node.metadata) as BeamNode['metadata'],
              }
            : moved,
        },
      ])
      useLiveNodeOverrides.getState().clear(id)
      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [id] })
      exit()
      event.nativeEvent?.stopPropagation?.()
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      activatedAt.current = 0
      onGridClick({ nativeEvent: event } as unknown as GridEvent)
    }

    const onCancel = () => {
      useLiveNodeOverrides.getState().clear(id)
      useScene.getState().markDirty(id)
      useViewer.getState().setSelection({ selectedIds: [id] })
      markToolCancelConsumed()
      // This tool owns the teardown: the 2D overlay leaves the beam to it.
      useEditor.getState().setMovingNodeOrigin('3d')
      exit()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)
    return () => {
      // Only the live preview is ever undone here: a move the 2D overlay committed is in the
      // scene already, and an override is never the scene.
      if (!committed) useLiveNodeOverrides.getState().clear(id)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
    }
  }, [node])

  const level = node.parentId ? sceneRegistry.nodes.get(node.parentId) : undefined
  if (!(cursor && level)) return null
  return createPortal(
    <CursorSphere position={[cursor[0], top, cursor[2]]} showTooltip={false} />,
    level,
  )
}

export default MoveBeamTool
