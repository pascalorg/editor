import type { FaceMeasurement } from '../measurement/types'
import type { AnyNodeId } from '../../../schema/types'

/**
 * Coverage vocabulary. A face is never a bare boolean: the reason it is or
 * isn't formed is the product, because it's what an estimator argues with and
 * what the AI needs in order to explain or fix a layout.
 */

export type FaceRole =
  | 'side-a'
  | 'side-b'
  | 'end-start'
  | 'end-end'
  | 'top'
  | 'bottom'
  /** A column's four vertical faces, in plan order from its local −x−z corner. */
  | 'column-face-1'
  | 'column-face-2'
  | 'column-face-3'
  | 'column-face-4'
  /** The single wrapped surface of a circular or many-sided column. */
  | 'shaft'
  /** The underside of a slab, carried on falsework rather than braced. */
  | 'soffit'
  /** The rim of a slab: edge forms or stop-ends around its perimeter. */
  | 'edge'

export type FaceReason =
  // formed
  | 'FORMED_SIDE'
  | 'FREE_END_STOP_END'
  | 'STOP_END_FOR_LATER_ABUTMENT'
  | 'STOP_END_UNSEQUENCED'
  | 'FORMED_SLOPING_TOP'
  /** A bulkhead closing a pour break inside the element, not at an interface. */
  | 'POUR_BREAK_BULKHEAD'
  /** A column face standing clear of any wall — a flat panel of the box form. */
  | 'FORMED_COLUMN_FACE'
  /** A circular or many-sided shaft wrapped by a tube or a bespoke form. */
  | 'FORMED_COLUMN_SHAFT'
  /** A slab soffit, carried on falsework and struck from midspan outwards. */
  | 'FORMED_SOFFIT'
  /** A slab rim standing free — an edge form or a stop-end. */
  | 'FORMED_SLAB_EDGE'
  // not formed
  | 'ABUTS_HARDENED_CONCRETE'
  | 'MONOLITHIC_CONTINUATION'
  | 'AGAINST_EARTH'
  | 'SINGLE_SIDED_BRACED_FACE'
  | 'CAST_AGAINST_SOFFIT_ABOVE'
  | 'SCREEDED_OPEN'
  | 'BEARS_ON_KICKER_OR_SUBSTRATE'
  /** Not the topmost lift: the top is left open for the lift above to continue. */
  | 'LIFT_JOINT_OPEN'
  /** Not the bottom lift: this base is the hardened lift below. */
  | 'BEARS_ON_LIFT_BELOW'
  /** A column face absorbed into the run of a wall — a pilaster or a thickening. */
  | 'EMBEDDED_IN_WALL'
  /** A slab top: trowelled, not formed, whatever the element above bears on it. */
  | 'SLAB_TOP_FINISHED'
  /** A slab cast directly on ground or blinding needs no soffit form. */
  | 'SLAB_ON_GROUND'
  | 'FORMWORK_DISABLED'

/** Reasons that mean "we build formwork here". Everything else is unformed. */
const FORMED_REASONS = new Set<FaceReason>([
  'FORMED_SIDE',
  'FREE_END_STOP_END',
  'STOP_END_FOR_LATER_ABUTMENT',
  'STOP_END_UNSEQUENCED',
  'FORMED_SLOPING_TOP',
  'POUR_BREAK_BULKHEAD',
  'FORMED_COLUMN_FACE',
  'FORMED_COLUMN_SHAFT',
  'FORMED_SOFFIT',
  'FORMED_SLAB_EDGE',
])

export function isFormedReason(reason: FaceReason): boolean {
  return FORMED_REASONS.has(reason)
}

export const FACE_REASON_LABELS: Record<FaceReason, string> = {
  FORMED_SIDE: 'Formed — concrete pushes on this face',
  FREE_END_STOP_END: 'Stop-end — this end terminates free',
  STOP_END_FOR_LATER_ABUTMENT: 'Stop-end — cast before the element that butts here',
  STOP_END_UNSEQUENCED: 'Stop-end — pour order not set, so assumed cast first',
  FORMED_SLOPING_TOP: 'Formed — top slope needs a soffit and hold-down',
  POUR_BREAK_BULKHEAD: 'Bulkhead — closes a pour break inside the element',
  FORMED_COLUMN_FACE: 'Formed — column face, panel of the box form',
  FORMED_COLUMN_SHAFT: 'Formed — wrapped shaft, tube or bespoke form',
  FORMED_SOFFIT: 'Formed — slab soffit carried on falsework',
  FORMED_SLAB_EDGE: 'Formed — slab edge form around the free rim',
  ABUTS_HARDENED_CONCRETE: 'Not formed — butts concrete already cast',
  MONOLITHIC_CONTINUATION: 'Not formed — poured monolithically with its neighbour',
  AGAINST_EARTH: 'Not formed — cast against earth or existing structure',
  SINGLE_SIDED_BRACED_FACE: 'Not formed — single-sided pour, this face is braced',
  CAST_AGAINST_SOFFIT_ABOVE: 'Not formed — cast up against the soffit above',
  SCREEDED_OPEN: 'Not formed — open top, screeded',
  BEARS_ON_KICKER_OR_SUBSTRATE: 'Not formed — bears on kicker or substrate',
  LIFT_JOINT_OPEN: 'Not formed — open lift joint, the lift above continues here',
  BEARS_ON_LIFT_BELOW: 'Not formed — bears on the hardened lift below',
  EMBEDDED_IN_WALL: 'Not formed — this face is absorbed into the wall it sits in',
  SLAB_TOP_FINISHED: 'Not formed — slab top is trowelled, not formed',
  SLAB_ON_GROUND: 'Not formed — cast on ground or blinding, no soffit form',
  FORMWORK_DISABLED: 'Not formed — formwork disabled for this element',
}

/**
 * Why an area was taken off a face. Recorded even when nothing was deducted,
 * so the audit trail shows the rule was considered rather than missed — that
 * distinction is exactly what an estimator queries.
 */
export type DeductionReason =
  | 'OPENING'
  | 'OPENING_BELOW_THRESHOLD'
  | 'OPENING_EXTRA_OVER'
  /**
   * The share of a junction's overlap prism that another element already claims.
   * Physical only: the surface is real and someone forms it, just not us.
   */
  | 'CORNER_OVERLAP_REASSIGNED'
  /**
   * A stretch of face absorbed into an element cast with it. Physical only, and
   * for a different reason: with no joint between them there is no surface here
   * for anyone to form, so nobody bills it either.
   */
  | 'INTERSECTION'

export const DEDUCTION_REASON_LABELS: Record<DeductionReason, string> = {
  OPENING: 'Opening deducted — over the standard’s threshold',
  OPENING_BELOW_THRESHOLD: 'Opening not deducted — under the standard’s threshold',
  OPENING_EXTRA_OVER: 'Opening not deducted — billed as an extra-over item',
  CORNER_OVERLAP_REASSIGNED: 'Corner overlap — formed by the element cast first, not billed twice',
  INTERSECTION: 'Intersection — panel cut around it, but no measure deducted',
}

export interface Deduction {
  reason: DeductionReason
  /** The node responsible — an opening, a neighbour, a junction. */
  sourceId: AnyNodeId
  /** Geometric area considered, m². */
  areaSqM: number
  /** Taken off `physicalArea`. Every void is physically real. */
  physicalSqM: number
  /** Taken off `measuredArea`. 0 when the active standard does not deduct. */
  measuredSqM: number
}

export interface FormworkFace {
  elementId: AnyNodeId
  role: FaceRole
  formed: boolean
  reason: FaceReason
  /**
   * Procurement area in m² — what you buy, cut and crane. Every void is real.
   * 0 for unformed faces.
   */
  physicalArea: number
  /**
   * Contract area in m² for valuation and the BOQ. Intersections are not
   * deducted and openings only below the active standard's threshold, so this
   * diverges from `physicalArea` by several percent on a real building.
   * Conflating the two is the complaint estimators make about existing tools.
   */
  measuredArea: number
  deductions: Deduction[]
  /**
   * How the active standard bills this face — the unit, the quantity in it, and
   * the stages that classify the item. Present on formed faces only: nothing
   * bills a face that was never built.
   */
  measurement?: FaceMeasurement
  /** Set when the reason refers to a neighbouring element. */
  neighbourId?: AnyNodeId
  /** Starter bars pass through a stop-end, so it is never a plain plate. */
  starterPenetrations?: boolean
  /** Sloping formed tops are loaded in uplift — hold-down anchors, not props. */
  upliftLoaded?: boolean
}

/** How the active standard treated one opening, and the reveals it adds. */
export interface OpeningMeasurement {
  openingId: AnyNodeId
  kind: 'door' | 'window' | 'formwork-box-out'
  /** Elevation area of the void within the element's face, m². */
  areaSqM: number
  /** Taken off each formed side face's `measuredArea` — 0 unless deducted. */
  measuredDeductionPerFace: number
  reason: DeductionReason
  /**
   * Reveal faces formed around the void: 4 for a window, 3 for a door sitting
   * on the floor, fewer where the void runs out of the element. Frequently
   * forgotten, and a wall full of small openings gains more reveal area than
   * it loses.
   */
  revealSides: number
  revealAreaSqM: number
  /** False under NRM2, which deems reveals included in the opening item. */
  revealsMeasured: boolean
  /** Set for extra-over standards — the `nr` band this opening is billed in. */
  extraOverBand?: string
}

/**
 * A corner unit as one element sees it: the whole unit, plus which of its two
 * legs lands on this element.
 *
 * `formed` is the rule that decides whether the hardware exists at all, and it
 * is cast order again rather than shape. Walls poured together turn the corner in
 * one continuous shutter, so the re-entrant needs an inside unit and the external
 * angle an outside one. Walls cast in sequence do not: the later one butts
 * hardened concrete and its panels run up to that face.
 *
 * A corner is therefore formed exactly where the legs share a pour — which is
 * also where `classifyEnd` reports `MONOLITHIC_CONTINUATION` and builds no
 * stop-end. The two are deliberately exclusive: an end gets a corner unit or a
 * bulkhead, never both. An unsequenced pair keeps the bulkhead, the same
 * conservative call `STOP_END_UNSEQUENCED` makes, and the fix is to say which
 * pour each wall is in.
 *
 * `owns` then keeps the BOM honest among the ones that are formed. Both walls
 * see the unit — each has to start its panel layout clear of the leg on its own
 * face — but exactly one bills it, decided by the same tie-break the overlap
 * areas use. Ignoring that is how tools end up with two inside corners per L.
 */
export interface ElementCorner {
  junctionKind: JunctionKind
  point: { x: number; y: number }
  corner: JunctionCorner
  /** The leg of `corner` on this element. */
  leg: CornerLeg
  formed: boolean
  owns: boolean
}

export interface ElementCoverage {
  elementId: AnyNodeId
  faces: FormworkFace[]
  openings: OpeningMeasurement[]
  /**
   * Corner units this element's faces turn onto. Every leg is here, owned or
   * not, because the panel layout on a face has to start clear of the corner
   * whether or not this element pays for it.
   */
  corners: ElementCorner[]
  /** Sum of face `physicalArea` plus reveal area. */
  physicalArea: number
  /** Sum of face `measuredArea` plus reveal area the standard measures. */
  measuredArea: number
}

export type JunctionKind = 'corner-l' | 't-junction' | 'cross' | 'collinear-butt'

/** Which end of an element a junction lands on. */
export type EndKey = 'start' | 'end'

/**
 * One wall leaving a junction. A wall that ends there radiates one ray; one the
 * junction lands mid-run on radiates two, in both directions — which is what
 * makes a stem meeting a wall's face read as three rays and two inside corners
 * rather than as a corner between two walls.
 */
export interface JunctionRay {
  elementId: AnyNodeId
  /** The end the ray leaves from. Absent when the junction is mid-run. */
  end?: EndKey
  /** Distance from the wall's start to the junction, m. */
  alongM: number
  /** Bearing of the ray away from the junction point, degrees. */
  bearingDeg: number
  /**
   * Whether the ray runs toward the wall's end or back toward its start. Sides
   * are named from the wall's own heading, so this also fixes which face bounds
   * which side of the ray: side `a` is the left-hand offset, hence the face
   * counter-clockwise of a forward ray and clockwise of a backward one.
   */
  towardEnd: boolean
  coreThickness: number
}

/**
 * One leg of a corner unit: where it lands, and the core it turns onto. An
 * outside leg wraps that core, so `outsideCornerLeg` needs it — and it is the
 * *other* wall's thickness, which is why the two legs of an outside corner are
 * different lengths unless the walls are the same thickness.
 */
export interface CornerLeg {
  elementId: AnyNodeId
  end?: EndKey
  alongM: number
  face: 'a' | 'b'
  /**
   * Which way the leg runs from `alongM` — toward the element's end, or back
   * toward its start. Not derivable from `face`: a T's two inside units both land
   * on the spine's same face and run opposite ways out of the one point.
   */
  towardEnd: boolean
  turnsOntoThicknessM: number
}

/**
 * One corner unit and the faces it lands on: `inside` fills a re-entrant angle
 * between two rays, `outside` wraps the reflex one. Owned by the junction, never
 * by either wall — attributing it to a wall makes both walls at a corner claim
 * the same unit and the BOM double-counts every junction in the building.
 */
export interface JunctionCorner {
  side: 'inside' | 'outside'
  /** The angle the unit turns through, degrees — 90 for a square corner. */
  angleDeg: number
  legs: [CornerLeg, CornerLeg]
}

export interface FormworkJunction {
  kind: JunctionKind
  /** Element ids meeting here, sorted for determinism. */
  elementIds: AnyNodeId[]
  point: { x: number; y: number }
  /** Sorted by bearing, so the corners between them run counter-clockwise. */
  rays: JunctionRay[]
  corners: JunctionCorner[]
  /** `corners` counted by side — the two numbers a BOM asks for. */
  insideCornerCount: number
  outsideCornerCount: number
}
