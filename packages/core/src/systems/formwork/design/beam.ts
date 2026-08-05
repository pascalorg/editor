/**
 * The continuous-beam core. Every member check in formwork design reduces to it:
 * sheathing between joists, joists between bearers, bearers between props, walers
 * between ties. The member changes and the load changes; the arithmetic does not.
 *
 * Three checks, and the tightest wins — which one that is, is not predictable and
 * is the single most useful thing to report. Deflection governs thin plywood at
 * close centres, shear governs it at wide ones, and bending governs the timber
 * beams. APA's own worked example comes out on deflection at 370 psf against 412
 * for bending and 714 for shear, so a design that checked bending alone would be
 * 11 % unsafe and would look fine.
 *
 * The same function serves a plate and a beam because the units are parallel
 * rather than different: a beam takes `kN/m` of line load against `kNm` and `kN`
 * capacities, a sheet takes `kN/m²` of pressure against per-metre-of-width
 * `kNm/m` and `kN/m` capacities. Both reduce to the same numbers, so passing
 * per-metre-width properties and a pressure is not a unit error — it is the
 * documented second reading.
 *
 * See `wiki/formwork/reference/design.md` §2.2.
 */

/**
 * Spans the member is continuous over. Three is the cap because the coefficients
 * stop moving after it — a four-span beam and a ten-span beam are both `wL²/10`.
 */
export type SpanCount = 1 | 2 | 3

export interface SpanCoefficients {
  /** `Mmax = moment · w · L²` */
  moment: number
  /** `Vmax = shear · w · L` */
  shear: number
  /** `Δmax = w · L⁴ / (deflection · EI)` — a divisor, so larger is stiffer. */
  deflection: number
}

/**
 * ACI/APA's continuous-beam coefficients.
 *
 * Note the two-span row is *stiffer* in deflection than the three-span one — 185
 * against 145 — while being weaker in shear. Two spans put a hard support at the
 * middle of the run and hold the deflection down, but they also pile 0.625wL into
 * that support against a three-span beam's 0.600wL. So there is no ordering of
 * these rows by "better", and picking the span count by eye gets it wrong in one
 * of the two checks whichever way it is picked.
 */
const COEFFICIENTS: Record<SpanCount, SpanCoefficients> = {
  // 5wL⁴/(384EI) expressed as a divisor: 384/5.
  1: { moment: 1 / 8, shear: 1 / 2, deflection: 76.8 },
  2: { moment: 1 / 8, shear: 0.625, deflection: 185 },
  3: { moment: 1 / 10, shear: 0.6, deflection: 145 },
}

export function spanCoefficients(spans: SpanCount): SpanCoefficients {
  return COEFFICIENTS[spans]
}

/**
 * A member's capacity, on the basis it was published. Permissible values are
 * compared against the working load directly; an ultimate one has to be divided
 * down first, and nothing in the number itself says which it is — which is the
 * H20 conflict in products.md §2.2, where the same beam is published at 5 kNm and
 * at 11 kNm and using the wrong one over-spans the deck by a factor of two.
 */
export interface MemberCapacity {
  /** Bending resistance, kNm (a beam) or kNm per m of width (a sheet). */
  momentKnM: number
  /** Shear resistance, kN (a beam) or kN per m of width (a sheet). */
  shearKn: number
  /** Flexural rigidity, kNm² (a beam) or kNm² per m of width (a sheet). */
  eiKnM2: number
}

/**
 * How far the member may sag. Both limits apply and the tighter wins: a ratio
 * alone lets a long span deflect visibly, and an absolute cap alone is needlessly
 * tight on a short one. Lumber framing tables are built on `L/360` *and* 6 mm
 * together, so a check that drops either does not reproduce them.
 */
export interface DeflectionLimit {
  /** The `360` in `L/360`. */
  ratio: number
  /** Hard cap regardless of span, mm. Undefined for ratio-only. */
  absoluteMm?: number
}

/** `l/360` — architectural or exposed concrete, ACI Class A. */
export const DEFLECTION_ARCHITECTURAL: DeflectionLimit = { ratio: 360, absoluteMm: 1.6 }

/** `l/270` — general structural work. */
export const DEFLECTION_STRUCTURAL: DeflectionLimit = { ratio: 270 }

/** `l/360` with the 6 mm cap the lumber framing tables are built on. */
export const DEFLECTION_LUMBER: DeflectionLimit = { ratio: 360, absoluteMm: 6 }

export type SpanGoverning = 'bending' | 'shear' | 'deflection'

export interface AllowableSpan {
  spanM: number
  governedBy: SpanGoverning
  spans: SpanCount
  /** Each check's own answer, so a report can show why the winner won. */
  bendingM: number
  shearM: number
  deflectionM: number
}

/**
 * The furthest apart this member's supports may be under `loadKnM`, and which
 * check said so.
 *
 * Load is `kN/m` for a beam and `kN/m²` for a sheet — see the module note. Zero
 * or negative load returns `Infinity` rather than throwing, because an unloaded
 * member genuinely has no span limit and the caller's practical maximum is what
 * should bite there.
 */
export function allowableSpan(
  loadKnM: number,
  member: MemberCapacity,
  limit: DeflectionLimit,
  spans: SpanCount,
): AllowableSpan {
  const c = COEFFICIENTS[spans]
  if (loadKnM <= 0) {
    return {
      spanM: Number.POSITIVE_INFINITY,
      governedBy: 'bending',
      spans,
      bendingM: Number.POSITIVE_INFINITY,
      shearM: Number.POSITIVE_INFINITY,
      deflectionM: Number.POSITIVE_INFINITY,
    }
  }

  // M = c·w·L² ≤ M_R
  const bendingM = Math.sqrt(member.momentKnM / (c.moment * loadKnM))
  // V = c·w·L ≤ V_R
  const shearM = member.shearKn / (c.shear * loadKnM)

  // Δ = w·L⁴/(k·EI) ≤ L/ratio  →  L³ ≤ k·EI/(ratio·w)
  const fromRatio = Math.cbrt((c.deflection * member.eiKnM2) / (limit.ratio * loadKnM))
  // Δ ≤ Δ_abs  →  L⁴ ≤ Δ_abs·k·EI/w
  const fromAbsolute =
    limit.absoluteMm === undefined
      ? Number.POSITIVE_INFINITY
      : (((limit.absoluteMm / 1000) * c.deflection * member.eiKnM2) / loadKnM) ** 0.25
  const deflectionM = Math.min(fromRatio, fromAbsolute)

  const spanM = Math.min(bendingM, shearM, deflectionM)
  const governedBy: SpanGoverning =
    spanM === deflectionM ? 'deflection' : spanM === shearM ? 'shear' : 'bending'
  return { spanM, governedBy, spans, bendingM, shearM, deflectionM }
}

/**
 * How many spans a run of `runM` is continuous over at a span of `spanM`. A run
 * shorter than two spans is a single simply-supported one however it was
 * intended; anything past three reads as three.
 */
export function spanCountForRun(runM: number, spanM: number): SpanCount {
  if (!(spanM > 0) || !(runM > 0)) return 1
  const bays = Math.floor(runM / spanM + 1e-9)
  if (bays >= 3) return 3
  if (bays === 2) return 2
  return 1
}

/**
 * The allowable span with the span count resolved against the run it sits in.
 *
 * This is circular — the coefficients depend on the number of spans, which
 * depends on the span they produce — so it is solved by iteration rather than
 * assumed. Assuming three spans is the common shortcut and it is unconservative
 * on a short run: a 2.4 m secondary beam solved at `wL²/10` and then set out as
 * one span is carrying `wL²/8`, a 25 % overload with nothing on the drawing to
 * show it.
 *
 * Converges in two passes in every real case; the loop is bounded anyway because
 * a two-cycle oscillation between adjacent counts is possible in principle and
 * settling on the more conservative of the pair is the right answer if it happens.
 */
export function solveSpan(
  loadKnM: number,
  member: MemberCapacity,
  limit: DeflectionLimit,
  runM: number,
): AllowableSpan {
  let result = allowableSpan(loadKnM, member, limit, 3)
  let spans = result.spans
  for (let i = 0; i < 3; i++) {
    const next = spanCountForRun(runM, result.spanM)
    if (next === spans) return result
    const candidate = allowableSpan(loadKnM, member, limit, next)
    // Oscillating between two counts means the run straddles the boundary. Keep
    // the tighter span rather than flipping.
    if (candidate.spanM > result.spanM && i > 0) return result
    result = candidate
    spans = next
  }
  return result
}

/**
 * A calculated span rounded down onto a module the crew can set out, m.
 *
 * Real layouts are normalised to a repeatable module even where the arithmetic
 * would allow more — APA's own example places studs calculated at 32″ at 24″ and
 * ties calculated at 22.5″ at 12″, *"to maintain a symmetrical layout"* and
 * because *"equal spacings will reduce errors"*. So both figures are reported:
 * the calculated one is the engineering, the adopted one is the drawing.
 */
export function adoptSpan(spanM: number, moduleM: number): number {
  if (!(moduleM > 0) || !Number.isFinite(spanM)) return spanM
  const stepped = Math.max(moduleM, Math.floor(spanM / moduleM + 1e-9) * moduleM)
  // 12 × 0.05 is 0.6000000000000001 in binary floating point, and a spacing that
  // reads as over its own practical ceiling fails a check it should pass. Rounded
  // to the micrometre: finer than any module, coarser than the residue.
  return Math.round(stepped * 1e6) / 1e6
}

/** How hard a member is worked at the span actually adopted, 1.0 being at capacity. */
export function utilisation(adoptedM: number, allowableM: number): number {
  if (!Number.isFinite(allowableM) || allowableM <= 0) return 0
  return adoptedM / allowableM
}

export interface MemberDesign {
  /** What the check allowed, m — the engineering figure. */
  calculatedM: number
  /** What goes on the drawing, m — rounded down to the setting-out module. */
  adoptedM: number
  governedBy: SpanGoverning
  /** Spans the member was taken as continuous over. */
  spans: number
  /** Line load on the member, kN/m. Pressure in kN/m² for the sheathing. */
  loadKnM: number
  /** How hard the member works at the adopted spacing, 1.0 being at capacity. */
  utilisation: number
  /** Set where a practical ceiling, not the arithmetic, produced `adoptedM`. */
  cappedBy?: 'practical-maximum'
  /** Set where the project fixed `adoptedM` and the check only reports against it. */
  stated?: true
}

/**
 * A solved span turned into the pair of figures a drawing carries.
 *
 * `statedM` is a spacing the project has fixed. It is honoured as given rather
 * than tightened, because a crew setting out to a stated module and finding the
 * drawing disagrees will trust the drawing — but the utilisation is then reported
 * against it, so a stated spacing that overloads the member shows up as a warning
 * rather than as a silently retightened row. Same contract as the clamp schedule's
 * `uniformSpacingM`.
 */
export function memberDesign(
  solved: AllowableSpan,
  loadKnM: number,
  opts: { moduleM: number; maxM: number; statedM?: number },
): MemberDesign {
  const calculatedM = solved.spanM
  const cappedByPractical = opts.statedM === undefined && calculatedM > opts.maxM
  const adoptedM =
    opts.statedM !== undefined
      ? opts.statedM
      : adoptSpan(Math.min(calculatedM, opts.maxM), opts.moduleM)
  return {
    calculatedM,
    adoptedM,
    governedBy: solved.governedBy,
    spans: solved.spans,
    loadKnM,
    utilisation: utilisation(adoptedM, calculatedM),
    ...(cappedByPractical ? { cappedBy: 'practical-maximum' as const } : {}),
    ...(opts.statedM !== undefined ? { stated: true as const } : {}),
  }
}
