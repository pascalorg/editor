/**
 * Measurement rules are a strategy, not a constant. The same wall yields
 * materially different quantities under each standard: IS 1200 ignores any
 * opening up to 0.4 m², HKSMM4 up to 1.00 m², and NRM2 never deducts an
 * opening at all — it bills it as an enumerated extra-over item. Hard-coding
 * one threshold silently commits every project to one country's contract.
 *
 * See `wiki/formwork/reference/products.md` §4.3 for the clause text.
 */

export type MeasurementStandardId = 'IS_1200_5' | 'NRM2' | 'HKSMM4' | 'CESMM4' | 'POMI'

/**
 * `deduct-above-area` removes the opening from the measured face once it
 * exceeds the threshold. `extra-over-count` never deducts: the opening is
 * counted in `nr` by area band and all labour and material to form it is
 * deemed included in that item.
 */
export type OpeningRule =
  | { kind: 'deduct-above-area'; thresholdSqM: number }
  | { kind: 'extra-over-count'; bandsSqM: readonly number[] }

/**
 * Below a width threshold a face stops being an area and becomes a run: a
 * 150 mm nib costs per metre of length, not per square metre, because the labour
 * is in the two edges rather than in the sheet. Which faces the switch reaches
 * is part of the clause and therefore data — HKSMM4 names wall sides, NRM2
 * item 24 names wall ends — so the roles are listed rather than guessed.
 *
 * Roles are `string` because `FaceRole` belongs to the coverage layer above
 * this one. `standards.test.ts` checks every listed role is a real one.
 */
export interface WidthBandRule {
  /** Face roles the clause reaches. Anything else stays in m² at any width. */
  roles: readonly string[]
  /** At or below this measured width the face is billed by the metre. */
  thresholdM: number
  /**
   * The stated width is rounded up to a multiple of this. Absent where the
   * clause says "width stated" without stages, as NRM2 item 24 does.
   */
  stageM?: number
  sourceRef: string
}

/**
 * A soffit is not one item. A deeper slab needs heavier falsework and a higher
 * one needs longer props, so HKSMM4 bills it in thickness and height stages —
 * two slabs of equal area can sit in different stages and price differently.
 */
export interface SoffitStageRule {
  /** First thickness band, m. Everything up to here is one stage. */
  thicknessBaseM: number
  thicknessStepM: number
  /** First height-above-support band, m. */
  heightBaseM: number
  heightStepM: number
  sourceRef: string
}

export interface MeasurementStandard {
  id: MeasurementStandardId
  label: string
  /** Clause reference, carried onto the BOQ line so a QS can check it. */
  sourceRef: string
  /**
   * Standards whose clause text we could not obtain ship anyway — a project in
   * that jurisdiction still needs a number — but every output must say so.
   */
  verification: 'verified' | 'unverified'
  openings: OpeningRule
  /**
   * Whether the reveal faces of an opening count as measured contact area.
   * NRM2 deems them included in the extra-over opening item, so measuring them
   * again would bill the same plywood twice.
   */
  revealsMeasured: boolean
  /** Absent where the standard bills every face by area whatever its width. */
  narrowWidth?: WidthBandRule
  /** Absent where the standard does not stage soffits. */
  soffitStages?: SoffitStageRule
  /**
   * Boundary of the sloping-top band in degrees — NRM2 item 28 splits at 15°.
   * Absent where the standard does not band a formed top by slope.
   *
   * Not to be confused with `DEFAULT_TOP_FORM_ANGLE_THRESHOLD_DEG`, which
   * answers a different question: that one is "steep enough that the concrete
   * would run, so form it", this one is "which band to bill it in".
   */
  slopingTopBandDeg?: number
}

/**
 * Orientation class of a formed surface. Every standard prices these
 * differently — a soffit carries its own weight on falsework while a vertical
 * face only resists pressure — and CESMM4 Class G bands on it explicitly.
 */
export type SurfaceClass = 'vertical' | 'horizontal' | 'sloping' | 'curved'

/** One band of a staged dimension, as it reads on the BOQ item. */
export interface MeasurementStage {
  /** 0 is the base band; each step above it increments by one. */
  index: number
  lowerM: number
  upperM: number
  label: string
}

/**
 * How one formed face is billed. Separate from the face's areas: the areas are
 * geometry the engine derives, this is the contract's reading of them, and a
 * narrow face is not billed in the unit its area is measured in at all.
 */
export interface FaceMeasurement {
  /** `m` where a narrow-width rule applies, otherwise `m2`. */
  unit: 'm' | 'm2'
  /** In `unit` — the run in metres, or the measured area in m². */
  quantity: number
  surfaceClass: SurfaceClass
  /** The measured width that triggered the switch to `m`, in m. */
  widthM?: number
  /** `widthM` rounded up to the clause's stage — the width to state on the item. */
  statedWidthM?: number
  /** Soffit thickness stage. */
  thicknessStage?: MeasurementStage
  /** Soffit height-above-support stage. */
  heightStage?: MeasurementStage
  /** Which side of the standard's sloping-top boundary a formed top falls. */
  slopeBand?: { boundaryDeg: number; over: boolean }
  /**
   * Every clause that shaped this line, so a QS can check each one. A list
   * rather than a joined string because the clause text itself contains
   * punctuation, and one of them reads "1 ≤ 500 wide, width stated; 2 > 500".
   */
  sourceRefs: string[]
}
