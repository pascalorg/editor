import type { CastableElement } from '../coverage/elements'
import type { PourLift, PourLimits } from './types'

/**
 * Vertical split — solver Phase 2.
 *
 * `maxLiftHeight` is the tightest of several unrelated limits: the panel
 * system's stack height, the bracket limit for single-sided work (~4.0 m), the
 * height at which the pressure envelope exhausts the available tie capacity,
 * and whatever the user forced. Resolving those belongs to the design phase;
 * this function takes the resolved number and does the geometry.
 *
 * Uniform-then-snap, not snap-then-fill. A uniform split gives every lift the
 * same fill height, which is what makes one tie grid reusable across them; the
 * snap then moves joints onto permitted elevations, because a lift joint landing
 * 200 mm below a slab soffit leaves a strip too shallow to form or vibrate.
 */

const MIN_LIFT_HEIGHT = 1e-3
const DEFAULT_SNAP_TOLERANCE = 0.3

/** The permitted elevation nearest `elevation`, if one is within tolerance. */
function snapElevation(
  elevation: number,
  permitted: readonly number[],
  tolerance: number,
): number | undefined {
  let best: number | undefined
  let bestDistance = tolerance
  for (const candidate of permitted) {
    const distance = Math.abs(candidate - elevation)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

export function splitIntoLifts(element: CastableElement, limits: PourLimits = {}): PourLift[] {
  const height = element.height
  const wholeElement: PourLift[] = [
    { index: 0, baseElevation: 0, topElevation: height, hasJointBelow: false },
  ]
  if (height <= MIN_LIFT_HEIGHT) return wholeElement

  // The element's own cap and the project limit are both ceilings, so the
  // tighter one governs — a wall the engineer capped at 2 m is not permitted a
  // 3 m lift just because the project allows one.
  const caps = [limits.maxLiftHeight, element.maxLiftHeight].filter(
    (value): value is number => value !== undefined && value > MIN_LIFT_HEIGHT,
  )
  if (caps.length === 0) return wholeElement
  const maxLift = Math.min(...caps)
  if (height <= maxLift) return wholeElement

  const count = Math.ceil(height / maxLift)
  const uniform = height / count
  const permitted = limits.permittedJointElevations ?? []
  const tolerance = limits.jointSnapTolerance ?? DEFAULT_SNAP_TOLERANCE

  // Interior joint elevations only — the element's own base and top are fixed
  // by the structure, not by the split, so they are never snapped.
  const joints: Array<{ elevation: number; snappedTo?: number }> = []
  for (let index = 1; index < count; index++) {
    const uniformElevation = uniform * index
    const snapped =
      permitted.length > 0 ? snapElevation(uniformElevation, permitted, tolerance) : undefined
    joints.push({
      elevation: snapped ?? uniformElevation,
      snappedTo: snapped,
    })
  }

  // Snapping is per-joint, so two adjacent joints can land on the same
  // permitted elevation and collapse a lift to nothing. Drop the duplicates
  // rather than emit a zero-height lift the layout would divide by.
  const ordered = joints
    .filter((joint) => joint.elevation > MIN_LIFT_HEIGHT && joint.elevation < height)
    .sort((a, b) => a.elevation - b.elevation)
  const distinct: typeof ordered = []
  for (const joint of ordered) {
    const previous = distinct[distinct.length - 1]
    if (previous && joint.elevation - previous.elevation <= MIN_LIFT_HEIGHT) continue
    distinct.push(joint)
  }

  if (distinct.length === 0) return wholeElement

  // `snappedTo` describes the joint *below* a lift, so joint i becomes the base
  // of lift i+1 and the bottom lift never carries one.
  const lifts: PourLift[] = [
    {
      index: 0,
      baseElevation: 0,
      topElevation: distinct[0]?.elevation ?? height,
      hasJointBelow: false,
    },
  ]
  for (const [index, joint] of distinct.entries()) {
    lifts.push({
      index: index + 1,
      baseElevation: joint.elevation,
      topElevation: distinct[index + 1]?.elevation ?? height,
      hasJointBelow: true,
      snappedTo: joint.snappedTo,
    })
  }

  return lifts
}
