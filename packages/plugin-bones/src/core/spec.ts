/**
 * FramingSpec — the resolved parameter set the engines run with. Built by
 * merging: engine defaults ← jurisdiction profile (state) ← user overrides
 * (the `bones:framing` config node). Everything in meters unless suffixed.
 */

import framingTables from '../../data/framing-tables.json'
import type { LumberSize } from '../lumber'
import { feet, inches } from './units'

export type HeaderRule = { maxSpan: number; size: LumberSize }

/**
 * Allowable-span table: nominal size → o.c. spacing (inches, string key as in
 * data/framing-tables.json: '12' | '16' | '24') → allowable span in METERS.
 * Rafter spans are measured on the HORIZONTAL PROJECTION (IRC convention).
 */
export type SpanTable = Partial<Record<LumberSize, Record<string, number>>>

type JsonSpanRows = Record<string, Record<string, { spanFt: number }>>

/** data/framing-tables.json rows (feet) → SpanTable (meters). */
function toSpanTable(rows: JsonSpanRows): SpanTable {
  const out: SpanTable = {}
  for (const [size, cols] of Object.entries(rows)) {
    const row: Record<string, number> = {}
    for (const [spacing, cell] of Object.entries(cols)) row[spacing] = feet(cell.spanFt)
    out[size as LumberSize] = row
  }
  return out
}

/** data/framing-tables.json header cells — ft-in strings are authoritative. */
type JsonHeaderRows = Record<
  string,
  Record<string, { spanFtIn: string; spanFt: number; jackStudsEachEnd: number }>
>

const tables = framingTables as unknown as {
  rafters: {
    groundSnow20Psf: { spans: JsonSpanRows }
    groundSnow50Psf: { spans: JsonSpanRows }
  }
  ceilingJoists: { spans: JsonSpanRows }
  headers: {
    groundSnow50Psf: { roofAndCeiling: JsonHeaderRows }
    groundSnow70Psf: { roofAndCeiling: JsonHeaderRows }
  }
}

/** IRC 2021 Table R802.4.1(1) — roof live load 20 psf (the low-snow default:
 * where ground snow ≲ 30 psf the 20 psf roof live load governs, per the
 * table note). SPF #2, dead load 10 psf, L/180, horizontal projection. */
export const RAFTER_SPANS_SNOW20: SpanTable = toSpanTable(tables.rafters.groundSnow20Psf.spans)

/** IRC 2021 Table R802.4.1(5) — ground snow load 50 psf. SPF #2. */
export const RAFTER_SPANS_SNOW50: SpanTable = toSpanTable(tables.rafters.groundSnow50Psf.spans)

/** IRC 2021 Table R802.5.1(2) — ceiling joists, uninhabitable attic with
 * limited storage (20 psf live / 10 dead, L/240). SPF #2. */
export const CEILING_JOIST_SPANS: SpanTable = toSpanTable(tables.ceilingJoists.spans)

/**
 * Rafter table for a ground snow load, mirroring how `rafterSize` moves in
 * `applyJurisdiction`: < 50 psf → the 20-psf-live table (its own low-snow
 * note), ≥ 50 psf → the 50-psf table. The data ships no ≥ 70 psf column and
 * no state profile exceeds 60 psf today; 50–70 psf sites read the 50-psf
 * table (slightly long at 60 psf — verify locally, per the data disclaimer).
 */
export function rafterSpansForSnow(groundSnowLoadPsf: number): SpanTable {
  return groundSnowLoadPsf >= 50 ? RAFTER_SPANS_SNOW50 : RAFTER_SPANS_SNOW20
}

/**
 * Header rules — the low-snow default (LOD-400 B11 named it; the literal is
 * the shipped `simplifiedFallback` map): max clear span → nominal solid 4x,
 * where a 4x stands for the two-2x-ply built-up header of IRC Table
 * R602.7(1). Consistent with the table's 30-psf ground-snow column
 * (roof-and-ceiling condition) up to ~24 ft building width — footnote e
 * makes 30 psf the low-snow default (< 30 psf w/ roof live ≤ 20 psf).
 */
export const HEADER_RULES_SNOW30: HeaderRule[] = [
  { maxSpan: inches(24), size: '4x4' },
  { maxSpan: inches(36), size: '4x6' },
  { maxSpan: inches(60), size: '4x8' },
  { maxSpan: inches(84), size: '4x10' },
  { maxSpan: Number.POSITIVE_INFINITY, size: '4x12' },
]

/** '5-11' (ft-in, authoritative in the data file) → meters. ONE arithmetic
 * path (whole inches) so a threshold derived from '6-2' compares EXACTLY
 * equal to an engine span built as inches(74) — mixing feet()+inches()
 * lands 2e-16 above it and would flip the band boundaries. */
function ftInToMeters(spanFtIn: string): number {
  const [ft, inch] = spanFtIn.split('-').map(Number)
  return inches((ft ?? 0) * 12 + (inch ?? 0))
}

/**
 * Header rules for a heavy-snow band, derived from the encoded Table
 * R602.7(1) rows (roof-and-ceiling condition, 2-ply ≙ solid 4x): each
 * size's threshold is min(tabulated span at the 24-ft building-width
 * column, the low-snow default's threshold) — never LOOSER than the
 * shipped default (the default's small-size steps are rounded below the
 * table, and heavier snow must never print a shallower header), never
 * LONGER than the code cell. The terminal open-ended 4x12 rule stays, but
 * it is NOT a table claim past the band's 2-2x12 cell — the band caps
 * `engineeredHeaderSpan` there (`terminalSpanOf` below), so longer spans
 * route to the ENGINEERED machinery.
 */
function headerRulesFromSnowColumn(rows: JsonHeaderRows): HeaderRule[] {
  return HEADER_RULES_SNOW30.map((rule) => {
    if (!Number.isFinite(rule.maxSpan)) return { ...rule }
    const cell = rows[`2-${rule.size.replace('4x', '2x')}`]?.['24']
    if (!cell) return { ...rule }
    return { maxSpan: Math.min(rule.maxSpan, ftInToMeters(cell.spanFtIn)), size: rule.size }
  })
}

/** IRC 2021 Table R602.7(1), 50-psf ground-snow column (24-ft width). */
export const HEADER_RULES_SNOW50: HeaderRule[] = headerRulesFromSnowColumn(
  tables.headers.groundSnow50Psf.roofAndCeiling,
)

/** IRC 2021 Table R602.7(1), 70-psf ground-snow column (24-ft width). */
export const HEADER_RULES_SNOW70: HeaderRule[] = headerRulesFromSnowColumn(
  tables.headers.groundSnow70Psf.roofAndCeiling,
)

/**
 * A band's prescriptive TERMINAL span — its 2-2x12 cell at the 24-ft width
 * column (50 psf: 6-11 = 83"; 70 psf: 6-2 = 74"). Past it the table has no
 * 2-ply answer (3-/4-ply rows and R602.7's engineered path take over), so
 * the band also CAPS `engineeredHeaderSpan` (applyJurisdiction takes
 * min(default 10 ft, cap)): a longer span routes to the ENGINEERED
 * machinery — supplier SKU + 'ENGINEERED BEAM REQUIRED' flag — instead of
 * a silent lumber 4x12 whose assumption label would AFFIRM the table
 * outside its domain (skeptic round 2 — the B9-r2 domain class: VT 76–110"
 * headers claimed the 70-psf table past its 74" cell). The low-snow band
 * leaves the shipped 10-ft threshold untouched: its labels make no table
 * claim (that terminal gap is pre-existing and out of B11 scope), and
 * low-snow output must stay byte-equal.
 */
function terminalSpanOf(rows: JsonHeaderRows): number | undefined {
  const cell = rows['2-2x12']?.['24']
  return cell ? ftInToMeters(cell.spanFtIn) : undefined
}

/** 2-2x12 @ 50 psf / 24 ft: 6-11 (83"). */
export const HEADER_TERMINAL_SPAN_SNOW50 = terminalSpanOf(
  tables.headers.groundSnow50Psf.roofAndCeiling,
)

/** 2-2x12 @ 70 psf / 24 ft: 6-2 (74"). */
export const HEADER_TERMINAL_SPAN_SNOW70 = terminalSpanOf(
  tables.headers.groundSnow70Psf.roofAndCeiling,
)

/**
 * Header band for a ground snow load — Table R602.7(1) tabulates its three
 * columns at 30/50/70 psf, and a column may not serve loads ABOVE it (the
 * spans would run long), so the band snaps UP: ≤ 30 psf reads the 30-psf
 * column (footnote e covers < 30), 30–50 the 50-psf column, above 50 the
 * 70-psf column. (Contrast `rafterSpansForSnow`: rafters read the 50-psf
 * table up to 70 psf only because the data ships no 70-psf rafter table —
 * a disclaimed data limitation, not a convention to copy. The header data
 * DOES carry all three columns.) The table also keys on BUILDING WIDTH,
 * which the spec does not carry — the band states the assumption and the
 * wall engine prints it on every header it sizes (label, never a guess);
 * the low-snow band carries none so default output stays byte-equal.
 * Sites past the 70-psf column (no shipped state profile exceeds 60) are
 * beyond the prescriptive table — the assumption says so. The band also
 * returns its prescriptive terminal span (`engineeredSpanCap`) so
 * `applyJurisdiction` can stop the open-ended 4x12 rule from claiming the
 * table past its 2-2x12 cell (see `terminalSpanOf`).
 */
export function headerBandForSnow(groundSnowLoadPsf: number): {
  rules: HeaderRule[]
  assumption?: string
  engineeredSpanCap?: number
} {
  if (groundSnowLoadPsf <= 30) return { rules: HEADER_RULES_SNOW30 }
  const band = groundSnowLoadPsf <= 50 ? 50 : 70
  const beyond =
    groundSnowLoadPsf > 70
      ? ` — ${groundSnowLoadPsf} psf exceeds the table's 70 psf column: engineered design required`
      : ''
  return {
    rules: band === 50 ? HEADER_RULES_SNOW50 : HEADER_RULES_SNOW70,
    assumption:
      `sized per Table R602.7(1) @ ${band} psf ground snow — ` +
      `≤ 24 ft building width, roof-and-ceiling loading assumed${beyond}`,
    engineeredSpanCap: band === 50 ? HEADER_TERMINAL_SPAN_SNOW50 : HEADER_TERMINAL_SPAN_SNOW70,
  }
}

/**
 * Allowable span (m) for `size` at `spacing` (m o.c.). The spacing snaps UP
 * to the next tabulated column (wider spacing → shorter span — conservative);
 * past the last column the last column is used. `undefined` when the size has
 * no tabulated row (no prescriptive check possible).
 */
export function tableSpanFor(
  table: SpanTable,
  size: LumberSize,
  spacing: number,
): number | undefined {
  const row = table[size]
  if (!row) return undefined
  const spacingIn = spacing / inches(1)
  const keys = Object.keys(row)
    .map(Number)
    .sort((a, b) => a - b)
  const key = keys.find((k) => spacingIn <= k + 0.5) ?? keys[keys.length - 1]
  return key === undefined ? undefined : row[String(key)]
}

export type FramingSpec = {
  /** Resolved LOD: '200' generic · '300' code-sized · '400' fabrication. */
  detail: '200' | '300' | '400'
  /** Stud on-center spacing (16" default, 24" allowed). */
  studSpacing: number
  /** Double top plate by default. */
  topPlateCount: 1 | 2
  /** Interior wall stud size when wall thickness is thin. */
  interiorStudSize: LumberSize
  /** Exterior wall stud size (2x6 for thick walls / energy codes). */
  exteriorStudSize: LumberSize
  /** Wall thickness (m) at/above which studs bump to `exteriorStudSize`. */
  thickWallThreshold: number
  /** Header sizing by clear rough span — first rule whose maxSpan fits wins. */
  headerRules: HeaderRule[]
  /**
   * Assumption the header rules ride on (LOD-400 B11): the heavy-snow
   * bands size from Table R602.7(1), which also keys on building width —
   * not in the spec — so the wall engine prints this on every header it
   * sizes. Unset in the low-snow band (default output stays byte-equal).
   */
  headerAssumption?: string
  /** Rough-opening pad added to a door/window nominal width when RO unset. */
  roughOpeningPad: number
  /** Span (m) past which a header is flagged as needing an engineered beam. */
  engineeredHeaderSpan: number
  // ---- floor ----
  joistSpacing: number
  /** Preferred joist depth ladder — engine picks first that spans. */
  joistSizes: LumberSize[]
  /** Allowable simple span (m) per size at 16" o.c. — SPF #2 40psf (IRC R502.3.1(2)). */
  joistSpans: Partial<Record<LumberSize, number>>
  // ---- roof ----
  rafterSpacing: number
  rafterSize: LumberSize
  /** Allowable rafter spans (horizontal projection, m) — R802.4.1, SPF #2.
   * Swapped by snow band in `applyJurisdiction` (rafterSpansForSnow). */
  rafterSpans: SpanTable
  ceilingJoistSpacing: number
  ceilingJoistSize: LumberSize
  /** Allowable ceiling-joist spans (m) — R802.5.1(2), SPF #2, limited storage. */
  ceilingJoistSpans: SpanTable
  // ---- foundation ----
  /** Footing depth below grade (frost-driven, jurisdiction). */
  footingDepth: number
  footingWidth: number
  stemwallThickness: number
  anchorBoltSpacing: number
  anchorBoltEndDistance: number
  /** SDC D+ → hold-downs at braced ends, tighter anchors. */
  seismicHoldDowns: boolean
  /** High-wind → hurricane ties at rafter/plate. */
  hurricaneTies: boolean
  /**
   * ≥ 130 mph design wind (LOD-400 B10): the wall engine CONTINUES the
   * uplift path the roof ties start — stud-to-plate connectors, header/king
   * uplift straps at openings, plate-to-foundation straps (R802.11,
   * R301.2.1/WFCM). Distinct from `hurricaneTies`, which is ALSO true for
   * sub-130 coastal belt-and-braces states (TX/AL/GA/NY…) that get roof
   * ties with no wall-side prescriptive-uplift claim — the trigger mirrors
   * data/wall-assemblies.json's highWind overlay
   * ('ultimateWindMph >= 130 && flags.hurricaneTies').
   */
  highWindUplift: boolean
  /**
   * ≥ 130 mph design wind WITHOUT the researched `hurricaneTies` flag
   * (today exactly CA-NU — extreme Arctic wind, NBC-researched flags carry
   * no prescriptive uplift-continuation claim): `applyJurisdiction`'s wind
   * leg still mints roof ties, but BOTH shipped tie labels would lie here —
   * the belt clause says 'below 130 mph' (false at 140) and the plain
   * label implies B10's wall continuation (not built). The spec carries
   * the third class so `tieAt` can state exactly what holds. OPTIONAL,
   * folded only when the class applies (the LGS convention) — absent keeps
   * the spec object byte-identical to master (the E5 baseline pins the
   * spec).
   */
  highWindTiesOnly?: boolean
  // ---- wall bracing (R602.10, LOD-400 B9) ----
  /**
   * Declared braced-wall METHOD. v1 ships CS-WSP only (continuous
   * sheathing, wood structural panel — the assembly the layer engine
   * already builds on every exterior face); the field exists so the
   * declaration is data, not prose, and v2's panel-schedule math has a
   * knob to key on.
   */
  wallBracingMethod: 'CS-WSP'
  // ---- framing system (LGS Phase 0 — data model only) ----
  /**
   * Structural framing system: dimensional lumber (IRC Chapters 5/6/8 wood
   * prescriptive path — everything the engines build today) or light-gauge
   * steel (cold-formed steel per IRC R603 walls / R505 floors / R804 roofs,
   * AISI S230/S240 member designations). ABSENT means 'lumber' — the field
   * is optional and NOT in DEFAULT_SPEC, so every existing spec object (and
   * the E5 master-baseline bytes, which pin the spec) is untouched. Phase 0
   * ships the TYPE and the profile catalog (data/lgs-profiles.json +
   * src/engines/lgs-profiles.ts); no engine consumes it yet — Phase 1 does
   * (docs/plans/LGS-PLAN.md).
   */
  framingSystem?: 'lumber' | 'lgs'
  /**
   * Roll-forming machine key ('vendor/machine', e.g. 'framecad/f325it' —
   * keys of data/lgs-profiles.json vendors[].machines) constraining LGS
   * member selection to what that machine can roll. Only meaningful with
   * framingSystem 'lgs'; resolution + the honest fallback chain live in
   * src/engines/lgs-profiles.ts (`profileFor`).
   */
  lgsMachine?: string
  /**
   * Roof system: site-cut stick framing (rafters + ceiling joists — the
   * engine's original output) or pre-engineered trusses. ABSENT means
   * 'stick' — optional and NOT in DEFAULT_SPEC for the same reason as
   * framingSystem: the E5 master-baseline bytes pin the spec object, and
   * every stored scene must round-trip untouched. Consumed by
   * src/engines/roof-framing.ts (`frameRoofs` forks per gable segment).
   */
  roofSystem?: 'stick' | 'truss'
  /**
   * A shed (mono-pitch) segment's ceiling: 'joists' — ceiling joists
   * across the depth on the low plate, lapped over the partitions like a
   * gable's (a flat ceiling under the single plane) — or 'none', the
   * vaulted underside (the engine's original output). ABSENT means 'none'
   * (the same byte-parity rule as roofSystem). Consumed by frameShed.
   */
  shedCeiling?: 'none' | 'joists'
  /**
   * The pad footing under a porch / deck / girder post, inches square.
   * ABSENT means the engine's 24 in (R403.1 prescriptive pad); set from the
   * panel to change every post pad at once (Steve: "standard footing size,
   * make it so it can be changed easily"). Same byte-parity rule.
   */
  postPadIn?: number
}

export const DEFAULT_SPEC: FramingSpec = {
  detail: '300',
  studSpacing: inches(16),
  topPlateCount: 2,
  interiorStudSize: '2x4',
  exteriorStudSize: '2x6',
  thickWallThreshold: 0.13,
  headerRules: HEADER_RULES_SNOW30,
  roughOpeningPad: inches(1.5),
  engineeredHeaderSpan: feet(10),
  joistSpacing: inches(16),
  joistSizes: ['2x8', '2x10', '2x12'],
  // SPF #2, 40 psf live / 10 dead, L/360, 16" o.c. — R502.3.1(2)
  joistSpans: { '2x6': feet(9.5), '2x8': feet(12.25), '2x10': feet(15), '2x12': feet(17.4) },
  rafterSpacing: inches(24),
  rafterSize: '2x6',
  rafterSpans: RAFTER_SPANS_SNOW20,
  ceilingJoistSpacing: inches(16),
  ceilingJoistSize: '2x6',
  ceilingJoistSpans: CEILING_JOIST_SPANS,
  footingDepth: inches(12),
  footingWidth: inches(16),
  stemwallThickness: inches(8),
  anchorBoltSpacing: feet(6),
  anchorBoltEndDistance: inches(12),
  seismicHoldDowns: false,
  hurricaneTies: false,
  highWindUplift: false,
  wallBracingMethod: 'CS-WSP',
}

/** Pick a header size for a clear span using the spec's rules. */
export function headerFor(spec: FramingSpec, clearSpan: number): LumberSize {
  for (const rule of spec.headerRules) {
    if (clearSpan <= rule.maxSpan) return rule.size
  }
  return spec.headerRules[spec.headerRules.length - 1]?.size ?? '4x12'
}
