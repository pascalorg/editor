import {
  type AnyNodeId,
  type BeamNode,
  type FloorplanAffordance,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isSegmentLongEnough, type WallPlanPoint } from '@pascal-app/editor'
import { snapBeamPoint } from './drafting'
import type { BeamEndpointPayload } from './floorplan'

/**
 * A beam's end, dragged in the plan: snapped as the beam tool snaps, angle-stepped off the other
 * end. Previews through live overrides, writes the last end on release, and refuses an end that
 * would leave the beam too short to draw.
 */
export const beamEndpointAffordance: FloorplanAffordance<BeamNode> = {
  start({ node, payload, nodes }) {
    const { endpoint } = payload as BeamEndpointPayload
    const id = node.id as AnyNodeId
    const fixed: WallPlanPoint = endpoint === 'start' ? node.end : node.start
    let last: WallPlanPoint | null = null
    return {
      affectedIds: [id],
      apply({ planPoint, modifiers }) {
        last = node.parentId
          ? snapBeamPoint({
              point: [planPoint[0], planPoint[1]],
              nodes,
              levelId: node.parentId,
              start: fixed,
              ignoreIds: [node.id],
              free: modifiers.altKey,
            }).point
          : [planPoint[0], planPoint[1]]
        useLiveNodeOverrides.getState().set(id, { [endpoint]: last })
      },
      canCommit() {
        return last !== null && isSegmentLongEnough(fixed, last)
      },
      commit() {
        if (last) useScene.getState().updateNodes([{ id, data: { [endpoint]: last } }])
        useLiveNodeOverrides.getState().clear(id)
      },
    }
  },
}
