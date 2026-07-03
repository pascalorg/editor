'use client'

import { type FenceNode, useScene, type WallNode } from '@pascal-app/core'
import {
  CursorSphere,
  type FencePlanPoint,
  formatAngleRadians,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
  type MovingFenceEndpoint,
  triggerSFX,
  useDragAction,
  useEditor,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
import { moveFenceEndpointDragAction } from './actions/move-endpoint'

/**
 * Phase 5 Stage D — thin React wrapper around `moveFenceEndpointDragAction`.
 *
 * Replaces the legacy `MoveFenceEndpointTool` (425 LoC). All the math
 * (snap, linked cascade, length gate, single-undo dance) lives in the
 * pure action; this wrapper owns the React-only surface:
 *
 *  - Live cursor sphere tracking the moving endpoint (subscribed from
 *    `useScene` so it follows the draft as `apply()` writes).
 *  - Alt-key detach badge — pure UX, reads window keystate so the badge
 *    updates without requiring a pointer move.
 *  - Angle label between this segment and any neighbour segment sharing
 *    the dragged endpoint — same legacy treatment.
 *
 *  Mounted by the legacy ToolManager via the `move-endpoint` affordance
 *  key. `target.fence` + `target.endpoint` come from the editor store
 *  (`useEditor.movingFenceEndpoint`).
 */
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
  fenceId: FenceNode['id']
  start: FencePlanPoint
  end: FencePlanPoint
  curveOffset?: number
  segments: SegmentLike[]
}): { label: string; position: [number, number, number] } | null {
  const target: SegmentLike = {
    id: args.fenceId,
    start: args.start,
    end: args.end,
    curveOffset: args.curveOffset,
  }
  for (const endpoint of [args.start, args.end] as FencePlanPoint[]) {
    const targetRef = getSegmentAngleReferenceAtPoint(endpoint, target)
    if (!targetRef) continue
    const neighbour = args.segments.find(
      (s) => s.id !== args.fenceId && Boolean(getSegmentAngleReferenceAtPoint(endpoint, s)),
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

export const MoveFenceEndpointTool: React.FC<{ target: MovingFenceEndpoint }> = ({ target }) => {
  const fenceId = target.fence.id
  const endpoint = target.endpoint
  const initialPoint: FencePlanPoint =
    endpoint === 'start'
      ? [target.fence.start[0], target.fence.start[1]]
      : [target.fence.end[0], target.fence.end[1]]

  const [altPressed, setAltPressed] = useState(false)

  const exitMoveMode = (committed: boolean) => {
    if (committed) triggerSFX('sfx:item-place')
    useViewer.getState().setSelection({ selectedIds: [fenceId] })
    useEditor.getState().setMovingFenceEndpoint(null)
    useEditor.getState().setActiveAffordance(null)
  }

  useDragAction({
    active: true,
    action: moveFenceEndpointDragAction,
    activationGraceMs: 0,
    initial: {
      node: target.fence,
      handleId: endpoint,
      point: initialPoint,
    },
    onCommit: () => exitMoveMode(true),
    onCancel: () => exitMoveMode(false),
  })

  // Live subscriptions — the action writes onto the fence node every
  // grid:move, so the cursor + angle label can mirror current state.
  const live = useScene((s) => s.nodes[fenceId])
  const liveFence = live?.type === 'fence' ? (live as FenceNode) : null
  const liveStart = liveFence?.start ?? target.fence.start
  const liveEnd = liveFence?.end ?? target.fence.end
  const movingPoint = endpoint === 'start' ? liveStart : liveEnd

  // Neighbour segments at the parent level — computed once at mount.
  const parentId = target.fence.parentId ?? null
  const neighbourSegments = useMemo(() => {
    const { nodes } = useScene.getState()
    const walls: WallNode[] = []
    const fences: FenceNode[] = []
    for (const node of Object.values(nodes)) {
      if (!node) continue
      if ((node.parentId ?? null) !== parentId) continue
      if (node.type === 'wall') walls.push(node)
      else if (node.type === 'fence' && node.id !== fenceId) fences.push(node)
    }
    return referenceSegments(walls, fences)
  }, [parentId, fenceId])

  const angleLabel = useMemo(
    () =>
      pickAngleLabel({
        fenceId,
        start: liveStart,
        end: liveEnd,
        curveOffset: liveFence?.curveOffset ?? target.fence.curveOffset,
        segments: neighbourSegments,
      }),
    [
      fenceId,
      liveStart,
      liveEnd,
      liveFence?.curveOffset,
      target.fence.curveOffset,
      neighbourSegments,
    ],
  )

  // Window-level keystate for the detach badge — independent of grid
  // event modifiers so the badge can toggle without a pointer move.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Alt') setAltPressed(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltPressed(false)
    }
    const onBlur = () => setAltPressed(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const cursorPos: [number, number, number] = [movingPoint[0], 0, movingPoint[1]]

  return (
    <group>
      <CursorSphere position={cursorPos} showTooltip={false} />
      <Html
        position={cursorPos}
        style={{ pointerEvents: 'none', touchAction: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="translate-y-10">
          <div
            className={`whitespace-nowrap rounded-full border px-2 py-1 font-medium text-[11px] shadow-lg backdrop-blur-md transition-colors ${
              altPressed
                ? 'border-amber-500/70 bg-amber-500/15 text-amber-100'
                : 'border-border/70 bg-background/90 text-foreground/80'
            }`}
          >
            {altPressed ? 'Detach endpoint' : 'Drag endpoint'}
          </div>
        </div>
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

export default MoveFenceEndpointTool
