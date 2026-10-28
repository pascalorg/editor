import {
  type AnyNodeId,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  type FootingNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  getSegmentGridStep,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  isSegmentLongEnough,
  snapBuildingLocalToWorldGrid,
  snapScalarToGrid,
  snapWallDraftPoint,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'
import { footingSnapTargets } from './drafting'
import type { FootingEndpointPayload, FootingSizePayload, FootingWidthPayload } from './floorplan'

/** The least a drag sizes a footing to: what still draws, not a code minimum (the panel warns of that). */
const MIN_SIZE = 0.05
const INCH = 0.0254

/**
 * A footing size off a drag: to the whole inch (a centimetre on a metric plan) while the grid
 * snaps, since the plan's grid step (half a metre by default) is no footing size; raw with Alt.
 */
function snapFootingSize(size: number, free: boolean): number {
  const step =
    free || !isGridSnapActive() ? 0 : useViewer.getState().unit === 'imperial' ? INCH : 0.01
  return Math.max(MIN_SIZE, snapScalarToGrid(size, step))
}

/** One drag that previews a patch on the footing and writes the last one on release. */
function patchSession(
  node: FootingNode,
  next: (planPoint: WallPlanPoint, altKey: boolean) => Partial<FootingNode>,
  valid: (patch: Partial<FootingNode>) => boolean = () => true,
): FloorplanAffordanceSession {
  const id = node.id as AnyNodeId
  let last: Partial<FootingNode> = {}
  return {
    affectedIds: [id],
    apply({ planPoint, modifiers }) {
      last = next([planPoint[0], planPoint[1]], modifiers.altKey)
      useLiveNodeOverrides.getState().set(id, last)
    },
    canCommit() {
      return Object.keys(last).length > 0 && valid(last)
    },
    commit() {
      useScene.getState().updateNodes([{ id, data: last }])
      useLiveNodeOverrides.getState().clear(id)
    },
  }
}

/** A strip's end, dragged: snapped as the tool snaps, angle-locked off the other end. */
export const footingEndpointAffordance: FloorplanAffordance<FootingNode> = {
  start({ node, payload, nodes }) {
    const { endpoint } = payload as FootingEndpointPayload
    const fixed = (endpoint === 'start' ? node.end : node.start) ?? [0, 0]
    const targets = node.parentId ? footingSnapTargets(nodes, node.parentId, [node.id]) : []
    return patchSession(
      node,
      (point, free) => {
        const step = getSegmentGridStep()
        const angleSnap = isAngleSnapActive()
        const snapped = free
          ? point
          : snapWallDraftPoint({
              point,
              walls: targets,
              start: angleSnap ? fixed : undefined,
              angleSnap,
              magnetic: isMagneticSnapActive(),
              gridSnap: (p) => snapBuildingLocalToWorldGrid(p, step),
            })
        return { [endpoint]: snapped }
      },
      (patch) => isSegmentLongEnough(patch.start ?? fixed, patch.end ?? fixed),
    )
  },
}

/** A strip's side, dragged across it: the width grows twice the drag, the centreline stays. */
export const footingWidthAffordance: FloorplanAffordance<FootingNode> = {
  start({ node, payload, initialPlanPoint }) {
    const { side } = payload as FootingWidthPayload
    const a: WallPlanPoint = node.start ?? [0, 0]
    const b: WallPlanPoint = node.end ?? [1, 0]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const normal: WallPlanPoint = [
      (-(b[1] - a[1]) / length) * side,
      ((b[0] - a[0]) / length) * side,
    ]
    return patchSession(node, (point, free) => {
      const delta =
        (point[0] - initialPlanPoint[0]) * normal[0] + (point[1] - initialPlanPoint[1]) * normal[1]
      return { width: snapFootingSize(node.width + delta * 2, free) }
    })
  },
}

/** A pad's side, dragged along its axis: the side grows twice the drag about the centre. */
export const footingSizeAffordance: FloorplanAffordance<FootingNode> = {
  start({ node, payload, initialPlanPoint }) {
    const { dim, planAxis } = payload as FootingSizePayload
    const initial = dim === 'width' ? node.width : (node.length ?? node.width)
    return patchSession(node, (point, free) => {
      const delta =
        (point[0] - initialPlanPoint[0]) * planAxis[0] +
        (point[1] - initialPlanPoint[1]) * planAxis[1]
      return { [dim]: snapFootingSize(initial + delta * 2, free) }
    })
  },
}

/** A pad turned about its centre, in the angle steps unless snapping to angles is off. */
export const footingRotateAffordance: FloorplanAffordance<FootingNode> = {
  start({ node, initialPlanPoint }) {
    const center = node.center ?? [0, 0]
    const initialRotation = node.rotation ?? 0
    const initialAngle = Math.atan2(
      initialPlanPoint[1] - center[1],
      initialPlanPoint[0] - center[0],
    )
    return patchSession(node, (point) => ({
      // The plan turns a pad by -rotation (three.js turns Y the other way), as columns do.
      rotation:
        initialRotation -
        rotateAffordanceDelta({
          center: [center[0], center[1]],
          initialAngle,
          planPoint: point,
          free: !isAngleSnapActive(),
        }),
    }))
  },
}
