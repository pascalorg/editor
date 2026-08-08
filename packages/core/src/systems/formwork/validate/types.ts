import type { AnyNodeId } from '../../../schema/types'

/**
 * Validation vocabulary — solver phase 11.
 *
 * Every other formwork module answers "what does this need". This one answers
 * "is what it needs buildable", and the two are different assertions: a bill
 * that totals correctly and a shutter that stands up have almost no overlap in
 * what makes them wrong. Until this existed the feature could produce an order
 * for a whole floor and had no way to say the order was for something nobody
 * could erect.
 *
 * A finding is never a bare string. It carries the ids it is about, so the panel
 * can select them and the AI can name them; a `severity`, because an unformable
 * strip and a skew corner without a hinged unit are not the same conversation;
 * and a `detail` naming the figures that failed, because "tie spacing exceeded"
 * without the two numbers is a claim the reader cannot check.
 */

/**
 * Error: the thing described cannot be built as specified, and proceeding
 * produces either a blowout or a shutter nobody can erect. Warning: buildable,
 * but by an exception somebody has to accept — a bespoke corner, a hand-cut
 * filler, a design outside the code's validated envelope.
 *
 * The split is deliberately about *buildability* rather than confidence. A
 * severity that means "how sure are we" produces a list sorted by the author's
 * mood; one that means "can the crew proceed" sorts by what the reader has to
 * do next.
 */
export type FindingSeverity = 'error' | 'warning'

export type InvariantId =
  /** The cast-order graph has a cycle: A butts B butts C butts A. */
  | 'CAST_ORDER_CYCLE'
  /** A single-sided element's anchor host is cast later than it, or absent. */
  | 'SINGLE_SIDED_ANCHOR_NOT_EARLIER'
  /** Trimmed face areas do not sum to the true wrapped area of the element. */
  | 'AREA_DOUBLE_COUNTED'
  /** A run has a stretch no panel, filler or cut board closes. */
  | 'UNFORMABLE_STRIP'
  /** A filler narrower than anything a carpenter can make and fix. */
  | 'FILLER_BELOW_MINIMUM'
  /** No tie in the system reaches this wall thickness. */
  | 'WALL_OUTSIDE_TIE_RANGE'
  /** An architectural face whose tie grid is not symmetric about the run. */
  | 'ARCHITECTURAL_TIE_GRID_ASYMMETRIC'
  /** An opening crossing a lift joint — the bulkhead runs through the void. */
  | 'OPENING_STRADDLES_LIFT_JOINT'
  /** A junction angle outside every hinged corner unit's sweep. */
  | 'JUNCTION_ANGLE_UNFITTABLE'
  /** An expansion joint bridged by a single pour unit. */
  | 'EXPANSION_JOINT_BRIDGED'
  /** A waterstop run that does not close across the pours it separates. */
  | 'WATERSTOP_RUN_NOT_CLOSED'
  /** A lift joint that did not land on a permitted elevation. */
  | 'LIFT_JOINT_OFF_PERMITTED_ELEVATION'
  /** A pour unit's volume over what one delivery can supply before initial set. */
  | 'POUR_VOLUME_OVER_SUPPLY'
  /** A code boundary condition the design is outside — slump, rate, height. */
  | 'DESIGN_OUTSIDE_CODE_ENVELOPE'

export interface Finding {
  invariant: InvariantId
  severity: FindingSeverity
  /**
   * The elements this is about. Plural because the interesting failures are
   * relational — a cycle names its whole ring, a bridged joint both sides — and
   * a finding that named only the first would send the reader to a wall that
   * looks fine on its own.
   */
  elementIds: AnyNodeId[]
  /** One sentence, naming the figures. Shown as-is on screen and to the model. */
  message: string
  /** Where in the element, when the finding is local to a station or elevation. */
  locus?: {
    /** Distance along the centreline, m. */
    alongM?: number
    /** Elevation above the element base, m. */
    elevationM?: number
    segmentIndex?: number
    liftIndex?: number
  }
}

/**
 * What a scope's validation found, and — as importantly — what it could not look
 * at.
 *
 * `notChecked` exists because a validation report that lists only failures reads
 * as a clean bill of health for everything it never examined. Six of the plan's
 * assertions need data this scene has no schema for (rebar geometry, crane
 * curves, site supply rates), and an unchecked assertion silently absent is how
 * a user comes to believe the shutter was checked against rebar it was never
 * compared to.
 */
export interface ValidationReport {
  findings: Finding[]
  errorCount: number
  warningCount: number
  /** Elements that were examined. A scope with none is not a scope that passed. */
  elementIds: AnyNodeId[]
  /** Invariants that could not run here, and the input each one wanted. */
  notChecked: Array<{ invariant: InvariantId | string; needs: string }>
}

export const INVARIANT_LABELS: Record<InvariantId, string> = {
  CAST_ORDER_CYCLE: 'Cast order forms a cycle',
  SINGLE_SIDED_ANCHOR_NOT_EARLIER: 'Single-sided pour has no earlier anchor',
  AREA_DOUBLE_COUNTED: 'Formed areas do not sum to the wrapped area',
  UNFORMABLE_STRIP: 'A stretch of the run cannot be formed',
  FILLER_BELOW_MINIMUM: 'Make-up piece too narrow to fix',
  WALL_OUTSIDE_TIE_RANGE: 'No tie reaches this wall thickness',
  ARCHITECTURAL_TIE_GRID_ASYMMETRIC: 'Architectural face has an asymmetric tie grid',
  OPENING_STRADDLES_LIFT_JOINT: 'Opening crosses a lift joint',
  JUNCTION_ANGLE_UNFITTABLE: 'Junction angle needs a bespoke corner',
  EXPANSION_JOINT_BRIDGED: 'Expansion joint bridged by one pour',
  WATERSTOP_RUN_NOT_CLOSED: 'Waterstop run does not close',
  LIFT_JOINT_OFF_PERMITTED_ELEVATION: 'Lift joint not on a permitted elevation',
  POUR_VOLUME_OVER_SUPPLY: 'Pour volume over the supply limit',
  DESIGN_OUTSIDE_CODE_ENVELOPE: 'Design outside the code’s validated envelope',
}
