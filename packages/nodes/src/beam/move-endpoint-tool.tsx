'use client'

import { type FenceNode, getWallCurveLength, useScene, type WallNode } from '@pascal-app/core'
import {
  CursorSphere,
  type FencePlanPoint,
  formatAngleRadians,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
  MeasurementPill,
  triggerSFX,
  useAlignmentGuides,
  useDragAction,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { moveBeamEndpointDragAction } from './actions/move-endpoint'
import type { BeamNode } from './schema'

/**
 * Thin React wrapper around `moveBeamEndpointDragAction` — the beam's
 * reshape tool. Same shape as the fence's endpoint tool: sibling beams
 * sharing the dragged corner cascade with it (Alt detaches), and there's
 * no alt-detach badge because the action has no cascade to detach FROM
 * the dragged beam itself. No ticker SFX subscription noise either — the
 * drag action's own grid writes drive the cursor.
 *
 * Mounted by ToolManager via the `move-endpoint` affordance key.
 */
export type MovingBeamEndpoint = {
  beam: BeamNode
  endpoint: 'start' | 'end'
}

type SegmentLike = {
  id: string
  start: FencePlanPoint
  end: FencePlanPoint
  curveOffset?: number
}

function referenceSegments(walls: WallNode[], fences: FenceNode[]): SegmentLike[] {
  return [
    ...walls.map((w) => ({ id: w.id, start: w.start, end: w.end, curveOffset: w.curveOffset })),
    ...fences.map((f) => ({ id: f.id, start: f.start, end: f.end, curveOffset: f.curveOffset })),
  ]
}

function pickAngleLabel(args: {
  start: FencePlanPoint
  end: FencePlanPoint
  segments: SegmentLike[]
}): { label: string; position: [number, number, number] } | null {
  // The beam itself is never in `segments` (walls + fences only), so no
  // self-exclusion is needed — every candidate is a genuine neighbour.
  const target: SegmentLike = { id: 'beam', start: args.start, end: args.end }
  for (const endpoint of [args.start, args.end] as FencePlanPoint[]) {
    const targetRef = getSegmentAngleReferenceAtPoint(endpoint, target)
    if (!targetRef) continue
    const neighbour = args.segments.find((s) =>
      Boolean(getSegmentAngleReferenceAtPoint(endpoint, s)),
    )
    if (!neighbour) continue
    const neighbourRef = getSegmentAngleReferenceAtPoint(endpoint, neighbour)
    if (!neighbourRef) continue
    const angle = getAngleToSegmentReference(targetRef.vector, neighbourRef)
    if (angle === null) continue
    return {
      label: formatAngleRadians(angle),
      position: [endpoint[0], 0.34, endpoint[1]],
    }
  }
  return null
}

export const MoveBeamEndpointTool: React.FC<{ target: MovingBeamEndpoint }> = ({ target }) => {
  const beamId = target.beam.id
  const endpoint = target.endpoint
  const initialPoint: FencePlanPoint =
    endpoint === 'start'
      ? [target.beam.start[0], target.beam.start[1]]
      : [target.beam.end[0], target.beam.end[1]]
  const unit = useViewer((s) => s.unit)

  // Live subscriptions — the action writes onto the beam node every
  // grid:move, so the cursor + pill can mirror current state.
  const live = useScene((s) => s.nodes[beamId])
  const liveBeam = live?.type === 'beam' ? (live as BeamNode) : null
  const liveStart = liveBeam?.start ?? target.beam.start
  const liveEnd = liveBeam?.end ?? target.beam.end
  const movingPoint = endpoint === 'start' ? liveStart : liveEnd

  const exitMoveMode = (committed: boolean) => {
    if (committed) triggerSFX('sfx:item-place')
    useViewer.getState().setSelection({ selectedIds: [beamId] })
    useInteractionScope
      .getState()
      .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'endpoint')
  }

  useDragAction({
    active: true,
    action: moveBeamEndpointDragAction,
    initial: {
      node: target.beam,
      handleId: endpoint,
      point: initialPoint,
    },
    onCommit: () => exitMoveMode(true),
    onCancel: () => exitMoveMode(false),
  })

  // Neighbour segments at the parent level — computed once at mount.
  const parentId = target.beam.parentId ?? null
  const neighbourSegments = useMemo(() => {
    const { nodes } = useScene.getState()
    const walls: WallNode[] = []
    const fences: FenceNode[] = []
    for (const node of Object.values(nodes)) {
      if (!node) continue
      if ((node.parentId ?? null) !== parentId) continue
      if (node.type === 'wall') walls.push(node)
      else if (node.type === 'fence') fences.push(node)
    }
    return referenceSegments(walls, fences)
  }, [parentId, beamId])

  const angleLabel = useMemo(
    () =>
      pickAngleLabel({
        start: target.beam.start,
        end: target.beam.end,
        segments: neighbourSegments,
      }),
    [target.beam.start, target.beam.end, neighbourSegments],
  )

  // Safety net: drop any alignment guides if the tool unmounts without the
  // action's commit / cancel running (e.g. abrupt teardown).
  useEffect(() => () => useAlignmentGuides.getState().clear(), [])

  const liveLength = getWallCurveLength({
    start: liveStart,
    end: liveEnd,
    curveOffset: 0,
  })
  const dimMidX = (liveStart[0] + liveEnd[0]) / 2
  const dimMidZ = (liveStart[1] + liveEnd[1]) / 2

  return (
    <group>
      <CursorSphere position={[movingPoint[0], 0, movingPoint[1]]} showTooltip={false} />
      <Html
        center
        position={[
          dimMidX,
          (target.beam.elevation ?? 0) + (target.beam.depth ?? 0.6) + 0.3,
          dimMidZ,
        ]}
        style={{ pointerEvents: 'none', touchAction: 'none' }}
        zIndexRange={[100, 0]}
      >
        <MeasurementPill
          height={target.beam.depth ?? 0.6}
          length={liveLength}
          primary="length"
          thickness={target.beam.width ?? 0.3}
          unit={unit}
        />
      </Html>
      {angleLabel && (
        <Html
          center
          position={angleLabel.position}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div className="whitespace-nowrap rounded-full border border-border bg-background/95 px-2 py-1 font-mono font-semibold text-[11px] text-foreground shadow-lg backdrop-blur-md">
            {angleLabel.label}
          </div>
        </Html>
      )}
    </group>
  )
}

export default MoveBeamEndpointTool
