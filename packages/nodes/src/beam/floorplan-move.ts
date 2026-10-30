import {
  type AnyNodeId,
  type BeamNode,
  type FloorplanMoveTarget,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { triggerSFX, type WallPlanPoint } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { snapBeamPoint } from './drafting'

/** A beam translated by `delta`, both ends together. */
export function movedBeamEnds(
  beam: Pick<BeamNode, 'start' | 'end'>,
  delta: WallPlanPoint,
): Pick<BeamNode, 'start' | 'end'> {
  return {
    start: [beam.start[0] + delta[0], beam.start[1] + delta[1]],
    end: [beam.end[0] + delta[0], beam.end[1] + delta[1]],
  }
}

/**
 * A beam moved in the plan: its start follows the pointer and snaps as the beam tool snaps (wall
 * faces and ends, other beams, post centres, the grid); its end travels with it. Previews through
 * live overrides, writes once on release.
 */
export const beamFloorplanMoveTarget: FloorplanMoveTarget<BeamNode> = ({ node, nodes }) => {
  const id = node.id as AnyNodeId
  const origin: WallPlanPoint = [node.start[0], node.start[1]]
  let anchor: WallPlanPoint | null = null
  let delta: WallPlanPoint = [0, 0]

  return {
    affectedIds: [id],
    apply({ planPoint, modifiers }) {
      if (!anchor) {
        anchor = [planPoint[0], planPoint[1]]
        return
      }
      const at = node.parentId
        ? snapBeamPoint({
            point: [origin[0] + planPoint[0] - anchor[0], origin[1] + planPoint[1] - anchor[1]],
            nodes,
            levelId: node.parentId,
            ignoreIds: [node.id],
            free: modifiers.altKey,
          }).point
        : origin
      const next: WallPlanPoint = [at[0] - origin[0], at[1] - origin[1]]
      if (next[0] === delta[0] && next[1] === delta[1]) return
      delta = next
      triggerSFX('sfx:grid-snap')
      useLiveNodeOverrides.getState().set(id, movedBeamEnds(node, delta))
    },
    canCommit() {
      return delta[0] !== 0 || delta[1] !== 0
    },
    commit() {
      useScene.getState().updateNodes([{ id, data: movedBeamEnds(node, delta) }])
      useLiveNodeOverrides.getState().clear(id)
      useViewer.getState().setSelection({ selectedIds: [id] })
    },
  }
}
