/**
 * LGS wall framing engine — Phase 1 of the LGS track (docs/plans/LGS-PLAN.md).
 * Pure function: WallSlices + FramingSpec → the IRC R603 cold-formed steel
 * wall member set:
 *
 *   bottom + top TRACK (T125, "same minimum thickness as the wall studs" —
 *   R603.3.2 verbatim) · C-studs (350S162/550S162) at the spec's o.c.
 *   spacing · per opening: king + jack studs (R603.7 structure), a 2-C box
 *   header (R603.6 structure), sill track (R603.8), cripples · horizontal
 *   strap bracing rows (R603.3.3: 1-1/2" × 33 mil — mid-height on ≤ 8 ft
 *   walls, third points on 9/10 ft) · S240 A5.9 factory punchout METADATA
 *   on the verticals at LOD 400 (the Phase-2 MEP routing grid — box
 *   geometry carries no holes yet).
 *
 * GEOMETRY STRATEGY (v1, per the plan): box-envelope members with
 * PROFILE-TRUTH LABELS — every member renders as a box at its profile's
 * true envelope (web × flange, from the cited catalog) and labels its AISI
 * designator ('350S162-68 (Gr 50)'). The C-shape render is a later
 * refinement of the same members. Wall thickness stays byte-stable by
 * construction: the lumber→web mapping in lgs-profiles.ts is
 * dressed-depth-matched (2x4 ≡ 350 web, 2x6 ≡ 550), and `fitAcross`
 * compresses exactly like lumber on thin walls. Studs SEAT INSIDE the
 * tracks (ends against the track web, between its flanges) — as boxes that
 * nesting is a design-intent contact, allow-listed in the SAT gates the
 * way anchor bolts × plates are.
 *
 * HONESTY CHANNELS (mission-critical — the R603.3.2 mil-selection TABLE
 * CELLS are NOT verified, only the table structure and limits):
 *  - mil selection at 300+ takes the CONSERVATIVE choice — the thickest
 *    catalog variant inside the tables' 33–68 mil domain — and STATES THE
 *    BASIS on every stud label + one level warning; nothing ever cites a
 *    table cell nobody checked. LOD 200 keeps the generic 33-mil member
 *    (no code claims at 200, the repo convention).
 *  - track thickness ≥ stud thickness (R603.3.2 verbatim) holds by
 *    construction: both resolve at the same minimum mils.
 *  - R603.6 header and R603.7 jack/king TABLES are unverified too: the
 *    header carries a verify flag, the jack/king count states 'minimum
 *    shown'.
 *  - applicability (R603.1.1: ≤ 3 stories, Vult < 140 B/C, ground snow
 *    ≤ 70 psf, stud length ≤ 10 ft between supports): outside any limit →
 *    loud level warning + 'engineered design required' flag on the wall's
 *    members, never silent.
 *  - machine resolution (spec.lgsMachine → profileFor): the resolution
 *    STATUS rides every member label (verified machines brand the label,
 *    anything else carries the honest fallback string), and — Phase 2 —
 *    every fallback resolution raises a per-level warning
 *    (`machineConstraintWarning`): a VERIFIED machine that can't roll the
 *    resolved profile earns the "cannot roll" claim (its published ranges
 *    are the rollable derivation's basis); an unverified or unknown
 *    machine never does — nothing was checked, so the warning states THAT
 *    instead. Machine scope (LGS-PLAN principle 4: a machine choice only
 *    CONSTRAINS + BRANDS — Phase 2 adds WARNS): at 300+ the conservative
 *    pick already sits at the table-domain maximum, so members are
 *    byte-identical with or without a machine (labels/flags/warnings
 *    only — round-1 byte-proved across the catalog); at 200 a machine
 *    NARROWS the generic 33-mil pick to its thinnest rollable variant
 *    (550S162-33 → -43 under TF550H: designator + flag text, identical
 *    envelope), and the vendor-own-profile path draws the vendor's
 *    verified dims (Howick 89 mm web vs 88.9 generic). Both are Phase-1
 *    resolution behaviors, unwidened this phase.
 *
 * Cross-material junctions: compute passes ONE hint graph over lumber +
 * steel walls (frameHints) — corners/tees resolve through the same
 * through/butt conventions; cap-plate laps never cross a mixed-material
 * corner (suppressed in frameHints — wood caps don't lap steel track, and
 * steel has no cap).
 */

import type { FramingSpec } from '../core/spec'
import type { Member, MemberRole, WallSlice } from '../core/types'
import { formatFtIn, inches } from '../core/units'
import {
  DEFAULT_STRUCTURAL_MILS,
  familyStemFor,
  familyVariants,
  LGS,
  type LgsProfileResolution,
  machineFor,
  parseDesignator,
  profileFor,
} from './lgs-profiles'
import { mixedWallInsets } from './cmu'
import {
  detectTees,
  fitAcross,
  frameHints,
  type FrameHints,
  frameOf,
  specForWall,
  studPositions,
  studSizeFor,
  type WallFramingOverride,
} from './wall-framing'

const EPS = 1e-6

// ---------------------------------------------------------------------------
// Catalog-derived envelope constants (dims are never hardcoded — they come
// from the cited rows in data/lgs-profiles.json)
// ---------------------------------------------------------------------------

/** S162 stud flange — the member's along-wall envelope thickness (1-5/8"). */
export const LGS_STUD_THICKNESS = (LGS.genericFamilies['350S162-33']?.flangeMm ?? 41.3) / 1000
/** T125 track flange — the track's envelope height on the floor/ceiling (1-1/4"). */
export const LGS_TRACK_FLANGE = (LGS.genericFamilies['350T125-33']?.flangeMm ?? 31.8) / 1000
/** R603.3.3 strap bracing: 1-1/2" wide, 33 mil — thickness is the 33-mil
 * DESIGN thickness from the catalog's thickness rows (0.879 mm), well under
 * the 2 mm SAT skin (the B9/B10 surface-steel convention). */
export const LGS_STRAP_WIDTH = inches(1.5)
export const LGS_STRAP_THICKNESS =
  (LGS.genericFamilies['350S162-33']?.designThicknessMm ?? 0.879) / 1000
/** Jack studs per opening side — Table R603.7(1) cells are NOT verified, so
 * v1 models the structural MINIMUM and says so on the label (never an
 * invented count). Exported so the layer engine's batts keep the identical
 * opening keep-outs. */
export const LGS_JACKS_PER_SIDE = 1

/** The R603.3.2 stud-selection tables run 33–68 mil (verified STRUCTURE —
 * the research notes; individual cells unverified). The conservative pick
 * below never leaves this domain. */
export const LGS_WALL_TABLE_MAX_MILS = 68

/** The exact stated-basis clause every conservatively-sized member carries. */
export const LGS_CONSERVATIVE_BASIS = 'conservative: R603.3.2 table cell unverified'

/**
 * The o.c. spacings IRC R603.3.2 tabulates for cold-formed steel wall studs:
 * 16" and 24" (verified STRUCTURE from the research notes — the individual
 * table CELLS are not encoded, see LGS_CONSERVATIVE_BASIS). The lumber path
 * also offers the Table R602.3(5) 12" column; steel has no 12" column, so a
 * 12" steel wall still FRAMES at 12" (tighter is not less stud) but says out
 * loud that R603.3.2 does not tabulate it.
 */
export const LGS_TABLE_SPACINGS_IN = [16, 24] as const

/** Stud-to-track fastening, straight out of the cited catalog row
 * (data/lgs-profiles.json → fastenerBasis.studToTrack: IRC Table
 * R603.3.2(1) fastening schedule, ASTM C1513 self-drilling screws;
 * steel-to-steel edge/spacing minimums per IRC R603.2.5). Printed as the
 * track members' advisory at LOD 400 (fabrication) — the connection is a
 * fabrication fact, not geometry, and it is never invented here. */
export const LGS_STUD_TO_TRACK_NOTE =
  `${LGS.fastenerBasis.studToTrack?.description ?? ''} ${LGS.fastenerBasis.steelToSteel?.description ?? ''}`.trim()

/**
 * Conservative wall-member mils for a family stem: the THICKEST catalog
 * variant inside the R603.3.2 tables' 33–68 mil domain. With no verified
 * table cells this is the only pick that can never under-spec whatever the
 * unverified cell would demand (within the R603.1.1 applicability limits,
 * which are warned separately). The basis is stated wherever it is used.
 */
export function conservativeWallMils(stem: string): number {
  let max = DEFAULT_STRUCTURAL_MILS
  for (const d of familyVariants(stem)) {
    const mils = parseDesignator(d)?.mils ?? 0
    if (mils > max && mils <= LGS_WALL_TABLE_MAX_MILS) max = mils
  }
  return max
}

// ---------------------------------------------------------------------------
// Per-wall profile resolution — the ONE truth the engine AND the wall card
// read (panel-selection.ts), so the printed recipe is what's built.
// ---------------------------------------------------------------------------

export type LgsWallProfiles = {
  /** Stud resolution (kings/jacks/cripples/headers share the family). */
  stud: LgsProfileResolution
  /** Track resolution (bottom/top/sill) — same minimum mils as the studs
   * (R603.3.2 verbatim rule). */
  track: LgsProfileResolution
  /** Bridging-channel resolution (partition backing, 150U050) at the
   * structural floor — the channel is the only catalog variant, never an
   * R603.3.2 table selection. Members of this class compose only where
   * the wall carries backing tees, so the CARD counts its fallback only
   * when backing members are actually drawn on the wall (round-1 skeptic
   * F2); the engine consumes this same resolution for the members and
   * the can't-roll warning. */
  backing: LgsProfileResolution
  /** The mils the stud/track resolutions were asked for + the stated
   * basis (null at LOD 200 — generic members make no code claims). */
  minMils: number
  basis: string | null
}

/** Resolve one wall's stud + track + bridging profiles under a spec (+
 * per-wall engineering override). The wall's lumber-equivalent size
 * (thickness heuristic or explicit studSize override) picks the
 * depth-matched web so wall thickness stays byte-stable. */
export function lgsWallProfiles(
  wall: WallSlice,
  spec: FramingSpec,
  override?: WallFramingOverride,
): LgsWallProfiles {
  const wallSpec = specForWall(spec, override)
  const size = studSizeFor(wall, wallSpec)
  // Pin BOTH spec sizes to the wall's resolved size so familyStemFor's
  // interior/exterior split can't disagree with the thickness heuristic.
  const lgsSpec: FramingSpec =
    wallSpec.interiorStudSize === size && wallSpec.exteriorStudSize === size
      ? wallSpec
      : { ...wallSpec, interiorStudSize: size, exteriorStudSize: size }
  const stem = familyStemFor('stud', lgsSpec) ?? '350S162'
  const generic = spec.detail === '200'
  const minMils = generic ? DEFAULT_STRUCTURAL_MILS : conservativeWallMils(stem)
  return {
    stud: profileFor('stud', lgsSpec, { minMils }),
    track: profileFor('bottom-plate', lgsSpec, { minMils }),
    // structural-floor mils (the engine's historical call — '150U050' is
    // size-independent, so lgsSpec vs wallSpec cannot differ here)
    backing: profileFor('backing', lgsSpec),
    minMils,
    basis: generic ? null : LGS_CONSERVATIVE_BASIS,
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export type LgsFrameWallsOptions = {
  /** Superset of walls the corner/tee hint graph is computed over (compute
   * passes lumber + steel so junctions compose across materials). */
  hintWalls?: WallSlice[]
  /** Walls bear on a concrete slab (ground level) — labels say so; steel
   * needs no PT swap (R317.1 governs WOOD in concrete contact). */
  slabBearing?: boolean
  /** R603.1.1 applicability inputs — absent means unknown (not checked;
   * compute always passes them). */
  groundSnowLoadPsf?: number
  ultimateWindMph?: number
  storeys?: number
  /** CMU walls on the level (full-CMU + mixed) — the shared lumber+steel
   * hint graph is blind to masonry (the documented S1 tee class), and the
   * NEW strap-bracing role must not join it: strap runs TRIM clear of CMU
   * through-wall bodies (round-1 F4d). The stud/track run keeps lumber-
   * twin symmetry with the documented class. */
  cmuNeighbors?: WallSlice[]
}

export type LgsFrameResult = { members: Member[]; warnings: string[] }

/** R603.1.1 stud-length limit: 10 ft between horizontal supports. */
const LGS_MAX_STUD_LENGTH = inches(120)
/** R603.1.1 wind limit: Vult < 140 mph Exposure B/C. */
const LGS_MAX_WIND_MPH = 140
/** R603.1.1 ground snow limit: ≤ 70 psf. */
const LGS_MAX_SNOW_PSF = 70
/** R603.1.1 storey limit: ≤ 3 stories above grade. */
const LGS_MAX_STOREYS = 3
/** R603.3.3 strap-row rule: mid-height at ≤ 8 ft, third points at 9/10 ft. */
const LGS_MID_HEIGHT_MAX = inches(96) + 0.01

/** S240 A5.9 factory punchout metadata for a member of cut length L (m):
 * centers ≥ 12" from each end, ≥ 24" c-c, width ≤ min(depth/2, 2.5"),
 * length 4.5". Returns undefined when nothing fits. */
export function factoryPunchouts(
  lengthM: number,
  webIn: number,
): Member['punchouts'] | undefined {
  const p = LGS.punchPatterns['s240-factory-punchout']
  if (!p) return undefined
  const spacingIn = p.minCenterSpacingIn ?? 24
  const endIn = p.minEndDistanceIn ?? 12
  const lengthIn = lengthM / 0.0254
  const span = lengthIn - 2 * endIn
  if (span < 0) return undefined
  const count = Math.floor(span / spacingIn) + 1
  return {
    pattern: 's240-factory-punchout',
    widthIn: Math.min(webIn / 2, p.holeWidthIn ?? 2.5),
    lengthIn: p.holeLengthIn ?? 4.5,
    spacingIn,
    endDistanceIn: endIn,
    count,
  }
}

/** The union arm that actually carries dims — profileFor's union
 * discriminant ('engineered design required') overlaps the open-ended
 * status string, so a user-defined guard does the narrowing. */
export type LgsResolvedProfile = Extract<LgsProfileResolution, { designator: string }>

export function isResolvedProfile(res: LgsProfileResolution): res is LgsResolvedProfile {
  return 'designator' in res && res.status !== 'engineered design required'
}

/** Grade string from a resolution's backing family (verified rule: Gr 33
 * for 33/43 mil, Gr 50 for 54/68 — AISI S230 A4.4, encoded per row). */
function gradeOf(res: LgsResolvedProfile): string {
  return `Gr ${res.family.yieldKsi}`
}

/** Designator + grade + machine/fallback status — the label head every
 * steel member starts with ('350S162-68 (Gr 50)', '…— unverified — generic
 * AISI fallback'). VENDOR profile picks (machineProfile set) are the
 * machine's OWN geometry: the row carries no grade — the nearest-generic
 * family's yieldKsi is NOT inherited onto it (round-1 F5b) — so the head
 * states 'grade per vendor spec', the vendor row's rollable mils, and the
 * dims-delta note (Howick 10 mm lip vs AISI 12.7 mm) verbatim. */
export function lgsLabelHead(res: LgsResolvedProfile): string {
  if (res.machineProfile) {
    const mils = res.machineProfile.rollableMils?.join('/')
    const delta = res.machineProfile.note ?? res.note
    return (
      `${res.designator} (${mils ? `${mils} mil, ` : ''}grade per vendor spec)` +
      (res.machine ? ` (${res.machine})` : '') +
      (delta ? ` — ${delta}` : '')
    )
  }
  const head = `${res.designator} (${gradeOf(res)})`
  if (res.machine && res.status === 'verified') return `${head} (${res.machine})`
  if (res.status !== 'verified') return `${head} — ${res.status}`
  return head
}

/**
 * The per-level machine-constraint warning for one FALLBACK resolution
 * (Phase 2 — the can't-roll honesty payload; P4 prints it verbatim on
 * paper). Three honest shapes, never conflated:
 *  - VERIFIED machine that can't roll the resolved profile → the "cannot
 *    roll" claim (its published web/flange/coil ranges are the basis of
 *    the rollable derivation — the exhibit: TF550H rolls the S162 studs
 *    but its 34–63 mm flange range excludes T125 track);
 *  - UNVERIFIED machine → "is unverified" — nothing was checked, so the
 *    warning never claims incapability (an unchecked machine can claim
 *    NO rollable rows, but also earns no can't-roll verdicts);
 *  - unknown key → "not found in the catalog".
 * Null when there is nothing to warn about (no machine requested, or the
 * machine rolls the pick). `roleWord` names the member class the
 * resolution feeds ('studs' | 'tracks' | 'bridging channels').
 */
export function machineConstraintWarning(
  res: LgsProfileResolution,
  roleWord: string,
): string | null {
  if (!('designator' in res)) return null
  if (res.machine === undefined || res.status === 'verified') return null
  const machine = machineFor(res.machine)
  if (!machine) {
    return (
      `Machine '${res.machine}' not found in the catalog — ` +
      `generic AISI profiles used for all steel members; check the machine key`
    )
  }
  if (machine.status !== 'verified') {
    return (
      `Machine ${machine.name} is unverified — generic AISI dims used for ` +
      `every steel profile; verify capability with the vendor`
    )
  }
  return (
    `Machine ${machine.name} cannot roll ${res.designator} (${roleWord}) — ` +
    `generic AISI fallback used; verify with vendor`
  )
}

/**
 * Frame a set of LGS walls. Returns members + per-level honesty warnings
 * (deduped). Curved walls are skipped upstream like lumber.
 */
export function lgsFrameWalls(
  walls: WallSlice[],
  spec: FramingSpec,
  overrides?: ReadonlyMap<string, WallFramingOverride>,
  opts?: LgsFrameWallsOptions,
): LgsFrameResult {
  const members: Member[] = []
  const warnings = new Set<string>()
  if (walls.length === 0) return { members, warnings: [] }
  const hints = frameHints(opts?.hintWalls ?? walls, spec, overrides)
  const codeClaims = spec.detail !== '200'

  // ---- R603.1.1 applicability (level-scoped limits) ----
  let specLimitFlag: string | undefined
  if (codeClaims) {
    const reasons: string[] = []
    if (opts?.ultimateWindMph !== undefined && opts.ultimateWindMph >= LGS_MAX_WIND_MPH) {
      reasons.push(`ultimate wind ${opts.ultimateWindMph} mph ≥ ${LGS_MAX_WIND_MPH} (Vult < 140 B/C)`)
    }
    if (opts?.groundSnowLoadPsf !== undefined && opts.groundSnowLoadPsf > LGS_MAX_SNOW_PSF) {
      reasons.push(`ground snow ${opts.groundSnowLoadPsf} psf > ${LGS_MAX_SNOW_PSF}`)
    }
    if (opts?.storeys !== undefined && opts.storeys > LGS_MAX_STOREYS) {
      reasons.push(`${opts.storeys} stories > ${LGS_MAX_STOREYS}`)
    }
    if (reasons.length > 0) {
      specLimitFlag =
        `outside IRC R603.1.1 applicability (${reasons.join('; ')}) — ` +
        `engineered design required (AISI S240/S230)`
      warnings.add(`LGS walls: ${specLimitFlag}`)
    }
    warnings.add(
      `LGS mil selection: R603.3.2 table cells not encoded — studs/track sized ` +
        `conservatively at the table-domain maximum; verify against Tables ` +
        `R603.3.2(2)–(16) for building width/height/snow/wind`,
    )
    warnings.add(
      `LGS wall bracing (R603.9 structural sheathing) not evaluated — the R603.3.3 ` +
        `strap rows are stud stability bracing, not shear bracing; verify braced wall design`,
    )
    // Energy-code honesty (round-1 F2): every cavity R this plugin prints
    // (card, characteristics, UA/Manual-J inputs) is the WOOD-frame
    // prescriptive figure — steel-frame walls have their OWN IECC
    // requirement and thermal-bridging story, and nothing evaluates it.
    warnings.add(
      `LGS energy code: cavity R-values shown are wood-frame prescriptive figures — ` +
        `steel-frame walls require 2021 IECC R402.2.6 / IRC N1102.2.6 compliance ` +
        `(cavity + continuous insulation, or U-factor path) — not evaluated`,
    )
    if (spec.highWindUplift && walls.some((w) => w.exterior)) {
      warnings.add(
        `high-wind uplift connectors (R802.11/WFCM continuation) are modeled for lumber ` +
          `walls only — LGS wall uplift strapping not modeled; verify strapping schedule`,
      )
    }
  }

  for (const wall of walls) {
    if (wall.curved) continue
    frameLgsWall(wall, spec, overrides?.get(wall.id), hints.get(wall.id) ?? {}, {
      members,
      warnings,
      codeClaims,
      specLimitFlag,
      slabBearing: opts?.slabBearing === true,
      cmuNeighbors: opts?.cmuNeighbors ?? [],
    })
  }
  return { members, warnings: [...warnings] }
}

type EmitContext = {
  members: Member[]
  warnings: Set<string>
  codeClaims: boolean
  specLimitFlag: string | undefined
  slabBearing: boolean
  cmuNeighbors: WallSlice[]
}

function frameLgsWall(
  wall: WallSlice,
  spec: FramingSpec,
  override: WallFramingOverride | undefined,
  hints: FrameHints,
  ctx: EmitContext,
): void {
  const { members, warnings, codeClaims, specLimitFlag } = ctx
  const profiles = lgsWallProfiles(wall, spec, override)
  const { stud: studRes, track: trackRes } = profiles
  if (!isResolvedProfile(studRes) || !isResolvedProfile(trackRes)) {
    // No catalog row → no invented dims, no members: loud and empty.
    warnings.add(
      `Wall ${wall.id}: no prescriptive LGS member class resolves — engineered design required; wall not framed`,
    )
    return
  }
  const studFam = studRes.family
  const trackFam = trackRes.family
  const { yaw, place } = frameOf(wall)
  const wallSpec = specForWall(spec, override)
  const spacing = wallSpec.studSpacing

  // Envelope dims — the machine's OWN profile geometry when the resolution
  // is a vendor designator (its dims ARE the verified truth then).
  const webM = (studRes.machineProfile?.webMm ?? studFam.webMm) / 1000
  const tS = (studRes.machineProfile?.flangeMm ?? studFam.flangeMm) / 1000
  const halfT = tS / 2
  const trackFlange = trackFam.flangeMm / 1000
  const trackWeb = trackFam.designThicknessMm / 1000
  const wFit = fitAcross(webM, wall)
  const H = wall.height
  const len = wall.length

  const compressionFlag =
    wFit < webM
      ? `${studRes.designator} framing compressed to ${(wFit / 0.0254).toFixed(2)}" — ` +
        `${wall.thickness.toFixed(3)}m drawn wall holds ${(wFit / 0.0254).toFixed(2)}" + finishes; ` +
        `deepen to ${(webM + inches(1)).toFixed(3)}m for the full ${studRes.designator} web`
      : undefined

  // R603.1.1 stud-length limit — per wall, composed onto the spec-level flag.
  const tooTall = codeClaims && H > LGS_MAX_STUD_LENGTH + 0.002
  if (tooTall) {
    warnings.add(
      `Wall ${wall.id}: ${formatFtIn(H)} stud length exceeds the R603.1.1 10 ft limit ` +
        `between horizontal supports — engineered design required (AISI S240/S230)`,
    )
  }
  // R603.3.2 spacing domain: the steel wall tables run at 16" and 24" o.c.
  // only. The config's 12" option is a Table R602.3(5) (WOOD) column — a
  // steel wall built at 12" is framed as drawn and flagged, never silently
  // presented as an R603.3.2 selection.
  const wallSpacingIn = Math.round(spacing / 0.0254)
  const offTableSpacing =
    codeClaims && !LGS_TABLE_SPACINGS_IN.includes(wallSpacingIn as 16 | 24)
      ? `${wallSpacingIn}" o.c. is not an R603.3.2 tabulated steel stud spacing ` +
        `(the tables run at ${LGS_TABLE_SPACINGS_IN.map((n) => `${n}"`).join(' and ')}) — ` +
        `spacing drawn as configured; verify by engineered design (AISI S240/S230)`
      : undefined
  if (offTableSpacing !== undefined) warnings.add(`Wall ${wall.id}: ${offTableSpacing}`)
  const wallFlagParts = [
    tooTall ? 'outside R603.1.1: stud length > 10 ft — engineered design required' : undefined,
    offTableSpacing,
    specLimitFlag,
    compressionFlag,
  ].filter((f): f is string => f !== undefined)
  const wallFlag = wallFlagParts.length > 0 ? wallFlagParts.join(' | ') : undefined

  // F1 (round 1 skeptic): the conservative-mils caveat rides EVERY member
  // whose thickness came from the unverified-cell pick — kings, jacks,
  // cripples, headers, tracks and corner-backing studs included, not just
  // the o.c. studs. The tracks' '(R603.3.2)' thickness-matches-studs cite
  // stays (that rule IS verbatim-verified); the caveat rides alongside.
  const basisSuffix = profiles.basis ? ` — ${profiles.basis}` : ''
  const studHead = lgsLabelHead(studRes)
  const trackHead = lgsLabelHead(trackRes)

  const emit = (
    role: MemberRole,
    profile: string,
    dims: [number, number, number],
    centerU: number,
    centerY: number,
    length: number,
    label: string,
    flag?: string,
    extra?: Partial<Member>,
  ): void => {
    members.push({
      system: 'wall-framing',
      role,
      dims,
      length,
      position: place(centerU, centerY),
      rotation: [0, yaw, 0],
      material: 'steel',
      sourceId: wall.id,
      profile,
      label,
      flag: flag !== undefined && wallFlag !== undefined ? `${flag} | ${wallFlag}` : (flag ?? wallFlag),
      ...extra,
    })
  }

  // Trimmed framing run (shared through/butt convention with lumber).
  const u0 = Math.max(0, hints.startInset ?? 0)
  const u1 = Math.max(u0 + 4 * tS, len - Math.max(0, hints.endInset ?? 0))
  const runLen = u1 - u0
  const runMid = (u0 + u1) / 2

  // ---- tracks (R603.3.1 structure; thickness rule R603.3.2 verbatim) ----
  const trackNote = codeClaims
    ? ` — R603.3.1; track thickness matches studs (R603.3.2)`
    : ''
  const slabNote = ctx.slabBearing ? ' — on slab (anchorage per foundation schedule)' : ''
  const trackDims: [number, number, number] = [runLen, trackFlange, wFit]
  // At LOD 400 (fabrication) the tracks carry the stud-to-track connection
  // as an advisory — the cited fastening schedule, not modeled geometry.
  const trackAdvisory: Partial<Member> =
    spec.detail === '400' ? { advisory: LGS_STUD_TO_TRACK_NOTE } : {}
  emit(
    'bottom-plate',
    trackRes.designator,
    trackDims,
    runMid,
    trackFlange / 2,
    runLen,
    `Bottom track ${trackHead}${trackNote}${basisSuffix}${slabNote}`,
    undefined,
    trackAdvisory,
  )
  emit(
    'top-plate',
    trackRes.designator,
    trackDims,
    runMid,
    H - trackFlange / 2,
    runLen,
    `Top track ${trackHead}${trackNote}${basisSuffix}`,
    undefined,
    trackAdvisory,
  )
  // Phase 2 — machine can't-roll honesty (LOD 300+ like every LGS warning;
  // 200 makes no claims). Emitted per composed member CLASS so the level
  // warning is exactly as wide as what's actually drawn/booked.
  if (codeClaims) {
    const trackWarning = machineConstraintWarning(trackRes, 'tracks')
    if (trackWarning !== null) warnings.add(trackWarning)
  }

  // Studs seat INSIDE the tracks: ends against the track webs. The box
  // nesting (stud inside the track flange band) is a design-intent contact
  // — allow-listed in the SAT gates like anchor-bolt × plate.
  const studBottom = trackWeb
  const studTop = H - trackWeb
  const studHeight = studTop - studBottom
  if (studHeight <= tS) return // degenerate pony wall — tracks only

  // Stud-family members (studs/kings/jacks/cripples/headers) all emit from
  // here down — the stud resolution's can't-roll status warns once.
  if (codeClaims) {
    const studWarning = machineConstraintWarning(studRes, 'studs')
    if (studWarning !== null) warnings.add(studWarning)
  }

  const studDims: [number, number, number] = [tS, studHeight, wFit]
  const spacingIn = Math.round(spacing / 0.0254)
  const punch = (length: number): Partial<Member> => {
    if (spec.detail !== '400') return {}
    const p = factoryPunchouts(length, studRes.machineProfile?.webMm !== undefined
      ? (studRes.machineProfile.webMm / 25.4)
      : studFam.webIn)
    return p && p.count > 0 ? { punchouts: p } : {}
  }

  // Derived from profiles.basis (never a parallel hardcoded clause) so a
  // basis mutation kills every consumer at once.
  const studLabel = profiles.basis
    ? `Stud ${studHead} @ ${spacingIn}" o.c. — IRC R603.3.2 (${profiles.basis})`
    : `Stud ${studHead} @ ${spacingIn}" o.c.`

  // ---- opening frames (R603.6/R603.7/R603.8 STRUCTURE) ----
  type KeepOut = { min: number; max: number }
  const keepOuts: KeepOut[] = []
  const frameSide = LGS_JACKS_PER_SIDE * tS
  const r603_7Note = codeClaims
    ? ' — R603.7 (count per Table R603.7(1) not verified — minimum shown, verify)'
    : ''

  for (const opening of wall.openings) {
    const ro = Math.min(opening.roughWidth, runLen - 4 * tS)
    if (ro <= 0) continue
    const u = Math.min(
      Math.max(opening.u, u0 + ro / 2 + frameSide + tS),
      u1 - ro / 2 - frameSide - tS,
    )
    const roClampFlag =
      Math.abs(u - opening.u) > 0.005
        ? `RO shifted ${((u - opening.u) * 100).toFixed(1)}cm to fit the framed run — verify the drawn position`
        : undefined
    const [roBottom, roTopRaw] =
      opening.kind === 'door'
        ? [0, opening.roughHeight]
        : [opening.sillHeight, opening.sillHeight + opening.roughHeight]
    const roTop = Math.min(roTopRaw, studTop - trackWeb - 0.001)

    // Header: 2 equal C-sections as a box assembly (R603.6 STRUCTURE — the
    // span-capacity tables are NOT encoded, so every steel header carries
    // the verify flag; values are never invented). Envelope: the C web
    // vertical, two flange widths across.
    const headerLength = ro + 2 * frameSide
    const headerDepth = Math.min(webM, studTop - roTop)
    const headerFlagParts = [
      codeClaims
        ? 'header span capacity not verified against Table R603.6 (cells not encoded) — verify or engineered design'
        : undefined,
      headerDepth < webM - 0.005
        ? `header web collapsed to ${(headerDepth / 0.0254).toFixed(1)}" of ${(webM / 0.0254).toFixed(1)}" between the RO and the top track — verify detail`
        : undefined,
      roClampFlag,
    ].filter((f): f is string => f !== undefined)
    emit(
      'header',
      studRes.designator,
      [headerLength, headerDepth, Math.min(2 * tS, wFit)],
      u,
      roTop + headerDepth / 2,
      headerLength,
      `Header 2× ${studHead} box${codeClaims ? ' (R603.6)' : ''} over ${opening.kind}${basisSuffix}`,
      headerFlagParts.length > 0 ? headerFlagParts.join(' | ') : undefined,
    )

    // Jack studs (header bearing) + king studs, R603.7 structure.
    const jackHeight = roTop - studBottom
    for (const side of [-1, 1] as const) {
      for (let k = 0; k < LGS_JACKS_PER_SIDE; k++) {
        emit(
          'trimmer',
          studRes.designator,
          [tS, jackHeight, wFit],
          u + side * (ro / 2 + halfT + k * tS),
          studBottom + jackHeight / 2,
          jackHeight,
          `Jack stud ${studHead}${r603_7Note}${basisSuffix}`,
          undefined,
          punch(jackHeight),
        )
      }
      emit(
        'king-stud',
        studRes.designator,
        studDims,
        u + side * (ro / 2 + frameSide + halfT),
        studBottom + studHeight / 2,
        studHeight,
        `King stud ${studHead}${r603_7Note}${basisSuffix}`,
        undefined,
        punch(studHeight),
      )
    }

    // Cripples above the header, continuing the o.c. rhythm.
    const crippleTopHeight = studTop - (roTop + headerDepth)
    if (crippleTopHeight > tS) {
      for (const su of studPositions(runLen, spacing, halfT)) {
        const cu = su + u0
        if (Math.abs(cu - u) < ro / 2 - halfT) {
          emit(
            'cripple',
            studRes.designator,
            [tS, crippleTopHeight, wFit],
            cu,
            roTop + headerDepth + crippleTopHeight / 2,
            crippleTopHeight,
            `Cripple ${studHead}${basisSuffix}`,
          )
        }
      }
    }

    // Windows: SILL TRACK (R603.8) + cripples below it.
    if (opening.kind === 'window' && roBottom > studBottom + trackFlange) {
      emit(
        'sill',
        trackRes.designator,
        [ro, trackFlange, wFit],
        u,
        roBottom - trackFlange / 2,
        ro,
        `Sill track ${trackHead}${codeClaims ? ' — R603.8' : ''}${basisSuffix}`,
      )
      const crippleBottomHeight = roBottom - trackFlange - studBottom
      if (crippleBottomHeight > tS) {
        const cus = new Set<number>()
        for (const su of studPositions(runLen, spacing, halfT)) {
          if (Math.abs(su + u0 - u) < ro / 2 - halfT) cus.add(su + u0)
        }
        cus.add(u - ro / 2 + halfT)
        cus.add(u + ro / 2 - halfT)
        for (const cu of cus) {
          emit(
            'cripple',
            studRes.designator,
            [tS, crippleBottomHeight, wFit],
            cu,
            studBottom + crippleBottomHeight / 2,
            crippleBottomHeight,
            `Cripple ${studHead}${basisSuffix}`,
          )
        }
      }
    }

    // King outer face + half a stud — a grid stud is dropped when its BODY
    // would overlap the king, not just when its center lands inside the
    // opening frame (mirrors the lumber engine's keep-out rule).
    keepOuts.push({
      min: u - ro / 2 - frameSide - tS - halfT + EPS,
      max: u + ro / 2 + frameSide + tS + halfT - EPS,
    })
  }

  // ---- common studs at o.c. spacing (ends always get a stud) ----
  const studUs = studPositions(runLen, spacing, halfT).map((su) => su + u0)
  for (const su of studUs) {
    if (keepOuts.some((k) => su > k.min && su < k.max)) continue
    emit(
      'stud',
      studRes.designator,
      studDims,
      su,
      studBottom + studHeight / 2,
      studHeight,
      studLabel,
      undefined,
      punch(studHeight),
    )
  }

  // ---- cross-wall extras (corner backing studs from the shared hints) ----
  for (const extra of hints.extraStuds ?? []) {
    const eu = Math.min(Math.max(extra.u, u0 + halfT), u1 - halfT)
    emit(
      'stud',
      studRes.designator,
      studDims,
      eu,
      studBottom + studHeight / 2,
      studHeight,
      `${extra.label} — ${studHead}${basisSuffix}`,
      undefined,
      punch(studHeight),
    )
  }

  // ---- partition backing at tees: CFS blocking (150U050 channel) ----
  // ONE resolver (round-1 skeptic F2): the members, the can't-roll warning
  // AND the card's fallback count all read profiles.backing.
  const backingRes = profiles.backing
  if (isResolvedProfile(backingRes) && (hints.backing?.length ?? 0) > 0) {
    const bFam = backingRes.family
    const bWeb = bFam.webMm / 1000
    const bFlange = (bFam.flangeMm ?? bFam.webMm / 3) / 1000
    const backingMark = members.length // warn only if a member really emits
    for (const tee of hints.backing ?? []) {
      const uu = Math.min(Math.max(tee.u, u0 + tS), u1 - tS)
      const left = Math.max(u0 + halfT, ...studUs.filter((su) => su < uu - EPS))
      const right = Math.min(u1 - halfT, ...studUs.filter((su) => su > uu + EPS))
      const blockLen = right - left - tS
      if (blockLen < inches(3)) continue
      const bu = (left + right) / 2
      for (const y of tee.heights) {
        if (y > studTop - tS) continue
        emit(
          'backing',
          backingRes.designator,
          [blockLen, bWeb, bFlange],
          bu,
          y,
          blockLen,
          `Partition backing ${lgsLabelHead(backingRes)} — CFS blocking${codeClaims ? ' (bridging channel: only catalog variant — not an R603.3.2 stud-table selection)' : ''}`,
        )
      }
    }
    if (codeClaims && members.length > backingMark) {
      const backingWarning = machineConstraintWarning(backingRes, 'bridging channels')
      if (backingWarning !== null) warnings.add(backingWarning)
    }
  }

  // ---- strap bracing rows (R603.3.3) — code-sized content, 300+ ----
  // 1-1/2" × 33 mil horizontal flat strap across the stud flanges: ONE row
  // at mid-height on walls ≤ 8 ft, rows at the THIRD POINTS on 9/10 ft
  // (the verified rule structure). Both faces (studs are braced on both
  // flanges — stated as the layout assumption); end anchorage/blocking per
  // R603.3.3 is not modeled — the advisory says so. Walls past the 10 ft
  // R603.1.1 limit carry the engineered flag instead of extrapolated rows.
  if (codeClaims && !tooTall) {
    // Strap runs TRIM clear of masonry BOTH ways (round-1 F4d + round-2 A):
    // the shared lumber+steel hint graph never sees masonry (the documented
    // S1 'partition tees into full-CMU' class — the stud/track run keeps
    // lumber-twin symmetry with it), but the NEW role must not extend the
    // class — a flat steel strap boring into block cells is neither the
    // documented residual nor buildable. Two masonry geometries:
    //  - this wall ENDS on a CMU wall (corner, or this wall is the tee
    //    STEM): mixedWallInsets clamps the strap ends (round-1 F4d);
    //  - a CMU STEM tees INTO this wall (round-2 A — mixedWallInsets only
    //    claims stem-side tees, so the grouted stem crossed the strap
    //    plane mid-run): the strap SPLITS around each masonry stem's
    //    station band on this run.
    const cmuIns =
      ctx.cmuNeighbors.length > 0
        ? mixedWallInsets(wall, ctx.cmuNeighbors)
        : { startInset: 0, endInset: 0 }
    // The pure-length clamp is its OWN truth (round-2 B): u1's 4·tS
    // minimum-run re-extension can overrun a short stub's drawn length —
    // that clamp is geometry hygiene, never a masonry claim.
    const lenU1 = Math.min(u1, len)
    const lenClamped = lenU1 < u1 - EPS
    const strapU0 = Math.max(u0, cmuIns.startInset)
    const strapU1 = Math.min(lenU1, len - cmuIns.endInset)
    // Masonry stems teeing INTO this wall: block bodies cross the strap
    // plane over the stem's width-aware station band (the S5 oblique
    // convention, stem side). The straps live OFF the centerline — at
    // z = ±(wFit/2 + strap/2) — and an OBLIQUE stem's crossing of that
    // offset plane shifts along u by z·cotθ (round-3 F2: a 45° stem bored
    // a grouted cell 32 mm past the centerline band), so the band half-
    // width widens by |z|·cosθ/sinθ; both faces share the same |z|, so
    // one widened band covers both. Perpendicular stems (cosθ = 0) keep
    // the exact round-2 band — byte parity.
    const stemBands: { min: number; max: number }[] = []
    if (ctx.cmuNeighbors.length > 0) {
      const cmuIds = new Set(ctx.cmuNeighbors.map((n) => n.id))
      const strapZ = wFit / 2 + LGS_STRAP_THICKNESS / 2
      for (const tee of detectTees([wall, ...ctx.cmuNeighbors])) {
        if (tee.through.id !== wall.id || !cmuIds.has(tee.stem.id)) continue
        const sinT = Math.max(
          0.2,
          Math.abs(tee.stem.dir[0] * wall.dir[1] - tee.stem.dir[1] * wall.dir[0]),
        )
        const cosT = Math.abs(tee.stem.dir[0] * wall.dir[0] + tee.stem.dir[1] * wall.dir[1])
        const half = tee.stem.thickness / (2 * sinT) + (strapZ * cosT) / sinT
        stemBands.push({ min: tee.u - half, max: tee.u + half })
      }
    }
    let spans: { min: number; max: number }[] = [{ min: strapU0, max: strapU1 }]
    for (const band of stemBands) {
      const next: { min: number; max: number }[] = []
      for (const sp of spans) {
        if (band.max <= sp.min || band.min >= sp.max) {
          next.push(sp)
          continue
        }
        if (band.min > sp.min) next.push({ min: sp.min, max: band.min })
        if (band.max < sp.max) next.push({ min: band.max, max: sp.max })
      }
      spans = next
    }
    const droppedSpans = spans.filter((sp) => sp.max - sp.min <= inches(6))
    spans = spans.filter((sp) => sp.max - sp.min > inches(6))
    // NEVER a silent bracing deletion (round-3 F1, the S13 doctrine): a
    // remnant under 6" is unbuildable strap and drops — but the drop is a
    // real unbraced band the ADVISORY channel cannot carry (advisories
    // ride strap members; a whole-run drop leaves none). The engine
    // computed the drop, so it SAYS it — a per-wall LEVEL warning (P4
    // prints warnings on paper). CMU-conditioned: a pure-steel stub too
    // short for any strap is the pre-existing quiet class (byte parity —
    // no cmuNeighbors, no new warnings).
    if (ctx.cmuNeighbors.length > 0 && lenU1 - u0 > inches(6)) {
      if (spans.length === 0) {
        warnings.add(
          `Wall ${wall.id}: R603.3.3 strap bracing omitted — run(s) shorter than 6 in after ` +
            `CMU trims; verify bracing at the junction`,
        )
      } else {
        for (const sp of droppedSpans) {
          warnings.add(
            `Wall ${wall.id}: R603.3.3 strap bracing interrupted at CMU junction — ` +
              `${(sp.max - sp.min).toFixed(2)} m unbraced band at ${sp.min.toFixed(2)}–${sp.max.toFixed(2)} m ` +
              `along the run; verify bracing at the junction`,
          )
        }
      }
    }
    const cmuTrimmed =
      strapU0 > u0 + EPS ||
      strapU1 < lenU1 - EPS ||
      spans.length !== 1 ||
      (spans[0] !== undefined && (spans[0].max - spans[0].min < strapU1 - strapU0 - EPS))
    const rows = H <= LGS_MID_HEIGHT_MAX ? [H / 2] : [H / 3, (2 * H) / 3]
    const rowNote = rows.length === 1 ? 'mid-height' : 'third points'
    for (const sp of spans) {
      const spanLen = sp.max - sp.min
      for (const y of rows) {
        for (const side of [-1, 1] as const) {
          members.push({
            system: 'wall-framing',
            role: 'strap-bracing',
            dims: [spanLen, LGS_STRAP_WIDTH, LGS_STRAP_THICKNESS],
            length: spanLen,
            position: place((sp.min + sp.max) / 2, y, side * (wFit / 2 + LGS_STRAP_THICKNESS / 2)),
            rotation: [0, yaw, 0],
            material: 'steel',
            sourceId: wall.id,
            label: `Strap bracing 1-1/2" × 33 mil (R603.3.3) — ${rowNote}`,
            advisory:
              'R603.3.3 stud bracing v1 — flat strap on both flange faces (layout assumption); ' +
              'end anchorage + periodic blocking per R603.3.3 not modeled; verify detail' +
              (cmuTrimmed
                ? '; run trimmed clear of a CMU junction — verify strap anchorage at the junction'
                : '') +
              (lenClamped ? '; strap run clamped to the wall length' : ''),
            flag: wallFlag,
          })
        }
      }
    }
  }
}
