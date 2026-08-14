import type { AnyNodeId } from '../../../schema/types'

/**
 * A pour unit is one (element × segment × lift) — the thing that is actually
 * cast in a single operation, and therefore the thing a shutter, a tie grid, a
 * bulkhead, and a payment line all belong to.
 *
 * The element is not the unit of work. A 9 m wall is poured in lifts, because
 * the tie grid and the pressure envelope only make sense for a bounded fill
 * height; a 40 m wall is cut into segments, because a pour that outruns the
 * batch plant sets before it is finished and becomes a cold joint. Both cuts
 * produce separately erected, separately struck, separately paid-for work.
 */

/** Why a cut exists. A hard cut is a constraint; a soft cut the solver chose. */
export type PourCutReason =
  /** An expansion or isolation joint — structurally independent sides. */
  | 'HARD_JOINT'
  /** Shrinkage control: the segment would exceed the max pour length. */
  | 'MAX_POUR_LENGTH'
  /** The segment would exceed what the plant can supply before initial set. */
  | 'MAX_POUR_VOLUME'
  /** The lift would exceed the max fill height for the system or the ties. */
  | 'MAX_LIFT_HEIGHT'

export const POUR_CUT_REASON_LABELS: Record<PourCutReason, string> = {
  HARD_JOINT: 'Expansion or isolation joint — cannot be bridged by one pour',
  MAX_POUR_LENGTH: 'Split for shrinkage control — over the max pour length',
  MAX_POUR_VOLUME: 'Split to stay within the concrete supply for one pour',
  MAX_LIFT_HEIGHT: 'Split into lifts — over the max fill height',
}

/** A vertical slice of an element, in its own along-the-centreline frame. */
export interface PourSegment {
  index: number
  /** Distance along the centreline where the segment starts, m. */
  startAlong: number
  /** Distance along the centreline where it ends, m. */
  endAlong: number
  /** Why the cut at `startAlong` exists. Absent for the element's own start. */
  startCutReason?: PourCutReason
  /** Why the cut at `endAlong` exists. Absent for the element's own end. */
  endCutReason?: PourCutReason
}

/** A horizontal slice, measured up from the element's base. */
export interface PourLift {
  index: number
  /** Elevation of the lift's underside above the element base, m. */
  baseElevation: number
  /** Elevation of its top above the element base, m. */
  topElevation: number
  /**
   * True when this lift sits on a construction joint rather than the kicker or
   * substrate — i.e. every lift but the bottom one. The joint below carries the
   * treatments (roughening, shear key, starter bars) that the stop-end
   * forming it has to provide.
   */
  hasJointBelow: boolean
  /** Set when the lift joint was moved to a permitted elevation. */
  snappedTo?: number
  /**
   * Who decided the joint below this lift. The distinction the whole Phase 2 contract
   * hangs on: a boundary the project stated and one the solver chose are not the same
   * decision, and a boundary the solver had to place somewhere the project did not permit
   * is a conflict rather than a design.
   *
   * Absent on the bottom lift, which has no joint below it.
   */
  jointSource?: /** The engineer drew it — a required joint, which is a cut whatever the caps say. */
    | 'specified'
    /** The solver moved a uniform cut onto a stated permitted elevation. */
    | 'permitted'
    /** The solver's own uniform grid, with no permitted set stated to snap to. */
    | 'solver'
    /** A permitted set was stated but this boundary is on none of it — the conflict. */
    | 'off-permitted'
}

/**
 * A lift boundary the split needed that no permitted elevation satisfies.
 *
 * The answer to "the element must be split, and the project has said where a joint may
 * go, and this boundary is on none of it". Carried separately from the lift rather than
 * only as `jointSource: 'off-permitted'` because it has to travel up to the project
 * solution as a finding, and a finding wants the limit and the permitted set named next
 * to it — a boundary and its remedy are one sentence.
 */
export interface PourLiftConflict {
  elementId: AnyNodeId
  /** The lift whose joint below it is the conflict. */
  liftIndex: number
  /** Where the split put it, m above the element base. */
  boundaryElevation: number
  /**
   * The lift cap that forced a boundary — the figure that made the split impossible to
   * satisfy on the permitted set, m. What the report names as "the limit".
   */
  maxLiftHeight: number
  /** The stated permitted elevations the boundary is on none of, for the report to name. */
  permittedJointElevations: readonly number[]
}

export interface PourUnit {
  elementId: AnyNodeId
  segmentIndex: number
  liftIndex: number
  /** Contact-relevant extents, in the element's own frame. */
  startAlong: number
  endAlong: number
  baseElevation: number
  topElevation: number
  /** Concrete volume of this unit, m³ — what the plant has to deliver. */
  volumeCuM: number
  hasJointBelow: boolean
  startCutReason?: PourCutReason
  endCutReason?: PourCutReason
}

/**
 * Limits that drive the split. All optional: absent means "no limit from this
 * source", so an unconfigured project yields exactly one pour unit per element
 * — the same answer the engine gave before lifts existed.
 */
export interface PourLimits {
  /** Max fill height per lift, m. The tightest of system, bracket, tie limits. */
  maxLiftHeight?: number
  /** Max segment length along the centreline, m. Shrinkage control. */
  maxPourLength?: number
  /** Max concrete per pour, m³. Batch-plant supply and pump rate. */
  maxPourVolume?: number
  /**
   * Elevations a lift joint is allowed to land on — undersides of slabs and
   * beams, tops of slabs, and existing joint nodes. A uniform split rarely
   * lands on one, and a joint 200 mm below a slab soffit leaves an unformable
   * strip, so cuts snap to these when one is within `jointSnapTolerance`.
   */
  permittedJointElevations?: readonly number[]
  /** How far a lift joint may move to reach a permitted elevation, m. */
  jointSnapTolerance?: number
  /**
   * Elevations a lift joint *must* land on — a joint somebody drew rather than one
   * the solver may choose. Unlike `permittedJointElevations`, which only attracts a
   * cut the uniform split already put nearby, these produce a cut on their own and
   * split an element with no lift cap at all: an engineer who specifies a joint at
   * 4.6 m has decided where the pour stops, and a split that divides uniformly
   * through it is designing a shutter for a pour nobody is going to make.
   */
  requiredJointElevations?: readonly number[]
}
