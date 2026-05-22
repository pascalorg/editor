import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { snapPointToGrid, type WallPlanPoint } from '@pascal-app/editor'

const GRID_STEP = 0.5
const POINT_EPSILON = 1e-6

function samePoint(a: readonly [number, number], b: readonly [number, number]) {
  return Math.abs(a[0] - b[0]) <= POINT_EPSILON && Math.abs(a[1] - b[1]) <= POINT_EPSILON
}

type LinkedWallSnapshot = {
  id: AnyNodeId
  start: [number, number]
  end: [number, number]
}

/**
 * 2D floor-plan move handler for wall — translates the wall by the
 * cursor delta and cascades shared endpoints onto linked walls so
 * connected corners stay connected. Linked walls' non-shared endpoint
 * stays put; their shared endpoint follows the moving wall, so their
 * length stretches/shrinks naturally.
 *
 * Writes both the moving wall and the cascaded linked walls to the
 * scene each `apply` tick — this runs AFTER `MoveWallTool`'s own
 * grid-event preview (the event handlers fire synchronously and the
 * overlay's pointermove fires after), so the cascade here is the
 * last-writer-wins state. `MoveWallTool`'s cleanup has an
 * external-commit guard that prevents it from reverting on unmount.
 */
export const wallFloorplanMoveTarget: FloorplanMoveTarget<WallNode> = ({ node, nodes }) => {
  const wallId = node.id as AnyNodeId
  const originalStart: [number, number] = [node.start[0], node.start[1]]
  const originalEnd: [number, number] = [node.end[0], node.end[1]]

  // Walls sharing an endpoint with the moving wall (same level only).
  const linkedSnapshots: LinkedWallSnapshot[] = []
  for (const sibling of Object.values(nodes)) {
    if (!sibling || (sibling as AnyNode).type !== 'wall') continue
    const w = sibling as WallNode
    if (w.id === node.id) continue
    if (w.parentId !== node.parentId) continue
    if (
      samePoint(w.start, originalStart) ||
      samePoint(w.start, originalEnd) ||
      samePoint(w.end, originalStart) ||
      samePoint(w.end, originalEnd)
    ) {
      linkedSnapshots.push({
        id: w.id as AnyNodeId,
        start: [w.start[0], w.start[1]],
        end: [w.end[0], w.end[1]],
      })
    }
  }

  let anchor: [number, number] | null = null
  let lastDelta: [number, number] = [0, 0]

  // biome-ignore lint/suspicious/noConsole: temp diagnostic
  console.log('[wall-move-2d] setup', {
    wallId,
    originalStart,
    originalEnd,
    linkedCount: linkedSnapshots.length,
    linked: linkedSnapshots.map((s) => ({ id: s.id, start: s.start, end: s.end })),
  })

  const session: FloorplanMoveTargetSession = {
    affectedIds: [wallId, ...linkedSnapshots.map((s) => s.id)],
    apply({ planPoint, modifiers }) {
      const snapped: WallPlanPoint = modifiers.shiftKey
        ? ([planPoint[0], planPoint[1]] as WallPlanPoint)
        : snapPointToGrid([planPoint[0], planPoint[1]] as WallPlanPoint, GRID_STEP)
      if (!anchor) {
        anchor = [snapped[0], snapped[1]]
        return
      }
      const dx = snapped[0] - anchor[0]
      const dz = snapped[1] - anchor[1]
      if (dx === lastDelta[0] && dz === lastDelta[1]) return
      lastDelta = [dx, dz]

      const nextStart: [number, number] = [originalStart[0] + dx, originalStart[1] + dz]
      const nextEnd: [number, number] = [originalEnd[0] + dx, originalEnd[1] + dz]

      // Cascade: each linked wall's endpoint that coincided with one
      // of the moving wall's original endpoints follows that endpoint
      // to its new position. The non-shared endpoint stays put.
      const cascadeEndpoint = (point: [number, number]): [number, number] => {
        if (samePoint(point, originalStart)) return nextStart
        if (samePoint(point, originalEnd)) return nextEnd
        return point
      }
      const linkedUpdates = linkedSnapshots.map((snap) => ({
        id: snap.id,
        data: {
          start: cascadeEndpoint(snap.start),
          end: cascadeEndpoint(snap.end),
        },
      }))

      useScene.getState().updateNodes([
        { id: wallId, data: { start: nextStart, end: nextEnd } },
        ...linkedUpdates,
      ])
      useScene.getState().markDirty(wallId)
      for (const upd of linkedUpdates) {
        useScene.getState().markDirty(upd.id)
      }
    },
    canCommit() {
      const live = useScene.getState().nodes[wallId] as WallNode | undefined
      if (!live || live.type !== 'wall') return false
      const [dx, dz] = lastDelta
      // biome-ignore lint/suspicious/noConsole: temp diagnostic
      console.log('[wall-move-2d] canCommit', {
        wallId,
        delta: lastDelta,
        liveStart: live.start,
        liveEnd: live.end,
        linkedNow: linkedSnapshots.map((s) => {
          const n = useScene.getState().nodes[s.id] as WallNode | undefined
          return { id: s.id, start: n?.start, end: n?.end }
        }),
      })
      return dx !== 0 || dz !== 0
    },
  }
  return session
}
