import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FootingNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  getSegmentGridStep,
  isMagneticSnapActive,
  snapBuildingLocalToWorldGrid,
  snapWallDraftPoint,
  triggerSFX,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { footingSnapTargets } from './drafting'

/**
 * A footing moved in the plan: its reference point (a pad's centre, a strip's start) follows the
 * pointer and snaps as the tool snaps; the rest of it travels with it. Previews through live
 * overrides, writes once on release.
 */
export const footingFloorplanMoveTarget: FloorplanMoveTarget<FootingNode> = ({ node, nodes }) => {
  const id = node.id as AnyNodeId
  const pad = node.shape === 'pad'
  const origin: WallPlanPoint = (pad ? node.center : node.start) ?? [0, 0]
  const targets = node.parentId ? footingSnapTargets(nodes, node.parentId, [node.id]) : []
  let anchor: WallPlanPoint | null = null
  let delta: WallPlanPoint = [0, 0]
  const moved = (point: readonly [number, number] | undefined): WallPlanPoint | undefined =>
    point && [point[0] + delta[0], point[1] + delta[1]]
  const patch = (): Partial<FootingNode> =>
    pad ? { center: moved(node.center) } : { start: moved(node.start), end: moved(node.end) }

  return {
    affectedIds: [id],
    apply({ planPoint, modifiers }) {
      if (!anchor) {
        anchor = [planPoint[0], planPoint[1]]
        return
      }
      const raw: WallPlanPoint = [
        origin[0] + planPoint[0] - anchor[0],
        origin[1] + planPoint[1] - anchor[1],
      ]
      const step = getSegmentGridStep()
      const at = modifiers.altKey
        ? raw
        : snapWallDraftPoint({
            point: raw,
            walls: targets,
            magnetic: isMagneticSnapActive(),
            gridSnap: (p) => snapBuildingLocalToWorldGrid(p, step),
          })
      const next: WallPlanPoint = [at[0] - origin[0], at[1] - origin[1]]
      if (next[0] === delta[0] && next[1] === delta[1]) return
      delta = next
      triggerSFX('sfx:grid-snap')
      useLiveNodeOverrides.getState().set(id, patch())
    },
    canCommit() {
      return delta[0] !== 0 || delta[1] !== 0
    },
    commit() {
      useScene.getState().updateNodes([{ id, data: patch() }])
      useLiveNodeOverrides.getState().clear(id)
      useViewer.getState().setSelection({ selectedIds: [id] })
    },
  }
}
