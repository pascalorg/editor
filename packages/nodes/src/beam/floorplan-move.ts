import {
  type AnyNodeId,
  type BeamNode,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { getSegmentGridStep, isGridSnapActive, snapPointToGrid } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

type PlanPoint = [number, number]

/**
 * 2D floor-plan body move for beam. The beam is a centreline element, so
 * a body move translates both endpoints by the same delta — length and
 * heading stay intact, exactly like the 3D `MoveBeamTool`. No linked-beam
 * cascade (beams share no endpoint relation), no support-slab election.
 * Tick publishes endpoint overrides; commit folds them into a single
 * tracked update.
 */
export const beamFloorplanMoveTarget: FloorplanMoveTarget<BeamNode> = ({ node }) => {
  const beamId = node.id as AnyNodeId
  const originalStart: PlanPoint = [node.start[0], node.start[1]]
  const originalEnd: PlanPoint = [node.end[0], node.end[1]]

  let rawAnchor: PlanPoint | null = null
  let lastDelta: PlanPoint = [0, 0]
  let lastNextStart: PlanPoint = originalStart
  let lastNextEnd: PlanPoint = originalEnd

  const session: FloorplanMoveTargetSession = {
    affectedIds: [beamId],

    apply({ planPoint }) {
      if (!rawAnchor) {
        rawAnchor = [planPoint[0], planPoint[1]]
        return
      }
      const rawDx = planPoint[0] - rawAnchor[0]
      const rawDz = planPoint[1] - rawAnchor[1]
      const step = isGridSnapActive() ? getSegmentGridStep() : 0
      const nextStart = snapPointToGrid([originalStart[0] + rawDx, originalStart[1] + rawDz], step)
      const dx = nextStart[0] - originalStart[0]
      const dz = nextStart[1] - originalStart[1]
      if (dx === lastDelta[0] && dz === lastDelta[1]) return
      lastDelta = [dx, dz]
      const nextEnd: PlanPoint = [originalEnd[0] + dx, originalEnd[1] + dz]
      lastNextStart = nextStart
      lastNextEnd = nextEnd

      useLiveNodeOverrides.getState().setMany([[beamId, { start: nextStart, end: nextEnd }]])
      useScene.getState().markDirty(beamId)
    },

    canCommit() {
      const [dx, dz] = lastDelta
      return dx !== 0 || dz !== 0
    },

    commit() {
      useScene
        .getState()
        .updateNodes([{ id: beamId, data: { start: lastNextStart, end: lastNextEnd } }])
      useLiveNodeOverrides.getState().clear(beamId)
      // Re-select the moved beam so selection-gated chrome (endpoint
      // handles, side arrows, length label) remains visible at the new
      // position — the action menu's Move click cleared selection on
      // entry. Matches the wall/fence move targets.
      useViewer.getState().setSelection({ selectedIds: [beamId] })
    },
  }
  return session
}
