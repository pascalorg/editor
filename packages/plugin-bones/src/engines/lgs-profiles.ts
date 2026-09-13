/**
 * LGS (light-gauge / cold-formed steel) profile catalog — Phase 0 of the
 * LGS track (docs/plans/LGS-PLAN.md). Pure lookups over
 * data/lgs-profiles.json: AISI S240-designated generic member families
 * (350S162-33 …), roll-forming machine catalogs (FRAMECAD, Howick …) and
 * the honest resolution chain a Phase-1 engine will consume:
 *
 *   machine's rollable profile → generic AISI family → 'engineered design
 *   required'
 *
 * HONESTY RULE (the project convention, applied to vendor data): a machine
 * row is 'verified' ONLY when its numbers came from the vendor's published
 * spec sheet — the row carries the source URLs in the data. Anything not
 * publicly verifiable ships as status 'unverified — generic AISI fallback'
 * and resolves the GENERIC family dims (the always-verified base, IRC R603
 * / SFIA), with the status string surfacing on every resolution so no
 * member ever wears vendor dims nobody checked.
 *
 * NO engine consumes this yet — computeLevel/frameWall are byte-untouched
 * (the E5 master-baseline pin proves it). Phase 1 wires `profileFor` into
 * the wall engine behind `FramingSpec.framingSystem === 'lgs'`.
 */

import lgsData from '../../data/lgs-profiles.json'
import type { FramingSpec } from '../core/spec'
import type { MemberRole } from '../core/types'

// ---------------------------------------------------------------------------
// Data shapes (data/lgs-profiles.json)
// ---------------------------------------------------------------------------

/** One AISI-designated generic member family row (dims in mm + in). */
export type LgsFamily = {
  /** S = lipped C (stud/joist) · T = track · U = unlipped channel ·
   * F = furring · L = angle/L-header (SFIA legend; no L rows in the
   * catalog today — lookups fall back honestly). */
  section: 'S' | 'T' | 'U' | 'F' | 'L'
  webIn: number
  webMm: number
  flangeIn: number
  flangeMm: number
  /** Stiffening lip (S sections only) — absent on T/U/F. */
  lipIn?: number
  lipMm?: number
  /** Minimum base-metal thickness in mils (1/1000 in) — the '-33' suffix. */
  mils: number
  /** Traditional gauge the mil thickness corresponds to (reference only). */
  gaugeRef: number
  designThicknessIn: number
  designThicknessMm: number
  /** Minimum yield strength, ksi (33 or 50 per ASTM A1003). */
  yieldKsi: number
  sourceRefs: string[]
  note?: string
}

/** A machine's rollable family — one of two honest shapes:
 *  - `family` ref into genericFamilies (stem without the mil suffix, e.g.
 *    '350S162'): a DERIVED compatibility claim, labeled per-row via `basis`
 *    (family dims within the machine's published web/flange/thickness
 *    ranges — the data's meta.derivation documents the rule + tolerance).
 *  - `designator` row: the vendor's OWN profile geometry (verified dims +
 *    sources); `nearestGeneric` names the closest AISI family and `note`
 *    says how it differs (e.g. Howick's 10mm lip vs AISI 12.7mm). */
export type LgsRollableFamily = {
  family?: string
  basis?: string
  /** Vendor-specific profile (vendor's own geometry, not an AISI row). */
  designator?: string
  webMm?: number
  flangeMm?: number
  lipMm?: number
  rollableMils?: number[]
  nearestGeneric?: string
  sourceUrls?: string[]
  note?: string
}

export type LgsMachine = {
  name: string
  /** 'verified' rows carry sourceUrls; everything else is the fallback status. */
  status: 'verified' | string
  sourceUrls: string[]
  /** Coil/base-metal thickness range the machine rolls, mm. */
  thicknessRangeMm?: [number, number]
  webRangeMm?: [number, number]
  webOptionsMm?: number[]
  flangeRangeMm?: [number, number]
  flangeMm?: number
  lipMm?: number
  gaugeText?: string
  maxSpeed?: string
  profileShapes?: string[]
  /** Vendor-page self-contradictions, BOTH values verbatim with dates
   * (honesty rule: never pick a winner silently). */
  discrepancies?: {
    field: string
    values: { value: string; source: string; date: string }[]
    resolution?: string
  }[]
  rollableFamilies: LgsRollableFamily[]
  punchPattern?: string
  note?: string
}

export type LgsVendor = {
  name: string
  website: string
  machines: Record<string, LgsMachine>
}

export type LgsPunchPattern = {
  description: string
  holeWidthIn?: number
  holeLengthIn?: number
  minCenterSpacingIn?: number
  minEndDistanceIn?: number
  sourceRefs: string[]
}

type LgsData = {
  version: string
  disclaimer: string
  fallbackStatus: string
  genericFamilies: Record<string, LgsFamily>
  vendors: Record<string, LgsVendor>
  punchPatterns: Record<string, LgsPunchPattern>
  fastenerBasis: Record<
    string,
    { description: string; minScrewSize?: string; standard?: string; sourceRefs: string[] }
  >
  citations: Record<string, { url: string; verified: string; fetched: string }>
}

export const LGS = lgsData as unknown as LgsData

/** The exact status string an unverified vendor row (and its resolutions) carries. */
export const LGS_FALLBACK_STATUS = LGS.fallbackStatus

// ---------------------------------------------------------------------------
// Designator parsing + family lookup
// ---------------------------------------------------------------------------

/** Parsed AISI S240 designator: 350S162-33 → web 3.50", S section, 1.62"
 * flange, 33 mil. Web/flange encode 1/100 in; all five S240/SFIA letters
 * parse (S/T/U/F/L). Leading-zero THREE-digit tokens are real products
 * (SFIA prints 075U050-54 — web 3/4"; flange '050' = 1/2" on every U050
 * row), so they parse; a FOUR-digit web starting with 0 ('0350S162-33')
 * is a padded alias of a real designator that would MISS catalog lookups
 * silently — rejected (skeptic F5); zero-padded MILS ('350S162-033') are
 * the same alias class in the last field (real mils run 18-118, never
 * 0-leading) — also rejected (round 2). `null` when malformed. */
export function parseDesignator(
  designator: string,
): { webIn: number; section: 'S' | 'T' | 'U' | 'F' | 'L'; flangeIn: number; mils: number } | null {
  const m = /^(0\d{2}|[1-9]\d{2,3})([STUFL])(\d{3})-([1-9]\d{1,2})$/.exec(
    designator.trim().toUpperCase(),
  )
  if (!m) return null
  return {
    webIn: Number(m[1]) / 100,
    section: m[2] as 'S' | 'T' | 'U' | 'F' | 'L',
    flangeIn: Number(m[3]) / 100,
    mils: Number(m[4]),
  }
}

/** Generic family row for a full designator ('350S162-33'), or undefined. */
export function profileFamily(designator: string): LgsFamily | undefined {
  return LGS.genericFamilies[designator.trim().toUpperCase()]
}

/** Citation refs (keys of the data's citations block) → URLs. Unknown refs
 * pass through verbatim so a raw URL in a sourceRefs list still surfaces. */
export function citationUrls(refs: string[]): string[] {
  return refs.map((r) => LGS.citations[r]?.url ?? r)
}

/** All generic designators of one family stem ('350S162' → its mil variants),
 * thinnest first. */
export function familyVariants(stem: string): string[] {
  const prefix = `${stem.trim().toUpperCase()}-`
  return Object.keys(LGS.genericFamilies)
    .filter((d) => d.startsWith(prefix))
    .sort((a, b) => (parseDesignator(a)?.mils ?? 0) - (parseDesignator(b)?.mils ?? 0))
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

/** Machine row for a 'vendor/machine' key ('framecad/f325it'), or undefined. */
export function machineFor(key: string): LgsMachine | undefined {
  const [vendorKey, machineKey] = key.trim().toLowerCase().split('/')
  if (!vendorKey || !machineKey) return undefined
  return LGS.vendors[vendorKey]?.machines[machineKey]
}

/** Every machine key in the catalog, 'vendor/machine' form. */
export function machineKeys(): string[] {
  return Object.entries(LGS.vendors).flatMap(([v, vendor]) =>
    Object.keys(vendor.machines).map((m) => `${v}/${m}`),
  )
}

/**
 * The generic designators a machine can roll — each rollableFamilies entry
 * expanded through its family stem × rollableMils, kept only where the
 * catalog carries that exact generic row. UNVERIFIED machines return [] —
 * an unchecked capability claim must not constrain (or pretend to widen)
 * anything; resolution falls straight through to the generic base.
 */
export function rollableDesignators(machine: LgsMachine): string[] {
  if (machine.status !== 'verified') return []
  const out: string[] = []
  for (const rf of machine.rollableFamilies) {
    if (!rf.family) continue
    for (const d of familyVariants(rf.family)) {
      const mils = parseDesignator(d)?.mils
      if (rf.rollableMils && mils !== undefined && !rf.rollableMils.includes(mils)) continue
      out.push(d)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Role resolution — profileFor(role, spec)
// ---------------------------------------------------------------------------

/**
 * What a resolution returns. `status`:
 *  - 'verified'        — dims are a generic AISI row a VERIFIED machine rolls
 *                        (sources = machine spec sheet + generic refs), or the
 *                        generic base itself when no machine is selected.
 *  - the fallback string — a machine was requested but is unverified/unknown/
 *                        can't roll the family: generic dims substituted, the
 *                        status says so.
 *  - 'engineered design required' — the role has no prescriptive LGS member
 *                        class (girders, posts, ridges …); no dims are
 *                        invented for it.
 */
export type LgsProfileResolution =
  | {
      status: 'verified' | string
      designator: string
      /** The generic AISI row backing (or nearest to) the resolution. */
      family: LgsFamily
      /** The machine's OWN profile row when the pick is vendor geometry —
       * `designator` is then the vendor designator, `family` the
       * nearest-generic reference, and `note` says how the dims differ. */
      machineProfile?: LgsRollableFamily
      /** 'vendor/machine' when a machine constrained the pick. */
      machine?: string
      sources: string[]
      note?: string
    }
  | { status: 'engineered design required'; role: MemberRole; note: string }

/**
 * Member-role → LGS family-stem policy. Web depths mirror the lumber the
 * wall engine sizes today so Phase 1 keeps wall thicknesses byte-stable:
 * 2x4 ↔ 3-1/2" web (350), 2x6 ↔ 5-1/2" web (550). Studs and their opening
 * kin are S studs; plates/sills are the matching T track (R603.3.1: track
 * ends walls top+bottom); headers are back-to-back S per R603.6 box/back-
 * to-back header assemblies; floor/roof members come Phase 2+ (R505/R804)
 * but already resolve honestly here. Roles absent from the map are outside
 * the prescriptive LGS path → 'engineered design required'.
 */
const WALL_STUD_ROLES = new Set<MemberRole>(['stud', 'king-stud', 'trimmer', 'cripple'])
const WALL_TRACK_ROLES = new Set<MemberRole>(['bottom-plate', 'top-plate', 'cap-plate', 'sill'])
const HEADER_ROLES = new Set<MemberRole>(['header'])
const FLOOR_JOIST_ROLES = new Set<MemberRole>(['joist'])
const FLOOR_TRACK_ROLES = new Set<MemberRole>(['rim-joist'])
const CEILING_ROLES = new Set<MemberRole>(['ceiling-joist'])
const ROOF_ROLES = new Set<MemberRole>(['rafter'])
const BLOCKING_ROLES = new Set<MemberRole>(['blocking', 'fire-blocking', 'backing'])

/** Lumber nominal → LGS web stem (in 1/100 in): dressed-depth-matched. */
const WEB_FOR_LUMBER: Record<string, string> = {
  '2x4': '350',
  '2x6': '550',
  '2x8': '800',
  '2x10': '1000',
  '2x12': '1200',
}

function wallWebStem(spec: FramingSpec, interior: boolean): string {
  const size = interior ? spec.interiorStudSize : spec.exteriorStudSize
  return WEB_FOR_LUMBER[size] ?? '350'
}

/** Family stem for a role under a spec, or null (no prescriptive class). */
export function familyStemFor(
  role: MemberRole,
  spec: FramingSpec,
  opts?: { interior?: boolean },
): string | null {
  const interior = opts?.interior ?? false
  if (WALL_STUD_ROLES.has(role) || HEADER_ROLES.has(role)) {
    return `${wallWebStem(spec, interior)}S162`
  }
  if (WALL_TRACK_ROLES.has(role)) return `${wallWebStem(spec, interior)}T125`
  // Floor members use the S162 joist families of AISI S230 Table A4-1
  // (800/1000/1200S162 — the verified R505 set), depth-matched to the
  // spec's preferred lumber joist; rim = the matching T125 track.
  if (FLOOR_JOIST_ROLES.has(role)) {
    const size = spec.joistSizes[0] ?? '2x8'
    return `${WEB_FOR_LUMBER[size] ?? '800'}S162`
  }
  if (FLOOR_TRACK_ROLES.has(role)) {
    const size = spec.joistSizes[0] ?? '2x8'
    return `${WEB_FOR_LUMBER[size] ?? '800'}T125`
  }
  if (CEILING_ROLES.has(role)) return `${WEB_FOR_LUMBER[spec.ceilingJoistSize] ?? '550'}S162`
  if (ROOF_ROLES.has(role)) return `${WEB_FOR_LUMBER[spec.rafterSize] ?? '550'}S162`
  // Blocking/bridging: the U cold-rolled channel run through the stud
  // punchouts (the standard CFS bridging detail) — a REAL catalog family,
  // never a depth-matched invention.
  if (BLOCKING_ROLES.has(role)) return '150U050'
  return null
}

/** Thinnest catalog variant of a stem at/above `minMils` (stud/track pairing
 * keeps plates at the stud's mils — R603.3.1 track ≥ stud thickness). */
function pickVariant(stem: string, minMils: number): string | undefined {
  return familyVariants(stem).find((d) => (parseDesignator(d)?.mils ?? 0) >= minMils)
}

/** R603's thinnest structural stud thickness — the Phase-0 default; Phase 1
 * sizes mils from the prescriptive tables (height/spacing/wind). */
export const DEFAULT_STRUCTURAL_MILS = 33

/**
 * Resolve the LGS profile for a member role under a spec — the honest chain:
 *
 *  1. `spec.lgsMachine` set + machine VERIFIED + it rolls the exact generic
 *     family → that generic row, status 'verified', machine + spec-sheet
 *     sources.
 *  2. …or the machine rolls its OWN profile whose `nearestGeneric` is the
 *     family → the VENDOR designator + dims (machineProfile), status
 *     'verified', note carrying the dims delta (never pretends vendor
 *     geometry equals the AISI row).
 *  3. machine unknown / unverified / can't roll it → the generic AISI row,
 *     status = the fallback string (the substitution is never silent).
 *  4. no machine requested → the generic row, status 'verified' (the
 *     R603/SFIA base needs no vendor).
 *  5. role outside the prescriptive LGS path, or no catalog row →
 *     'engineered design required' (dims are never invented).
 */
export function profileFor(
  role: MemberRole,
  spec: FramingSpec,
  opts?: {
    interior?: boolean
    /** Minimum mils the resolution must meet (Phase 1's selection passes
     * its conservative pick here; R603.3.2's track rule rides it too —
     * track ≥ stud thickness). Default = the 33-mil structural floor. */
    minMils?: number
  },
): LgsProfileResolution {
  const minMils = opts?.minMils ?? DEFAULT_STRUCTURAL_MILS
  const stem = familyStemFor(role, spec, opts)
  if (!stem) {
    return {
      status: 'engineered design required',
      role,
      note: `no prescriptive cold-formed steel member class for role '${role}' (IRC R603/R505/R804 scope) — engineered design required`,
    }
  }
  const designator = pickVariant(stem, minMils)
  const family = designator ? profileFamily(designator) : undefined
  if (!designator || !family) {
    return {
      status: 'engineered design required',
      role,
      note: `no catalog row for family ${stem} at ≥ ${minMils} mil — engineered design required`,
    }
  }

  if (spec.lgsMachine) {
    const machine = machineFor(spec.lgsMachine)
    if (machine && machine.status === 'verified') {
      const rollable = rollableDesignators(machine)
      const pick =
        rollable.find((d) => d === designator) ??
        // machine rolls the family but not the requested mils → its
        // thinnest variant at/above the minimum still counts as rolled
        rollable.find(
          (d) =>
            d.startsWith(`${stem}-`) && (parseDesignator(d)?.mils ?? 0) >= minMils,
        )
      if (pick) {
        const pickFamily = profileFamily(pick)
        if (pickFamily) {
          return {
            status: 'verified',
            designator: pick,
            family: pickFamily,
            machine: spec.lgsMachine,
            sources: [...machine.sourceUrls, ...citationUrls(pickFamily.sourceRefs)],
          }
        }
      }
      // The machine's OWN profile geometry standing in for the family
      // (nearestGeneric): vendor designator + dims, verified by the
      // vendor's spec table; the note carries the dims delta.
      const vendorRow = machine.rollableFamilies.find(
        (rf) =>
          rf.designator &&
          rf.nearestGeneric?.toUpperCase() === stem &&
          (!rf.rollableMils || rf.rollableMils.some((m) => m >= minMils)),
      )
      if (vendorRow?.designator) {
        return {
          status: 'verified',
          designator: vendorRow.designator,
          family,
          machineProfile: vendorRow,
          machine: spec.lgsMachine,
          sources: vendorRow.sourceUrls ?? machine.sourceUrls,
          note:
            vendorRow.note ??
            `vendor profile geometry — nearest generic family ${stem}, dims differ`,
        }
      }
    }
    // unknown machine, unverified machine, or a verified one that can't
    // roll this family: generic base + the loud status string.
    return {
      status: LGS_FALLBACK_STATUS,
      designator,
      family,
      machine: spec.lgsMachine,
      sources: citationUrls(family.sourceRefs),
    }
  }

  return { status: 'verified', designator, family, sources: citationUrls(family.sourceRefs) }
}
