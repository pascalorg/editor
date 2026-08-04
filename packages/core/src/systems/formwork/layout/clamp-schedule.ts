import {
  type ColumnClampType,
  type ColumnFormType,
  clampForSizeMm,
  columnFormSizeMm,
} from '../catalog'
import { type PressureEnvelope, pressureAtDepth } from '../pressure'

/**
 * Where a column's clamps go, and why they are not evenly spaced.
 *
 * A column is filled fast and it is short, so the pressure diagram is strongly
 * triangular over its whole height: near the top there is barely any head, near the
 * base there is all of it. The load on one clamp is the pressure over its tributary
 * band, `p(h) × b × s(h)`, so the spacing a clamp can take goes as `1/h` — tight at
 * the bottom, opening out going up. That is exactly the classic column-clamp table
 * (6", 6", 8", 10", 12", 15", 18"… from the base), and it is why a uniform spacing
 * is either unsafe at the base or wasteful at the top.
 *
 * Three things cap the spacing at every level and the tightest wins: what the clamp
 * can hold, what the yoke can span in bending, and what the sheathing can span
 * between clamps. Then two rules from the site: a first clamp close above the kicker,
 * where the pressure is highest and the form most wants to kick out, and a top clamp
 * within one spacing of the pour top so the last of the concrete has something
 * holding it.
 *
 * A monotonicity guard runs over the result. Left alone, the arithmetic can widen
 * and then narrow again as the pressure envelope flattens off, and a schedule that
 * tightens as it rises reads as an error to the crew that has to set it out — so
 * every step is at least as wide as the one below it.
 *
 * See `wiki/formwork/reference/design.md` §2.7.
 */

/** Spacings are set out on the tape, so they are rounded down to this module. */
export const CLAMP_MODULE_MM = 25

/** How far above the kicker the first clamp goes — the base is the worst band. */
export const FIRST_CLAMP_ABOVE_KICKER_MM = 100

/**
 * Widest clamp spacing worth emitting whatever the arithmetic allows, mm. The top
 * band of a tall column carries almost no pressure and the formula would happily
 * open out past a metre, at which point the face is unsupported rather than
 * lightly loaded.
 */
export const MAX_CLAMP_SPACING_MM = 600

/** Tightest spacing a crew can physically set, mm. Below this, reduce the pressure. */
export const MIN_CLAMP_SPACING_MM = 100

/**
 * The kicker a column form lands on. Shorter than a wall's, because it only has to
 * locate a box rather than hold a shutter's line over a length: design.md gives
 * 50–75 mm against the wall's 75–150, so the wall's `DEFAULT_KICKER_MM` is not
 * reusable here.
 */
export const DEFAULT_COLUMN_KICKER_MM = 75

/** 100 mm minimum spacing over 20 m of column, which no lift approaches. */
const MAX_ROWS = 200

/** What set the spacing at a row. */
export type ClampGoverning =
  /** The clamp's own rated load. */
  | 'clamp'
  /** The yoke ran out of bending capacity across the side first. */
  | 'yoke'
  /** The form face could not span further at this pressure. */
  | 'sheathing'
  /** Nothing structural bit; the practical ceiling did. */
  | 'practical-maximum'
  /** Widened to match the row below, because a schedule must not tighten upward. */
  | 'monotonic'
  /** The closing row at the top of the pour. */
  | 'pour-top'
  /** A spacing the job specified, not one this module chose. */
  | 'specified'

export interface ClampRow {
  /** Elevation above the pour base, mm. */
  elevationMm: number
  /** Gap to the row below, mm — the setting-out figure. */
  spacingBelowMm: number
  /** Pressure at this elevation, kN/m². */
  pressureKnM2: number
  /**
   * Load on one clamp at this row, kN. Taken over the tributary band the row
   * actually carries — half the gap below plus half the gap above — which reduces to
   * the plain spacing wherever the schedule is uniform, and does not over- or
   * under-count where it steps.
   */
  forceKn: number
  governedBy: ClampGoverning
}

export type ClampWarningKind =
  /** Even at the minimum workable spacing the clamp is overloaded at the base. */
  | 'over-capacity-at-base'
  /** No clamp in the form reaches this cross-section. */
  | 'no-clamp-for-section'
  /** The section is outside the form's own adjustment range. */
  | 'section-outside-form-range'
  /** Taller than the form stacks to. */
  | 'height-exceeds-form'
  /** No clamp data at all, so the schedule is geometry rather than design. */
  | 'no-clamp-data'

export interface ClampWarning {
  kind: ClampWarningKind
  message: string
  elevationMm?: number
  demandKn?: number
  capacityKn?: number
}

export interface ClampSchedule {
  rows: ClampRow[]
  clamp: ColumnClampType | undefined
  /** Sets of four, one per row — what the BOM orders. */
  setCount: number
  /** Clamps, not sets: what the yard counts off the rack. */
  clampCount: number
  /**
   * The size the box is set to, mm — not the concrete's dimension. A form adjusts on
   * an increment, so 337 mm of concrete is formed at 350, and it is this figure the
   * clamp has to close around and the yoke has to span.
   */
  formSizeMm: number | undefined
  warnings: ClampWarning[]
}

export interface ClampScheduleOptions {
  /** The pour's own height above its base, m. */
  liftHeightM: number
  /** Widest plan dimension of the concrete, m — the side a yoke has to span. */
  sideM: number
  /** Kicker at the base of this pour, m. Zero at a lift joint. */
  kickerM?: number
  envelope: PressureEnvelope
  form?: ColumnFormType
  /**
   * What the form face can span between clamps at a given pressure, mm. The
   * sheathing check from §2.2 — absent for a steel-framed system form, whose face
   * is part of the rated panel, and supplied for a plywood box where the ply span
   * is the thing that actually governs near the base.
   */
  sheathingSpanMm?: (pressureKnM2: number) => number
  /** Overrides the derived schedule with one flat spacing, m — the host's own field. */
  uniformSpacingM?: number
}

function roundDownToModule(valueMm: number): number {
  return Math.max(MIN_CLAMP_SPACING_MM, Math.floor(valueMm / CLAMP_MODULE_MM) * CLAMP_MODULE_MM)
}

/**
 * The spacing one clamp can take at this level, and what limits it.
 *
 * Everything is per side: a clamp spans two opposing faces and its rated figure is
 * what it takes from each, so the tributary load is the pressure over
 * `side × spacing` on one face. `spanM` is the form's size rather than the
 * concrete's, because that is the width the parts actually work over.
 */
function spacingAt(
  pressureKnM2: number,
  spanM: number,
  clamp: ColumnClampType | undefined,
  opts: ClampScheduleOptions,
): { spacingMm: number; governedBy: ClampGoverning } {
  let spacingMm = MAX_CLAMP_SPACING_MM
  let governedBy: ClampGoverning = 'practical-maximum'

  if (pressureKnM2 > 0 && spanM > 0 && clamp) {
    // s ≤ SWL / (p × b), the §2.7 step-5 inversion — the corner tension.
    const fromTension = (clamp.capacityKn / (pressureKnM2 * spanM)) * 1000
    // And the arm's own bending, which is what a clamped box actually runs out of:
    // w = p × s over the side, M = w·b²/8, so s ≤ 8·M / (p × b²). The b² is why this
    // overtakes the tension check on any section past a few hundred millimetres.
    const fromBending = ((8 * clamp.bendingMomentKnM) / (pressureKnM2 * spanM * spanM)) * 1000
    const fromClamp = Math.min(fromTension, fromBending)
    if (fromClamp < spacingMm) {
      spacingMm = fromClamp
      governedBy = 'clamp'
    }
  }

  // A form that publishes its own yoke overrides the clamp's arm: on a system column
  // form the load goes into the frame's stiffback rather than into a loose angle.
  const yokeMomentKnM = opts.form?.yokeMomentKnM
  if (yokeMomentKnM !== undefined && pressureKnM2 > 0 && spanM > 0) {
    const fromYoke = ((8 * yokeMomentKnM) / (pressureKnM2 * spanM * spanM)) * 1000
    if (fromYoke < spacingMm) {
      spacingMm = fromYoke
      governedBy = 'yoke'
    }
  }

  const fromSheathing = opts.sheathingSpanMm?.(pressureKnM2)
  if (fromSheathing !== undefined && fromSheathing < spacingMm) {
    spacingMm = fromSheathing
    governedBy = 'sheathing'
  }

  return { spacingMm, governedBy }
}

function formWarnings(
  form: ColumnFormType | undefined,
  sideMm: number,
  formSizeMm: number | undefined,
  heightMm: number,
  clamp: ColumnClampType | undefined,
): ClampWarning[] {
  const out: ClampWarning[] = []
  if (!form) {
    out.push({
      kind: 'no-clamp-data',
      message:
        'No column form was named, so this schedule is set out from the pressure envelope and the practical spacing limits alone. Nothing has been checked against a clamp capacity.',
    })
    return out
  }
  if (formSizeMm === undefined) {
    out.push({
      kind: 'section-outside-form-range',
      message: `${form.label} adjusts to ${form.maxDimMm} mm and this column is ${Math.round(sideMm)} mm across. A wider section needs a different form, or wall panels closed with the system's outside corners.`,
    })
  }
  if (heightMm > form.maxHeightMm) {
    out.push({
      kind: 'height-exceeds-form',
      message: `${form.label} stacks to ${form.maxHeightMm} mm and this pour is ${Math.round(heightMm)} mm. Split it into lifts.`,
    })
  }
  if (formSizeMm !== undefined && !clamp) {
    out.push({
      kind: 'no-clamp-for-section',
      message: `No clamp offered with ${form.label} reaches the ${formSizeMm} mm the box is set to. The panel fits and the clamp does not, so the box cannot be closed as specified.`,
    })
  }
  return out
}

/**
 * Clamp rows for one column pour, from the base up.
 *
 * `uniformSpacingM` short-circuits the derivation: a job that has been given a
 * spacing by its own engineer gets that spacing, and the pressure is reported
 * against it rather than used to choose it.
 */
export function clampSchedule(opts: ClampScheduleOptions): ClampSchedule {
  const heightMm = opts.liftHeightM * 1000
  const kickerMm = (opts.kickerM ?? 0) * 1000
  const sideMm = opts.sideM * 1000
  const form = opts.form
  const formSizeMm = form ? columnFormSizeMm(form, sideMm) : undefined
  // The clamp closes around the form, not around the concrete: a 337 mm column
  // formed at 350 needs a clamp that reaches 350.
  const clamp = form ? clampForSizeMm(form, formSizeMm ?? sideMm) : undefined
  const spanM = (formSizeMm ?? sideMm) / 1000
  const warnings = formWarnings(form, sideMm, formSizeMm, heightMm, clamp)

  // Pressure is measured down from the top of the pour and the schedule is set out up
  // from the base, so every row's depth is the pour height less its elevation.
  const pressureAtElevation = (elevationMm: number) =>
    pressureAtDepth(opts.envelope, (heightMm - elevationMm) / 1000)

  const elevationsMm: number[] = []
  const governing: ClampGoverning[] = []
  /** The spacing the arithmetic asked for at the base, before the floor and the module. */
  let rawBaseSpacingMm = MAX_CLAMP_SPACING_MM

  if (opts.uniformSpacingM !== undefined) {
    const spacingMm = Math.max(CLAMP_MODULE_MM, opts.uniformSpacingM * 1000)
    for (let y = kickerMm + FIRST_CLAMP_ABOVE_KICKER_MM; y < heightMm - 1e-6; y += spacingMm) {
      elevationsMm.push(y)
      governing.push('specified')
    }
    rawBaseSpacingMm = spacingMm
  } else {
    // First clamp just above the kicker: the base band is the most heavily loaded and
    // the one place the form is levered hardest.
    let at = kickerMm + FIRST_CLAMP_ABOVE_KICKER_MM
    let previousSpacingMm = 0
    while (at < heightMm - 1e-6 && elevationsMm.length < MAX_ROWS) {
      const { spacingMm: raw, governedBy } = spacingAt(pressureAtElevation(at), spanM, clamp, opts)
      if (elevationsMm.length === 0) rawBaseSpacingMm = raw
      const rounded = roundDownToModule(raw)
      // Monotonic upward: a schedule that tightens as it rises is set out wrong more
      // often than it is set out right, whatever the arithmetic says.
      const spacingMm = Math.max(rounded, previousSpacingMm)
      elevationsMm.push(at)
      governing.push(spacingMm > rounded ? 'monotonic' : governedBy)
      previousSpacingMm = spacingMm
      at += spacingMm
    }
  }

  // A closing row at the pour top. Without it the last course is held only by the row
  // below and the concrete lifts the form off its line. Where the leftover is too
  // small to set a clamp in, the top row moves up to the pour top instead of a second
  // one being crammed in beside it — a 25 mm gap is not a row, it is a clash.
  const highest = elevationsMm.at(-1)
  if (highest !== undefined && heightMm - highest > 1e-6) {
    if (heightMm - highest < MIN_CLAMP_SPACING_MM && elevationsMm.length > 1) {
      elevationsMm[elevationsMm.length - 1] = heightMm
      governing[governing.length - 1] = 'pour-top'
    } else {
      elevationsMm.push(heightMm)
      governing.push('pour-top')
    }
  }

  /** The band a row carries: half the gap either side, in mm. */
  const tributaryMm = (i: number): number => {
    const elevationMm = elevationsMm[i] as number
    const below = elevationsMm[i - 1]
    const above = elevationsMm[i + 1]
    // The kicker is a support line, not dead weight — it is cast concrete, and holding
    // the base of the form is the whole reason it exists. So the base clamp shares the
    // band below it with the kicker rather than carrying all of it, which is also why
    // omitting the kicker is one of the standard ways a column form fails at its foot.
    const belowMm = below === undefined ? (elevationMm - kickerMm) / 2 : (elevationMm - below) / 2
    const aboveMm = above === undefined ? heightMm - elevationMm : (above - elevationMm) / 2
    return belowMm + aboveMm
  }

  const rows: ClampRow[] = elevationsMm.map((elevationMm, i) => {
    const below = elevationsMm[i - 1]
    const pressureKnM2 = pressureAtElevation(elevationMm)
    return {
      elevationMm,
      spacingBelowMm: below === undefined ? elevationMm - kickerMm : elevationMm - below,
      pressureKnM2,
      forceKn: pressureKnM2 * spanM * (tributaryMm(i) / 1000),
      governedBy: governing[i] as ClampGoverning,
    }
  })

  // The base row is the one that fails first, and in a derived schedule it is the only
  // row that can: every other row was sized to its own pressure, so an overload here
  // means the arithmetic wanted to go below the tightest spacing a crew can set. A
  // specified schedule can be overloaded anywhere, and the base is where it shows.
  //
  // The check is on spacing rather than on force, because the limit is whichever of
  // tension and bending governed, and bending is not a force. `spacingAt` has already
  // taken the minimum of the two.
  const base = rows[0]
  if (clamp && base) {
    const allowedMm = spacingAt(base.pressureKnM2, spanM, clamp, opts).spacingMm
    // Against the band the row actually carries, not the gap below it: at the base
    // those differ, because the first clamp sits close above the kicker and takes most
    // of its load from the run of form above.
    if (tributaryMm(0) > allowedMm + 1e-6) {
      const specified = opts.uniformSpacingM !== undefined
      warnings.push({
        kind: 'over-capacity-at-base',
        message: specified
          ? `At the specified ${Math.round(rawBaseSpacingMm)} mm the base clamp is overloaded: ${base.pressureKnM2.toFixed(1)} kN/m² over a ${spanM.toFixed(2)} m side allows ${roundDownToModule(allowedMm)} mm. Leave the spacing unset to have it derived from the pressure.`
          : `At ${MIN_CLAMP_SPACING_MM} mm — the tightest spacing a crew can set — the base clamp is still overloaded: ${base.pressureKnM2.toFixed(1)} kN/m² over a ${spanM.toFixed(2)} m side allows only ${allowedMm.toFixed(0)} mm. Pour slower, pour warmer, or use a stiffer consistency: the schedule has nothing left to give.`,
        elevationMm: base.elevationMm,
        demandKn: base.forceKn,
        capacityKn: clamp.capacityKn,
      })
    }
  }

  return {
    rows,
    clamp,
    setCount: rows.length,
    clampCount: rows.length * (clamp?.setQuantity ?? 4),
    formSizeMm,
    warnings,
  }
}
