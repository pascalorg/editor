import {
  type AnyNodeId,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  type StairNode,
  type StairSegmentNode,
  useScene,
} from '@pascal-app/core'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'

// Minimums + max sweep mirror the 3D handles in
// `packages/editor/src/components/editor/stair-segment-handles.tsx` so a 2D
// drag can't push a stair past what the 3D drag would allow.
const MIN_SEGMENT_WIDTH = 0.4
const MIN_SEGMENT_LENGTH = 0.4
const MIN_CURVED_WIDTH = 0.4
const MIN_CURVED_INNER_RADIUS_SPIRAL = 0.05
const MIN_CURVED_INNER_RADIUS_CURVED = 0.2
const MIN_CURVED_SWEEP = Math.PI / 12
const MAX_CURVED_SWEEP = Math.PI * 2 - 0.05

type SegmentWidthPayload = {
  segmentId: string
  side: 'left' | 'right'
  axisX: readonly [number, number]
}

type SegmentLengthPayload = {
  segmentId: string
  axisZ: readonly [number, number]
}

type CurvedSweepPayload = {
  end: 'start' | 'end'
}

function noopSession(): FloorplanAffordanceSession {
  return {
    affectedIds: [],
    apply() {},
    canCommit() {
      return false
    },
  }
}

/**
 * Straight-stair segment side arrow → segment `width`. Sister to the 3D
 * `StairSegmentSideArrow` width drag (~line 235 of stair-segment-handles.tsx).
 * Width grows symmetrically around the segment centerline — the chain
 * rebuilds from the segment's `width` field, no opposite-edge anchor write
 * required. `axisX` is the segment-local +X axis in plan coords, captured
 * at emit-time so the projection stays valid through the drag.
 */
export const segmentWidthAffordance: FloorplanAffordance<StairNode> = {
  start({ payload, nodes, initialPlanPoint }) {
    const { segmentId, side, axisX } = payload as SegmentWidthPayload
    const segmentNodeId = segmentId as AnyNodeId
    const segment = nodes[segmentNodeId] as StairSegmentNode | undefined
    if (segment?.type !== 'stair-segment') return noopSession()

    const initialWidth = segment.width
    const sign = side === 'right' ? 1 : -1
    const ax = axisX[0]
    const ay = axisX[1]
    const initialProj = initialPlanPoint[0] * ax + initialPlanPoint[1] * ay
    let lastWidth = initialWidth

    return {
      affectedIds: [segmentNodeId],
      apply({ planPoint }) {
        const currentProj = planPoint[0] * ax + planPoint[1] * ay
        const delta = sign * (currentProj - initialProj)
        const newWidth = Math.max(MIN_SEGMENT_WIDTH, initialWidth + delta)
        lastWidth = newWidth
        useScene.getState().updateNode(segmentNodeId, { width: newWidth })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(segmentNodeId, { width: lastWidth })
      },
    }
  },
}

/**
 * Straight-stair segment length arrow → segment `length`. Sister to the 3D
 * `StairSegmentLengthArrow` drag. The chain anchors each segment's back
 * face, so length simply extends/contracts the front. `axisZ` is the
 * segment-local +Z (run) direction in plan coords.
 */
export const segmentLengthAffordance: FloorplanAffordance<StairNode> = {
  start({ payload, nodes, initialPlanPoint }) {
    const { segmentId, axisZ } = payload as SegmentLengthPayload
    const segmentNodeId = segmentId as AnyNodeId
    const segment = nodes[segmentNodeId] as StairSegmentNode | undefined
    if (segment?.type !== 'stair-segment') return noopSession()

    const initialLength = segment.length
    const az = axisZ[0]
    const ay = axisZ[1]
    const initialProj = initialPlanPoint[0] * az + initialPlanPoint[1] * ay
    let lastLength = initialLength

    return {
      affectedIds: [segmentNodeId],
      apply({ planPoint }) {
        const currentProj = planPoint[0] * az + planPoint[1] * ay
        const delta = currentProj - initialProj
        const newLength = Math.max(MIN_SEGMENT_LENGTH, initialLength + delta)
        lastLength = newLength
        useScene.getState().updateNode(segmentNodeId, { length: newLength })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(segmentNodeId, { length: lastLength })
      },
    }
  },
}

/**
 * Curved / spiral width arrow → stair `width`. Drag radially outward grows
 * the body, anchored at the inner radius (matches the 3D
 * `CurvedStairWidthArrow`). The sweep bisector matches the existing
 * floor-plan emitter (`sectorStartAngle = -rotation - sweep/2`, bisector
 * = -rotation).
 */
export const curvedStairWidthAffordance: FloorplanAffordance<StairNode> = {
  start({ node, initialPlanPoint }) {
    const stairId = node.id as AnyNodeId
    const initialWidth = Math.max(node.width ?? 1, MIN_CURVED_WIDTH)
    const midAngle = -node.rotation
    const cx = node.position[0]
    const cz = node.position[2]
    const radialX = Math.cos(midAngle)
    const radialZ = Math.sin(midAngle)
    const initialRadial =
      (initialPlanPoint[0] - cx) * radialX + (initialPlanPoint[1] - cz) * radialZ
    let lastWidth = initialWidth

    return {
      affectedIds: [stairId],
      apply({ planPoint }) {
        const currentRadial = (planPoint[0] - cx) * radialX + (planPoint[1] - cz) * radialZ
        const newWidth = Math.max(MIN_CURVED_WIDTH, initialWidth + (currentRadial - initialRadial))
        lastWidth = newWidth
        useScene.getState().updateNode(stairId, { width: newWidth })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(stairId, { width: lastWidth })
      },
    }
  },
}

/**
 * Curved / spiral inner-radius arrow → stair `innerRadius` + `width`. Keeps
 * the outer edge pinned (width absorbs the radial delta) so dragging only
 * shifts the inner rim, matching the 3D `CurvedStairInnerRadiusArrow`.
 */
export const curvedStairInnerRadiusAffordance: FloorplanAffordance<StairNode> = {
  start({ node, initialPlanPoint }) {
    const stairId = node.id as AnyNodeId
    const isSpiral = node.stairType === 'spiral'
    const minInnerRadius = isSpiral
      ? MIN_CURVED_INNER_RADIUS_SPIRAL
      : MIN_CURVED_INNER_RADIUS_CURVED
    const initialInnerRadius = Math.max(minInnerRadius, node.innerRadius ?? 0.9)
    const initialWidth = Math.max(node.width ?? 1, MIN_CURVED_WIDTH)
    const initialOuterRadius = initialInnerRadius + initialWidth
    const maxInnerRadius = initialOuterRadius - MIN_CURVED_WIDTH

    const midAngle = -node.rotation
    const cx = node.position[0]
    const cz = node.position[2]
    const radialX = Math.cos(midAngle)
    const radialZ = Math.sin(midAngle)
    const initialRadial =
      (initialPlanPoint[0] - cx) * radialX + (initialPlanPoint[1] - cz) * radialZ
    let lastInner = initialInnerRadius
    let lastWidth = initialWidth

    return {
      affectedIds: [stairId],
      apply({ planPoint }) {
        const currentRadial = (planPoint[0] - cx) * radialX + (planPoint[1] - cz) * radialZ
        const innerDelta = currentRadial - initialRadial
        const newInner = Math.min(
          maxInnerRadius,
          Math.max(minInnerRadius, initialInnerRadius + innerDelta),
        )
        const newWidth = initialOuterRadius - newInner
        lastInner = newInner
        lastWidth = newWidth
        useScene.getState().updateNode(stairId, { innerRadius: newInner, width: newWidth })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(stairId, { innerRadius: lastInner, width: lastWidth })
      },
    }
  },
}

/**
 * Whole-stair rotation gizmo → stair `rotation`. Mirrors the 3D
 * `stairRotateHandle` (arc-resize, curved-arrow shape). Angular drag
 * around the stair's plan-space pivot — atan2 ticks CW visually, the
 * stored `rotation` field is the schema's Y-axis radians, and the
 * floorplan plots sectors at `-rotation`, so a positive cursor delta
 * (CCW around the centre in standard math coords / CW on screen given
 * inverted Y) should DECREASE `rotation`. Same `- delta` convention the
 * 3D handle uses; cursor handedness across both views matches.
 */
export const stairRotateAffordance: FloorplanAffordance<StairNode> = {
  start({ node, initialPlanPoint }) {
    const stairId = node.id as AnyNodeId
    const initialRotation = node.rotation ?? 0
    const cx = node.position[0]
    const cz = node.position[2]
    const initialAngle = Math.atan2(initialPlanPoint[1] - cz, initialPlanPoint[0] - cx)
    let lastRotation = initialRotation

    return {
      affectedIds: [stairId],
      apply({ planPoint, modifiers }) {
        const delta = rotateAffordanceDelta({
          center: [cx, cz],
          initialAngle,
          planPoint,
          free: modifiers.shiftKey,
        })
        const newRotation = initialRotation - delta
        lastRotation = newRotation
        useScene.getState().updateNode(stairId, { rotation: newRotation })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(stairId, { rotation: lastRotation })
      },
    }
  },
}

/**
 * Curved / spiral sweep arrows → stair `sweepAngle` + `rotation`. Anchors
 * the opposite edge world-fixed by nudging `rotation` by half the applied
 * sweep delta — mirror of the 3D `CurvedStairSweepArrow`. Sign math derives
 * from the floorplan convention `sectorStartAngle = -rotation - sweep/2`:
 *
 *   END handle  (sweep += Δ, fix start): ΔR = -Δ/2
 *   START handle (sweep -= Δ, fix end):  ΔR = +Δ/2
 */
export const curvedStairSweepAffordance: FloorplanAffordance<StairNode> = {
  start({ node, payload, initialPlanPoint }) {
    const { end } = payload as CurvedSweepPayload
    const stairId = node.id as AnyNodeId
    const initialSweep =
      node.sweepAngle ?? (node.stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2)
    const sweepSign = Math.sign(initialSweep) || 1
    const initialRotation = node.rotation
    const cx = node.position[0]
    const cz = node.position[2]
    const initialAngle = Math.atan2(initialPlanPoint[1] - cz, initialPlanPoint[0] - cx)
    let lastSweep = initialSweep
    let lastRotation = initialRotation

    return {
      affectedIds: [stairId],
      apply({ planPoint }) {
        const currentAngle = Math.atan2(planPoint[1] - cz, planPoint[0] - cx)
        let delta = currentAngle - initialAngle
        // Wrap to [-π, π] so a drag crossing ±π doesn't flip sign mid-gesture.
        while (delta > Math.PI) delta -= 2 * Math.PI
        while (delta < -Math.PI) delta += 2 * Math.PI

        const sweepDelta = end === 'end' ? delta : -delta
        const targetSweep = initialSweep + sweepDelta
        const clampedAbs = Math.min(
          MAX_CURVED_SWEEP,
          Math.max(MIN_CURVED_SWEEP, Math.abs(targetSweep)),
        )
        const newSweep = sweepSign * clampedAbs
        const appliedDelta = newSweep - initialSweep
        const rotationShift = end === 'end' ? -appliedDelta / 2 : appliedDelta / 2
        const newRotation = initialRotation + rotationShift
        lastSweep = newSweep
        lastRotation = newRotation
        useScene.getState().updateNode(stairId, { sweepAngle: newSweep, rotation: newRotation })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(stairId, { sweepAngle: lastSweep, rotation: lastRotation })
      },
    }
  },
}
