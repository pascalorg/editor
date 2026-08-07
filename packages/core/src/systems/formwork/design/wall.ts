import {
  DEFAULT_FALSEWORK_BEAM_ID,
  DEFAULT_SHEATHING_ID,
  type FalseworkBeamType,
  type FormworkSystem,
  falseworkBeam,
  governingCapacity,
  type SheathingType,
  sheathingType,
  type TieType,
  tieForThickness,
} from '../catalog'
import { type PressureEnvelope, pressureAtDepth } from '../pressure'
import {
  type AllowableSpan,
  adoptSpan,
  DEFLECTION_ARCHITECTURAL,
  DEFLECTION_LUMBER,
  DEFLECTION_STRUCTURAL,
  type DeflectionLimit,
  type MemberDesign,
  memberDesign,
  solveSpan,
  utilisation,
} from './beam'

/**
 * The wall chain under lateral pressure: pressure → sheathing → studs → walers →
 * ties, plus the bracing that holds the form on line.
 *
 * The order is the one thing that cannot be rearranged. The stud spacing *is* the
 * sheathing's allowable span, the waler spacing *is* the stud's, and the tie spacing
 * *is* the waler's — so a builder that picks its own spacings draws members each
 * checked against a load none of them carries. design.md §2.1 sets it out as a
 * numbered loop for exactly that reason.
 *
 * Two things make this different from the falsework chain. The load is an envelope
 * rather than a single pressure: it rises with depth to the hydrostatic head and is
 * constant below, so the tie columns can be graded — close near the base, opening
 * out going up — the way a column's clamps are. And it terminates in a *spacing*
 * rather than a point load: `F_tie = p × s_v × s_h` inverts to `s_h ≤ SWL/(p × s_v)`,
 * and where the result is not buildable the fix is to close the walers and solve
 * again, not to add ties. §2.1 step 10 says so in as many words, and the loop below
 * is that iteration.
 *
 * A conventional carpenter's shutter is what this designs. On a panel system the
 * frames leave the factory drilled and a rod passes only where two holes meet, so
 * `layout/tie-grid.ts` — not this — is the authority on where ties go there; this
 * chain's tie spacing is the figure that grid is checked against.
 *
 * See `wiki/formwork/reference/design.md` §2.1–2.5, §1.8.
 */

/** Setting-out module for a wall shutter, m. Stud, waler and tie centres are marked to 50 mm. */
export const WALL_MODULE_M = 0.05

/**
 * Widest stud spacing worth emitting whatever the arithmetic allows, m. Past this
 * the ply is unsupported rather than lightly loaded, and no carpenter frames a
 * shutter at wider centres than a stud wall.
 */
export const MAX_STUD_SPACING_M = 0.6

/** Widest waler spacing on a wall, m — one waler per metre of height is the loose end of practice. */
export const MAX_WALER_SPACING_M = 1.0

/**
 * Practical cap on tie spacing whatever the calculation allows, m. Around 0.9 m is
 * the common site limit and one commercial tool hard-codes it. A panel system may
 * publish wider — Framax is drilled at 1.35 m — and where a system is named its own
 * figure governs, because that spacing comes with a stiffer panel behind it.
 */
export const MAX_TIE_SPACING_M = 0.9

/**
 * Tie spacing below which the walers are simply too far apart, m. A shutter tied
 * every 150 mm is not a shutter; it is a waling problem showing up at the ties.
 */
export const MIN_TIE_SPACING_M = 0.15

/** Where the lowest waler sits above the pour base, mm — clear of the kicker, which holds the foot. */
export const FIRST_WALER_ABOVE_BASE_MM = 100

/**
 * ACI §2.2.3.2: bracing carries at least this, applied at the top of the form, per
 * metre of wall length.
 */
export const MIN_BRACE_LINE_LOAD_KN_M = 1.5

/** And at least this wind pressure where the form is exposed, kN/m² (15 lb/ft²). */
export const MIN_WIND_PRESSURE_KPA = 0.72

/** ACI §2.2.3.1's other half: 2 % of the dead load the bracing holds. */
export const BRACE_DEAD_LOAD_FRACTION = 0.02

/** Below this many studs between ties the uniform-load method is void — APA, §2.4. */
export const MIN_STUDS_BETWEEN_TIES_FOR_UNIFORM_LOAD = 3

/**
 * How much worse the waler moment is when the studs deliver discrete loads instead
 * of a uniform one, keyed by how many land in the worst tie bay. Same total load
 * either way.
 *
 * One load at midspan gives `WL/4` against `WL/8` — twice. Two at the third points
 * give `WL/6` — a third more. From three up the difference has closed enough that
 * APA's tables treat the load as uniform, which is where this stops.
 */
const POINT_LOAD_MOMENT_FACTOR: Record<number, number> = { 1: 2, 2: 4 / 3 }

/** 100 mm rows over 20 m of lift, which no pour approaches. */
const MAX_TIE_ROWS = 200

export type WallWarningKind =
  /** The load needs the members closer than a crew can practically set them. */
  | 'spacing-below-practical-minimum'
  /** The tie is overloaded even with the walers as close as they will go. */
  | 'tie-over-capacity'
  /** No tie in the system reaches this wall thickness. */
  | 'no-tie-for-thickness'
  /** The design values used are not a published product declaration. */
  | 'unverified-sheathing'
  /** A member's published capacity is not a permissible value and was not derated. */
  | 'capacity-basis-mismatch'
  /** A spacing the project stated is wider than the check allows. */
  | 'stated-spacing-over-capacity'
  /**
   * Fewer than three studs land between ties, so the walers take point loads rather
   * than a uniform one and the tie spacing was cut to suit.
   */
  | 'point-load-analysis-required'
  /** The walers had to be closed to bring the tie force inside the hardware. */
  | 'walers-closed-for-tie-capacity'

export interface WallWarning {
  kind: WallWarningKind
  message: string
  demandKn?: number
  capacityKn?: number
  elevationMm?: number
}

/** One row of ties up the wall, with what it carries. */
export interface TieRow {
  /** Elevation above the pour base, mm — a waler line. */
  elevationMm: number
  /** Gap to the row below, mm, or to the base for the lowest row. */
  spacingBelowMm: number
  /** Tie centres along this row, mm. Graded: wider where there is less pressure. */
  horizontalSpacingMm: number
  pressureKnM2: number
  /** Load on one tie in this row, kN — the pressure over its tributary panel. */
  forceKn: number
  /** Set where the spacing was widened to match the row below rather than calculated. */
  monotonicallyWidened?: true
}

export interface WallDesign {
  envelope: PressureEnvelope
  /** The pressure the members were sized on, kN/m² — at the base of the pour. */
  designPressureKnM2: number
  sheathing: SheathingType | undefined
  beam: FalseworkBeamType | undefined
  tie: TieType | undefined
  /** What actually limits the tie — the rod, or the bracket it bears on. */
  tieCapacityKn: number
  tieCapacityComponent: string
  /** Vertical members behind the sheathing. Their centres are its allowable span. */
  stud: MemberDesign
  /** Horizontal members behind the studs. Their centres are the studs' allowable span. */
  waler: MemberDesign
  /** Tie centres along a waler, m — the waler's own span, cut by the tie's capacity. */
  tieSpacing: MemberDesign
  /** Tie rows up the wall, graded off the envelope, from the base up. */
  rows: TieRow[]
  /** Studs landing between two ties at the adopted spacings. Under three the walers take point loads. */
  studsBetweenTies: number
  bracing: BraceDesign
  /** Ties per m² of one face over the graded rows — the wall's tie density. */
  tiesPerM2: number
  warnings: WallWarning[]
}

/**
 * What holds the form on line, from §1.8. A wall form is not braced against the
 * concrete — the ties do that — it is braced against wind, against the impact of
 * dumping, and against the code's own minimum, whichever is largest.
 */
export interface BraceDesign {
  /** The governing horizontal line load at the top of the form, kN/m of wall. */
  lineLoadKnM: number
  governedBy: 'code-minimum' | 'wind' | 'dead-load-fraction'
  /** Horizontal reaction the raker must deliver per m of wall, kN/m — `R = H·h/a`. */
  reactionKnM: number
  /** Axial force in one raker at `rakerSpacingM` centres, kN — `P = R·s/cos θ`. */
  rakerForceKn: number
  /** Vertical component into the kicker or anchor, kN — `V = P·sin θ`. */
  anchorUpliftKn: number
  rakerSpacingM: number
  rakerAngleDeg: number
  /** Where the raker meets the form, m above the base. Rakers do not connect at the top. */
  connectionHeightM: number
  /**
   * Whether both sides need bracing. A wall form has to resist wind from either
   * side; an inclined raker takes tension as well as compression so one line will
   * do, but a guy wire takes tension only and needs a partner opposite.
   */
  bothSidesRequired: boolean
}

export interface WallDesignOptions {
  envelope: PressureEnvelope
  /** The pour's own height above its base, m. */
  liftHeightM: number
  /** Length of wall this shutter forms, m — the run the walers are continuous over. */
  runM: number
  wallThicknessMm: number
  sheathingId?: string
  /** The section used for studs and walers alike; `doubledWalers` covers paired waling. */
  beamId?: string
  /** Named where a project has chosen a system, so its tie range and cap are used. */
  system?: FormworkSystem
  /** Governs the deflection limit: architectural work takes `l/360` and a 1.6 mm cap. */
  architectural?: boolean
  /** Walers paired either side of the tie, which halves the load in each member. */
  doubledWalers?: boolean
  /** Stud centres the project has fixed, m. Reported against, not used to choose. */
  statedStudSpacingM?: number
  /** Waler centres the project has fixed, m. */
  statedWalerSpacingM?: number
  /** Tie centres the project has fixed, m. */
  statedTieSpacingM?: number
  /** Wind pressure on the form, kN/m². Defaults to the code minimum for an exposed wall. */
  windPressureKpa?: number
  /** Weight of the form the bracing holds, kN/m of wall — the 2 % term. */
  formDeadLoadKnM?: number
  /** Raker centres along the wall, m. */
  rakerSpacingM?: number
  /** Raker inclination from the horizontal, degrees. */
  rakerAngleDeg?: number
  /** Where the raker meets the form, m above the base. Defaults to two-thirds height. */
  braceConnectionHeightM?: number
  /** Braced by guy wires rather than by inclined rakers. */
  guyWires?: boolean
}

function design(
  solved: AllowableSpan,
  loadKnM: number,
  maxM: number,
  statedM?: number,
): MemberDesign {
  return memberDesign(solved, loadKnM, { moduleM: WALL_MODULE_M, maxM, statedM })
}

/**
 * The bracing line load and what it resolves into.
 *
 * The line load is the largest of three: the code's flat 1.5 kN/m at the top, the
 * wind over the form's height, and 2 % of what the form weighs. The first governs a
 * short wall and the second a tall one, which is why both are checked rather than
 * one assumed.
 *
 * `R = H·h/a` is the lever, and it is the step people leave out. A raker connecting
 * at two-thirds height has to deliver half again the applied load; one connecting
 * low delivers a multiple of it. That is why the anchor is the part that fails.
 */
export function braceDesign(opts: {
  liftHeightM: number
  windPressureKpa?: number
  formDeadLoadKnM?: number
  rakerSpacingM?: number
  rakerAngleDeg?: number
  connectionHeightM?: number
  guyWires?: boolean
}): BraceDesign {
  const heightM = Math.max(0, opts.liftHeightM)
  const windKnM = (opts.windPressureKpa ?? MIN_WIND_PRESSURE_KPA) * heightM
  const deadKnM = BRACE_DEAD_LOAD_FRACTION * (opts.formDeadLoadKnM ?? 0)
  const lineLoadKnM = Math.max(MIN_BRACE_LINE_LOAD_KN_M, windKnM, deadKnM)
  const governedBy =
    windKnM >= lineLoadKnM ? 'wind' : deadKnM >= lineLoadKnM ? 'dead-load-fraction' : 'code-minimum'

  // Two-thirds height is where a raker of workable length lands on an ordinary
  // storey-height form. Taking the connection at the top instead would understate
  // the reaction by a third, which is the wrong direction.
  const connectionHeightM = opts.connectionHeightM ?? (heightM * 2) / 3
  const rakerSpacingM = opts.rakerSpacingM ?? 2
  const rakerAngleDeg = opts.rakerAngleDeg ?? 45
  const theta = (rakerAngleDeg * Math.PI) / 180
  const reactionKnM = connectionHeightM > 0 ? (lineLoadKnM * heightM) / connectionHeightM : 0
  const rakerForceKn = (reactionKnM * rakerSpacingM) / Math.cos(theta)

  return {
    lineLoadKnM,
    governedBy,
    reactionKnM,
    rakerForceKn,
    anchorUpliftKn: rakerForceKn * Math.sin(theta),
    rakerSpacingM,
    rakerAngleDeg,
    connectionHeightM,
    bothSidesRequired: opts.guyWires === true,
  }
}

/**
 * The tie spacing a given pressure allows on a waler at `walerSpacingM` centres, m
 * — §2.5's `s_h ≤ SWL / (p × s_v)`, taken with the waler's own bending.
 *
 * Whichever runs out first is the answer: a tie the waler cannot reach is as
 * unavailable as a tie that cannot carry the load. The capacity term uses the full
 * pressure whether the waling is single or doubled — pairing the waler halves what
 * each *member* bends under, but the tie still takes the whole tributary panel.
 */
function tieSpacingAt(
  pressureKnM2: number,
  walerSpacingM: number,
  walerBendingSpanM: number,
  tieCapacityKn: number,
  maxM: number,
): number {
  if (pressureKnM2 <= 0 || walerSpacingM <= 0) return maxM
  return Math.min(maxM, tieCapacityKn / (pressureKnM2 * walerSpacingM), walerBendingSpanM)
}

/**
 * A tie spacing rounded down onto a whole number of stud bays, m.
 *
 * A tie passes *between* two studs, so the spacing is a multiple of the stud pitch
 * whether or not the arithmetic lands there — set a tie every 0.28 m on 0.30 m studs
 * and half of them have a stud where the rod goes. Rounding onto the bay also makes
 * the studs-between-ties count meaningful, which is what APA's point-load caveat
 * turns on.
 *
 * Never returns less than one bay: a tie in every bay is the tightest a shutter can
 * be tied, and if that is not enough the walers have to close instead.
 */
function adoptTieSpan(spanM: number, studSpacingM: number): number {
  if (!(studSpacingM > 0) || !Number.isFinite(spanM)) return spanM
  const bays = Math.max(1, Math.floor(spanM / studSpacingM + 1e-9))
  return Math.round(bays * studSpacingM * 1e6) / 1e6
}

/**
 * Tie rows from the base up, graded off the envelope.
 *
 * Vertically the rows sit on the waler spacing, which is a single figure: the walers
 * are one continuous set of members, and stepping their spacing to follow the
 * pressure would want a different stud pattern in every band. Horizontally the
 * spacing *is* graded, because a tie is a discrete piece of hardware and leaving
 * some out where there is less pressure costs nothing to set out.
 *
 * The monotonic guard is the one the clamp schedule carries: a grid that closes as
 * it rises is set out wrong more often than it is set out right, whatever the
 * arithmetic says.
 */
function tieRows(opts: {
  envelope: PressureEnvelope
  liftHeightM: number
  walerSpacingM: number
  studSpacingM: number
  /** The waler's own allowable span at a given pressure, m — graded like everything else. */
  walerSpanAt: (pressureKnM2: number) => number
  tieCapacityKn: number
  maxTieSpacingM: number
  statedTieSpacingM?: number
}): TieRow[] {
  const heightMm = opts.liftHeightM * 1000
  const spacingMm = opts.walerSpacingM * 1000
  if (!(spacingMm > 0) || !(heightMm > 0)) return []
  // The waler carries the pressure at the row it sits on, not the base pressure. A
  // row in the constant-pressure zone and a row above the break carry the same
  // members and different loads, and that difference is the whole point of grading.

  const elevationsMm: number[] = []
  for (
    let y = Math.min(FIRST_WALER_ABOVE_BASE_MM, heightMm / 2);
    y < heightMm - 1e-6 && elevationsMm.length < MAX_TIE_ROWS;
    y += spacingMm
  ) {
    elevationsMm.push(y)
  }
  if (elevationsMm.length === 0) elevationsMm.push(heightMm / 2)

  const rows: TieRow[] = []
  let previousHorizontalMm = 0
  for (const [i, elevationMm] of elevationsMm.entries()) {
    const pressureKnM2 = pressureAtDepth(opts.envelope, (heightMm - elevationMm) / 1000)
    const calculatedM =
      opts.statedTieSpacingM ??
      tieSpacingAt(
        pressureKnM2,
        opts.walerSpacingM,
        opts.walerSpanAt(pressureKnM2),
        opts.tieCapacityKn,
        opts.maxTieSpacingM,
      )
    const roundedMm =
      (opts.statedTieSpacingM ??
        adoptTieSpan(Math.min(calculatedM, opts.maxTieSpacingM), opts.studSpacingM)) * 1000
    const horizontalSpacingMm = Math.max(roundedMm, previousHorizontalMm)

    // The band a row carries is half the gap either side. The lowest row's lower band
    // runs to the base, which it shares with the kicker; the top row's upper band
    // runs out to the pour top.
    const below = elevationsMm[i - 1]
    const above = elevationsMm[i + 1]
    const bandBelowMm = below === undefined ? elevationMm : (elevationMm - below) / 2
    const bandAboveMm = above === undefined ? heightMm - elevationMm : (above - elevationMm) / 2

    rows.push({
      elevationMm,
      spacingBelowMm: below === undefined ? elevationMm : elevationMm - below,
      horizontalSpacingMm,
      pressureKnM2,
      forceKn: pressureKnM2 * ((bandBelowMm + bandAboveMm) / 1000) * (horizontalSpacingMm / 1000),
      ...(horizontalSpacingMm > roundedMm + 1e-6 ? { monotonicallyWidened: true as const } : {}),
    })
    previousHorizontalMm = horizontalSpacingMm
  }
  return rows
}

/**
 * The shutter for one wall pour.
 *
 * Members are sized on the pressure at the *base* of the pour — the worst band —
 * because a stud or a waler is one piece running past every band and is only as good
 * as its worst point. Only the ties are graded, and only along the wall: see
 * `tieRows`.
 */
export function wallDesign(opts: WallDesignOptions): WallDesign {
  const sheathing = sheathingType(opts.sheathingId ?? DEFAULT_SHEATHING_ID)
  const beam = falseworkBeam(opts.beamId ?? DEFAULT_FALSEWORK_BEAM_ID)
  const tie = opts.system ? tieForThickness(opts.system, opts.wallThicknessMm) : undefined
  const warnings: WallWarning[] = []

  const governing = tie
    ? governingCapacity(tie)
    : { capacityKn: Number.POSITIVE_INFINITY, component: 'unspecified' }
  if (opts.system && !tie) {
    warnings.push({
      kind: 'no-tie-for-thickness',
      message: `No ${opts.system.label} tie reaches a ${opts.wallThicknessMm} mm wall, so the tie spacing below is a waler span check with no hardware behind it. Specify a through-rod outside the system.`,
    })
  }

  // The base of the pour, where the envelope has run out its full head. Sizing on the
  // mean or on the top would leave every member under-designed at its worst point.
  const designPressureKnM2 = pressureAtDepth(opts.envelope, opts.liftHeightM)
  const maxTieSpacingM = opts.system
    ? opts.system.maxPracticalTieSpacingMm / 1000
    : MAX_TIE_SPACING_M

  if (sheathing && sheathing.verification === 'unverified') {
    warnings.push({
      kind: 'unverified-sheathing',
      message: `${sheathing.label} carries derived design values rather than a manufacturer's declaration, so the stud spacing below is indicative. Enter a Metsä WISA-Form, UPM or Doka datasheet before building to it.`,
    })
  }
  for (const member of [sheathing, beam]) {
    if (member && member.capacityBasis !== 'permissible') {
      warnings.push({
        kind: 'capacity-basis-mismatch',
        message: `${member.label} publishes ${member.capacityBasis} capacities, which are not comparable with the working pressure used here. Derate them or supply permissible values.`,
      })
    }
  }

  // Step 3–4: the sheathing spans between studs, so its allowable span *is* the stud
  // spacing. Face grain across the supports — the strong direction, and the one a
  // shutter is sheeted in. The limit follows the finish, as on a deck: `l/360` with a
  // 1.6 mm cap for architectural work, `l/270` otherwise.
  const plyLimit: DeflectionLimit = opts.architectural
    ? DEFLECTION_ARCHITECTURAL
    : DEFLECTION_STRUCTURAL
  const studSolved = sheathing
    ? solveSpan(
        designPressureKnM2,
        {
          momentKnM: sheathing.acrossSupports.momentKnMPerM,
          shearKn: sheathing.acrossSupports.shearKnPerM,
          eiKnM2: sheathing.acrossSupports.eiKnM2PerM,
        },
        plyLimit,
        opts.liftHeightM,
      )
    : undefined
  const stud = studSolved
    ? design(studSolved, designPressureKnM2, MAX_STUD_SPACING_M, opts.statedStudSpacingM)
    : {
        calculatedM: MAX_STUD_SPACING_M,
        adoptedM: opts.statedStudSpacingM ?? MAX_STUD_SPACING_M,
        governedBy: 'bending' as const,
        spans: 3,
        loadKnM: designPressureKnM2,
        utilisation: 0,
        cappedBy: 'practical-maximum' as const,
      }

  // Step 5–6: each stud carries the pressure over its own spacing, and how far it
  // spans between supports is the waler spacing. A stud runs vertically, so the run
  // it is continuous over is the height of the pour and not its length.
  const studLineKnM = designPressureKnM2 * stud.adoptedM
  const walerSolved = beam
    ? solveSpan(studLineKnM, beam, DEFLECTION_LUMBER, opts.liftHeightM)
    : undefined

  // Step 7–8, and step 10 with them. The waler carries the pressure over its own
  // spacing, halved where it is a paired member — APA: "since the wales are doubled,
  // each 2×4 wale carries 600 lbf (1200 ÷ 2 = 600)". Its allowable span is the tie
  // spacing, and the tie's own capacity may cut that further.
  //
  // The point-load correction (§2.4) lives inside this check rather than after it,
  // because it changes the span it is derived from. The walers take discrete loads
  // from the studs, and treating them as uniform is only adequate from three studs
  // up: below that the moment is up to twice what the uniform check found. `M ∝
  // f·wL²/8` inverts to `L ∝ 1/√f`, so the factor lands on the span directly, on top
  // of whatever continuity the uniform solve claimed. One pass settles it — the
  // factor only worsens, so the reduced span can only fall into the same or a
  // smaller bay count, and the smallest bay count carries the largest factor.
  const tieCheck = (walerSpacingM: number) => {
    const perMemberKnM = (designPressureKnM2 * walerSpacingM) / (opts.doubledWalers ? 2 : 1)
    const solved = beam ? solveSpan(perMemberKnM, beam, DEFLECTION_LUMBER, opts.runM) : undefined
    const walerSpanAt = (pressureKnM2: number) => {
      if (!beam) return Number.POSITIVE_INFINITY
      const lineKnM = (pressureKnM2 * walerSpacingM) / (opts.doubledWalers ? 2 : 1)
      const uniform = solveSpan(lineKnM, beam, DEFLECTION_LUMBER, opts.runM)
      const bays = Math.floor(uniform.spanM / stud.adoptedM + 1e-9)
      const factor = POINT_LOAD_MOMENT_FACTOR[bays] ?? 1
      // Only bending: the pattern concentrates moment, while the shear at the support
      // and the deflection at midspan are barely changed by it. Scaling the governing
      // span instead would cut a shear-governed waler for a bending effect it does not
      // have — and at the line loads a wall waler sees, shear usually is what governs,
      // so the correction most often changes nothing. That is the right answer, not a
      // missing check: it is reported as a check made, not as a reduction applied.
      return Math.min(uniform.bendingM / Math.sqrt(factor), uniform.shearM, uniform.deflectionM)
    }
    const bendingSpanM = walerSpanAt(designPressureKnM2)
    return {
      perMemberKnM,
      solved,
      walerSpanAt,
      bendingSpanM,
      spanM: tieSpacingAt(
        designPressureKnM2,
        walerSpacingM,
        bendingSpanM,
        governing.capacityKn,
        maxTieSpacingM,
      ),
    }
  }

  const studsBetween = (tieSpacingM: number) =>
    stud.adoptedM > 0 ? Math.floor(tieSpacingM / stud.adoptedM + 1e-9) : 0
  let walerAdoptedM =
    opts.statedWalerSpacingM ??
    (walerSolved
      ? adoptSpan(Math.min(walerSolved.spanM, MAX_WALER_SPACING_M), WALL_MODULE_M)
      : MAX_WALER_SPACING_M)
  let attempt = tieCheck(walerAdoptedM)
  let closedForTie = false
  // Where the ties come out closer than one stud bay, there is nowhere left to put
  // them: a rod passes between studs, so a bay is the tightest a shutter ties. Close
  // the walers and solve again — `F = p·s_v·s_h` is linear in `s_v`, so halving the
  // waler spacing halves the tie force and doubles the spacing it allows. That is the
  // fix §2.1 step 10 names, and adding ties is not. Bounded because each pass halves:
  // four take a metre below the setting-out module.
  if (opts.statedWalerSpacingM === undefined) {
    for (
      let pass = 0;
      pass < 4 && (attempt.spanM < stud.adoptedM || attempt.spanM < MIN_TIE_SPACING_M);
      pass++
    ) {
      const closerM = adoptSpan(walerAdoptedM / 2, WALL_MODULE_M)
      if (!(closerM > 0) || closerM >= walerAdoptedM) break
      walerAdoptedM = closerM
      attempt = tieCheck(closerM)
      closedForTie = true
    }
  }
  if (closedForTie) {
    warnings.push({
      kind: 'walers-closed-for-tie-capacity',
      message: `The walers were closed to ${walerAdoptedM.toFixed(2)} m to bring the tie spacing back to a whole stud bay within the ${governing.capacityKn.toFixed(0)} kN available at the ${governing.component}. Adding ties would not have helped: a rod passes between studs, so one bay is as close as a shutter ties.`,
      capacityKn: governing.capacityKn,
    })
  }

  const walerCalculatedM = walerSolved?.spanM ?? MAX_WALER_SPACING_M
  const waler: MemberDesign = {
    calculatedM: walerCalculatedM,
    adoptedM: walerAdoptedM,
    governedBy: walerSolved?.governedBy ?? 'bending',
    spans: walerSolved?.spans ?? 3,
    loadKnM: studLineKnM,
    utilisation: utilisation(walerAdoptedM, walerCalculatedM),
    ...(opts.statedWalerSpacingM === undefined && walerCalculatedM > MAX_WALER_SPACING_M
      ? { cappedBy: 'practical-maximum' as const }
      : {}),
    ...(opts.statedWalerSpacingM !== undefined ? { stated: true as const } : {}),
  }

  const tieCalculatedM = attempt.spanM
  const tieAdoptedM =
    opts.statedTieSpacingM ?? adoptTieSpan(Math.min(tieCalculatedM, maxTieSpacingM), stud.adoptedM)
  const tieSpacing: MemberDesign = {
    calculatedM: tieCalculatedM,
    adoptedM: tieAdoptedM,
    // The waler's own governing check. Where the tie's capacity rather than the waler
    // produced the spacing, that shows in the warnings and in each row's force — a
    // tie is not a span check and has no bending to report.
    governedBy: attempt.solved?.governedBy ?? 'bending',
    spans: attempt.solved?.spans ?? 3,
    loadKnM: attempt.perMemberKnM,
    utilisation: utilisation(tieAdoptedM, tieCalculatedM),
    ...(opts.statedTieSpacingM === undefined && tieCalculatedM >= maxTieSpacingM - 1e-9
      ? { cappedBy: 'practical-maximum' as const }
      : {}),
    ...(opts.statedTieSpacingM !== undefined ? { stated: true as const } : {}),
  }

  const rows = tieRows({
    envelope: opts.envelope,
    liftHeightM: opts.liftHeightM,
    walerSpacingM: walerAdoptedM,
    studSpacingM: stud.adoptedM,
    walerSpanAt: attempt.walerSpanAt,
    tieCapacityKn: governing.capacityKn,
    maxTieSpacingM,
    statedTieSpacingM: opts.statedTieSpacingM,
  })

  // Over every row rather than the lowest: the lowest shares its band with the
  // kicker and so is not the hardest worked. The row a waler spacing above it
  // usually is.
  const worst = rows.reduce(
    (max, row) => (row.forceKn > max.forceKn ? row : max),
    rows[0] ?? { forceKn: 0, elevationMm: 0 },
  )
  if (tie && worst.forceKn > governing.capacityKn + 1e-6) {
    warnings.push({
      kind: 'tie-over-capacity',
      message: `The row at ${Math.round(worst.elevationMm)} mm carries ${worst.forceKn.toFixed(1)} kN per tie against ${governing.capacityKn.toFixed(0)} kN at the ${governing.component}, and the walers cannot close further. Pour slower, pour warmer, use a stiffer consistency, or specify a heavier tie.`,
      demandKn: worst.forceKn,
      capacityKn: governing.capacityKn,
      elevationMm: worst.elevationMm,
    })
  }

  const studsBetweenTies = studsBetween(tieAdoptedM)
  if (studsBetweenTies < MIN_STUDS_BETWEEN_TIES_FOR_UNIFORM_LOAD) {
    // Whether the correction actually bit is worth saying: on a waler that shears
    // before it bends it does not, and a message claiming a reduction that is not in
    // the numbers is the kind of thing that gets a whole report distrusted.
    const uniformM = attempt.solved?.spanM ?? Number.POSITIVE_INFINITY
    const cut = uniformM > attempt.bendingSpanM + 1e-9
    warnings.push({
      kind: 'point-load-analysis-required',
      message: `Only ${studsBetweenTies} stud${studsBetweenTies === 1 ? '' : 's'} lands between ties at ${stud.adoptedM.toFixed(2)} m and ${tieAdoptedM.toFixed(2)} m centres, so the walers take point loads rather than a uniform one. ${
        cut
          ? `The waler span was cut from ${uniformM.toFixed(2)} m to ${attempt.bendingSpanM.toFixed(2)} m to suit; closing the studs would let the ties open back out.`
          : `The waler is governed by ${attempt.solved?.governedBy ?? 'bending'} rather than bending, so the concentration does not reduce its span — but the assumption is outside APA's tables and is worth a hand check.`
      }`,
    })
  }

  for (const [label, member] of [
    ['Studs', stud],
    ['Walers', waler],
    ['Ties', tieSpacing],
  ] as const) {
    if (member.stated && member.utilisation > 1 + 1e-6) {
      warnings.push({
        kind: 'stated-spacing-over-capacity',
        message: `${label} are stated at ${member.adoptedM.toFixed(3)} m and the check allows ${member.calculatedM.toFixed(3)} m under ${member.loadKnM.toFixed(1)} kN/m, governed by ${member.governedBy}. That is ${Math.round(member.utilisation * 100)} % of capacity. Close the spacing or state a stronger member.`,
      })
    }
  }

  if (stud.adoptedM <= WALL_MODULE_M + 1e-9) {
    warnings.push({
      kind: 'spacing-below-practical-minimum',
      message: `The shutter needs studs at ${stud.calculatedM.toFixed(3)} m under ${designPressureKnM2.toFixed(1)} kN/m², which is closer than a shutter is framed. Use thicker sheathing or reduce the pressure.`,
    })
  }

  // Off the graded rows rather than off `tieSpacing`, which is the base band's figure:
  // a wall whose upper rows open out to 1200 mm does not carry the base density all
  // the way up, and a parts count taken from the worst band buys ties nobody fixes.
  // Each row puts `1/s_h` ties in every metre of wall length, so the rows summed and
  // divided by the height is the density.
  const tiesPerM2 =
    opts.liftHeightM > 0
      ? rows.reduce((perM, row) => perM + 1000 / row.horizontalSpacingMm, 0) / opts.liftHeightM
      : 0
  return {
    envelope: opts.envelope,
    designPressureKnM2,
    sheathing,
    beam,
    tie,
    tieCapacityKn: governing.capacityKn,
    tieCapacityComponent: governing.component,
    stud,
    waler,
    tieSpacing,
    rows,
    studsBetweenTies,
    bracing: braceDesign({
      liftHeightM: opts.liftHeightM,
      windPressureKpa: opts.windPressureKpa,
      formDeadLoadKnM: opts.formDeadLoadKnM,
      rakerSpacingM: opts.rakerSpacingM,
      rakerAngleDeg: opts.rakerAngleDeg,
      connectionHeightM: opts.braceConnectionHeightM,
      guyWires: opts.guyWires,
    }),
    tiesPerM2,
    warnings,
  }
}
