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
  /** A drilled tie hole inside the width of a waterstop — a hole through the seal. */
  | 'TIE_THROUGH_WATERSTOP'
  /** A lift joint that did not land on a permitted elevation. */
  | 'LIFT_JOINT_OFF_PERMITTED_ELEVATION'
  /** A pour unit's volume over what one delivery can supply before initial set. */
  | 'POUR_VOLUME_OVER_SUPPLY'
  /** A code boundary condition the design is outside — slump, rate, height. */
  | 'DESIGN_OUTSIDE_CODE_ENVELOPE'
  /** An opening leaving a stretch of a tie row with no tie able to pass. */
  | 'OPENING_LEAVES_TIE_GAP'
  /** Two corner units on one face claiming the same stretch of it. */
  | 'CORNER_UNITS_OVERLAP'
  /** An opening jamb inside the stretch a corner unit occupies. */
  | 'OPENING_INSIDE_CORNER_UNIT'
  /** Concurrent pours need more of a part at once than the yard owns or has hired. */
  | 'SET_COUNT_SHORTAGE'
  /** A gang weighs more than the site's crane takes at the radius it must reach. */
  | 'GANG_WEIGHT_OVER_CRANE_CAPACITY'
  /** A gang's slings want more height between its top and the hook than the crane has. */
  | 'GANG_HEADROOM_OVER_HOOK_HEIGHT'
  /** The pour puts more pressure on the panels than they are rated for. */
  | 'PANEL_PRESSURE_OVER_RATING'
  /** The concrete cannot arrive fast enough to rise at the rate the project stated. */
  | 'POUR_RATE_OVER_CONCRETE_SUPPLY'

/**
 * One stretch a through-tie could pass over, and the stations at which it can.
 *
 * The extent is carried with the stations because it is what makes a missing one
 * mean anything: "nothing between 4.1 and 4.3 m" is a defect inside the stretch
 * this field covers and says nothing whatever about the stretch beside it.
 *
 * A stretch rather than a whole element, and a whole shutter, because both bound
 * the answer. A pour unit forms part of a wall, so its stations say nothing about
 * the next unit's; and a corner unit interrupts the panel run, ties through its own
 * holes on the catalog's spacing, and is not short of a tie the panels would have
 * brought. Merging either would report a band as tied by hardware that is not over
 * it, or untied where the corner unit ties it.
 */
export interface TieField {
  /** The stretch this field answers for, m along the element from its start. */
  fromM: number
  toM: number
  /**
   * Stations a rod passes — on a panel system the two skins' drilled holes
   * intersected, m along the element and m above its base — before the openings
   * take any away.
   *
   * Unfiltered deliberately. The openings are the validator's own input, and
   * removing the stations they block here would hide exactly the loss it asserts
   * about. Empty on a conventional shutter: the carpenter bores the ply where the
   * calculation asks, so there is no fixed grid a band can be short of.
   */
  holes: ReadonlyArray<{ alongM: number; elevationM: number }>
}

/**
 * The writes this feature has. A remedy may name no other, because no other
 * exists — a fix that pointed at a tool nobody wrote is a button that cannot be
 * pressed, which is worse than saying outright that nothing here helps.
 */
export type FormworkWriteTool =
  | 'set_element_construction'
  | 'set_pour_limits'
  | 'set_pour_date'
  | 'set_formwork_settings'
  | 'set_formwork_part'

/**
 * `write` — the call and every argument are known, so applying it is mechanical.
 * `choice` — the call is known and one argument is a decision about the world or
 * the design, so a surface offers the call and never fills it in. `none` — no
 * write in this feature clears it, and the note says what would instead.
 */
export type RemedyKind = 'write' | 'choice' | 'none'

/**
 * What to do about a finding.
 *
 * Lives here rather than in `remedy.ts` because a `Finding` carries one, and the
 * two modules would otherwise import each other. `remedy.ts` owns the table and
 * the classification; this owns only the shape.
 */
export interface FormworkRemedy {
  kind: RemedyKind
  /** Absent on `none`, where naming a tool would imply one helps. */
  tool?: FormworkWriteTool
  /** Argument-complete, on `write` alone. Applied as given. */
  args?: Record<string, string | number | null>
  /** The one argument a `choice` leaves to the caller. */
  field?: string
  /** What applying this does, or — on `none` — what would have to change instead. */
  note: string
  /**
   * Set where the write re-splits the element, so the shutters no longer match
   * the pour until `attach_formwork` runs.
   *
   * Every pour-limit remedy carries it. Changing a cap builds nothing on its own,
   * and between the two calls the element is cast in more pours than it is formed
   * for — so a fix that stopped at the first call would clear the finding and
   * leave the takeoff short by the difference, which is worse than the finding
   * was.
   */
  thenAttach?: true
}

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
  /**
   * The fix, where this finding's own figures decide it rather than its invariant.
   *
   * Absent on most findings, which take the invariant's default from `remedy.ts`.
   * Present where the instance disagrees with its own kind — a volume overrun has
   * a cap that fixes it on a wall and none on a slab, and an opening across a lift
   * joint has one only if some cap moves every joint clear — and where the
   * arguments are figures the check already holds. A remedy derived a second time,
   * from the report rather than from the run, is how a fix comes to disagree with
   * the finding it was offered for.
   */
  remedy?: FormworkRemedy
}

/**
 * What a scope's validation found, and — as importantly — what it could not look
 * at.
 *
 * `notChecked` exists because a validation report that lists only failures reads
 * as a clean bill of health for everything it never examined. Some of the plan's
 * assertions need data this scene has no schema for (rebar geometry, a slab's
 * capacity at a prop position, a system's minimum radius), and an unchecked
 * assertion silently absent is how a user comes to believe the shutter was
 * checked against rebar it was never compared to.
 *
 * The entries move as the schema grows. A crane's load chart was in this list
 * until the settings gained one, and the check it blocked now runs wherever a
 * project has recorded a curve — which is why the conditional entries name the
 * input to record rather than a permanent absence.
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
  TIE_THROUGH_WATERSTOP: 'A tie passes through the waterstop',
  LIFT_JOINT_OFF_PERMITTED_ELEVATION: 'Lift joint not on a permitted elevation',
  POUR_VOLUME_OVER_SUPPLY: 'Pour volume over the supply limit',
  DESIGN_OUTSIDE_CODE_ENVELOPE: 'Design outside the code’s validated envelope',
  OPENING_LEAVES_TIE_GAP: 'Opening leaves a stretch with no tie',
  CORNER_UNITS_OVERLAP: 'Two corner units claim the same stretch of face',
  OPENING_INSIDE_CORNER_UNIT: 'Opening jamb falls inside a corner unit',
  SET_COUNT_SHORTAGE: 'More needed at once than the yard owns',
  GANG_WEIGHT_OVER_CRANE_CAPACITY: 'A gang is heavier than the crane lifts',
  GANG_HEADROOM_OVER_HOOK_HEIGHT: 'A gang’s slings want more height than the hook has',
  PANEL_PRESSURE_OVER_RATING: 'Pour pressure over what the panels are rated for',
  POUR_RATE_OVER_CONCRETE_SUPPLY: 'Stated rate of rise faster than the concrete arrives',
}
