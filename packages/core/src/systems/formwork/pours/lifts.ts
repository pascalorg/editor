import type { CastableElement } from '../coverage/elements'
import type { PourLift, PourLiftConflict, PourLimits } from './types'

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
 *
 * Every joint below a lift is labelled with who decided it. The permitted set a
 * project states is the only source that can be *disobeyed*, so a boundary the
 * solver has to place on none of it is not silently dropped or left unlabelled —
 * it is marked `off-permitted` and `pourLiftConflicts` turns that into a finding.
 */

const MIN_LIFT_HEIGHT = 1e-3
/** The strip below a slab soffit that is too shallow to form or vibrate, m. */
export const DEFAULT_SNAP_TOLERANCE = 0.3

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

/** The element's own cap and the project limit, resolved to the one that governs. */
export function resolveMaxLiftHeight(
  element: CastableElement,
  limits: PourLimits,
): number | undefined {
  const caps = [limits.maxLiftHeight, element.maxLiftHeight].filter(
    (value): value is number => value !== undefined && value > MIN_LIFT_HEIGHT,
  )
  return caps.length === 0 ? undefined : Math.min(...caps)
}

export function splitIntoLifts(element: CastableElement, limits: PourLimits = {}): PourLift[] {
  const height = element.height
  const wholeElement: PourLift[] = [
    { index: 0, baseElevation: 0, topElevation: height, hasJointBelow: false },
  ]
  if (height <= MIN_LIFT_HEIGHT) return wholeElement

  // A joint somebody drew is a cut whatever the caps say, so it is resolved before
  // them: an uncapped wall with a specified joint at 4.6 m is two lifts, and the
  // early return below would have made it one.
  const required = (limits.requiredJointElevations ?? []).filter(
    (elevation) => elevation > MIN_LIFT_HEIGHT && elevation < height - MIN_LIFT_HEIGHT,
  )

  // The element's own cap and the project limit are both ceilings, so the
  // tighter one governs — a wall the engineer capped at 2 m is not permitted a
  // 3 m lift just because the project allows one.
  const maxLift = resolveMaxLiftHeight(element, limits)
  if (required.length === 0 && (maxLift === undefined || height <= maxLift)) return wholeElement

  // No cap, or a cap the element is already inside: the uniform division is the
  // element itself, and the required joints are the only cuts.
  const count = maxLift === undefined ? 1 : Math.ceil(height / maxLift)
  const uniform = height / count
  // A required elevation is permitted by construction, which is also what keeps the
  // uniform grid from landing a 50 mm lift beside a specified joint: a nearby uniform
  // cut snaps onto it and the duplicate collapse below removes it.
  const permitted = [...(limits.permittedJointElevations ?? []), ...required]
  const tolerance = limits.jointSnapTolerance ?? DEFAULT_SNAP_TOLERANCE
  // The project's own set, which is what "off-permitted" is measured against: a uniform
  // cut that misses only a joint the engineer drew is not a conflict, because there was
  // no permitted set to be on.
  const projectPermitted = limits.permittedJointElevations ?? []

  // Interior joint elevations only — the element's own base and top are fixed
  // by the structure, not by the split, so they are never snapped.
  const joints: Array<{
    elevation: number
    snappedTo?: number
    jointSource: NonNullable<PourLift['jointSource']>
  }> = []
  // `snappedTo: elevation` rather than left blank: it means "this joint is on an
  // elevation the structure offers", which a specified joint is by definition, and the
  // off-permitted-elevation warning reads exactly that field — blank here would have it
  // fault the engineer's own joint for being where the engineer put it.
  for (const elevation of required)
    joints.push({ elevation, snappedTo: elevation, jointSource: 'specified' })
  for (let index = 1; index < count; index++) {
    const uniformElevation = uniform * index
    const snapped =
      permitted.length > 0 ? snapElevation(uniformElevation, permitted, tolerance) : undefined
    joints.push({
      elevation: snapped ?? uniformElevation,
      snappedTo: snapped,
      // A uniform cut is the solver's by default. It only becomes a permitted boundary
      // when it actually snapped, and it becomes a *conflict* when a permitted set was
      // stated and this boundary is on none of it.
      jointSource: snapped ? 'permitted' : projectPermitted.length > 0 ? 'off-permitted' : 'solver',
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
      jointSource: joint.jointSource,
    })
  }

  return lifts
}

/**
 * The off-permitted boundaries of a produced split, as findings.
 *
 * `limits` is the project's own set and `maxLiftHeight` the resolved cap, so a conflict
 * can name both halves of the problem: the limit that forced a boundary, and the
 * permitted joints the boundary is on none of.
 */
export function pourLiftConflicts(
  elementId: CastableElement['id'],
  lifts: readonly PourLift[],
  limits: PourLimits,
  maxLiftHeight: number | undefined,
): PourLiftConflict[] {
  const permitted = limits.permittedJointElevations ?? []
  const out: PourLiftConflict[] = []
  for (const lift of lifts) {
    if (!lift.hasJointBelow || lift.jointSource !== 'off-permitted') continue
    out.push({
      elementId,
      liftIndex: lift.index,
      boundaryElevation: lift.baseElevation,
      maxLiftHeight: maxLiftHeight ?? 0,
      permittedJointElevations: permitted,
    })
  }
  return out
}
