/**
 * Per-element drawer, stage 1 — pure selection → wall-engineering resolver.
 * The panel's SelectedWallCard calls `selectedWallInfo` with the host
 * selection and the level's ComputeResult and gets back everything the card
 * prints: name, exterior/interior, resolved construction, the framed
 * stud recipe and the climate-zone insulation the wall is entitled to.
 * Pure (no React, no stores) so the whole path is testable headlessly.
 */

import assemblies from '../data/wall-assemblies.json'
import { extractRooms, extractWalls } from './core/wall-model'
import { COURSE_HEIGHT, courseCount, snapCmuHeight } from './engines/cmu'
import { studSizeFor } from './engines/wall-framing'
import { formatIn } from './core/units'
import { LUMBER_CROSS_SECTIONS } from './lumber'
import {
  type ComputeResult,
  dedupeColinearWalls,
  probeSlabsFor,
  resolveWallConstruction,
} from './framing/compute'
import {
  isResolvedProfile,
  lgsLabelHead,
  lgsWallProfiles,
} from './engines/lgs-wall-framing'
import {
  framedAssembly,
  type FramingNode,
  type WallCladding,
  type WallConstruction,
  type WallEngineeringOverride,
  type WallInsulation,
  type WallOverride,
  type WallSpacingIn,
  type WallStudSize,
} from './framing/schema'
import { profileFor } from './jurisdiction/profiles'

const METERS_PER_INCH = 0.0254

const CLADDING_DATA = (assemblies as unknown as {
  exterior: { defaultCladdingByState: Record<string, string> }
}).exterior

export type SelectionLike = {
  levelId?: string | null
  selectedIds?: readonly string[] | null
}

/** Cladding select entries — every exterior.claddings key, display-labeled. */
export const CLADDING_OPTIONS: { value: WallCladding; label: string }[] = [
  { value: 'vinyl', label: 'Vinyl siding' },
  { value: 'fiberCement', label: 'Fiber cement' },
  { value: 'stucco', label: 'Stucco' },
  { value: 'brickVeneer', label: 'Brick veneer' },
  { value: 'wood', label: 'Wood siding' },
  { value: 'eifs', label: 'EIFS' },
]

/** Insulation type select entries (short labels fit both surfaces). */
export const INSULATION_OPTIONS: { value: WallInsulation; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'batt', label: 'Batt' },
  { value: 'blown', label: 'Blown' },
  { value: 'spray-foam', label: 'Foam' },
]

/** Insulation line for CMU walls — v1 is a note, no batt geometry. */
export const CMU_INSULATION_NOTE =
  'CMU: insulate with rigid board on furring strips — note only (v1)'

/** Both surfaces print this when the wall bounds a garage room (R302.6). */
export const GARAGE_SEPARATION_NOTE =
  'Bounds a garage — ½" gypsum on the garage side (dwelling/garage separation, IRC R302.6)'

/**
 * Resolved engineering the panel's framed-wall rows print/edit: every value
 * is the OVERRIDE when stored, else the state-code default — with a
 * default flag per row so the surfaces can hang the 'per state code' hint.
 */
export type WallEngineeringInfo = {
  studSize: WallStudSize
  spacingIn: WallSpacingIn
  /** Neither studSize nor spacingIn stored — the recipe is the state code's. */
  studsDefault: boolean
  insulation: WallInsulation
  /** R the batts carry: insulationR override, else the code minimum. */
  insulationR: number
  /** 'code min R-13 (zone 2A)' — the climate zone's prescriptive floor. */
  codeMinHint: string
  cladding: WallCladding
  claddingDefault: boolean
  /** Amber note when an EXPLICIT stud override is deeper than the drawn
   * wall can hold (2x6 in a 0.10m partition) — mirrors the compute warning;
   * the geometry draws cavity-fit (compressed to thickness − 1"), labels
   * and takeoff stay nominal. Null when it fits. */
  studsNote: string | null
}

export type SelectedWallInfo = {
  wallId: string
  /** Host node name when set, else a short id tail ("Wall …a4f2c1"). */
  label: string
  exterior: boolean
  curved: boolean
  /** Resolved construction: override → jurisdiction default → framed. */
  construction: WallConstruction
  /** The explicit per-wall override, if one is stored on the framing node —
   * a plain construction string or the mixed-wall object form. */
  override: WallOverride | undefined
  /** The wall's architectural height (m) — the CMU height slider's frame
   * of reference on both Engineering surfaces. */
  wallHeightM: number
  /** What the wall is built from — '2x6 studs @ 16" o.c.', the CMU module,
   * or the skip notice. Always printable. */
  assembly: string
  /** 'R-13 cavity · IECC zone 2A' — exterior framed walls only (interior
   * partitions and CMU have no prescriptive cavity batt), null otherwise. */
  insulation: string | null
  /** Set when the SELECTED wall is a colinear duplicate compute's dedupe
   * skips: the card shows (and `wallId` writes overrides against) the KEPT
   * twin — a duplicate's own engineering would be a lie (it is never framed)
   * and an override on its id would be inert. */
  duplicateNote: string | null
  /** Host wall-node ids the solid-mode cladding paint must cover: the kept
   * wall PLUS its colinear duplicates — painting only the kept id would
   * leave a seam where an overlapping twin still shows the old skin. */
  paintIds: string[]
  /** Editable engineering rows — framed walls only, null for CMU/skip. */
  engineering: WallEngineeringInfo | null
  /** 'length · gross/net area · openings' readout, identical on both surfaces. */
  dimensions: string
  /** GARAGE_SEPARATION_NOTE when the wall bounds a garage room, else null. */
  garageNote: string | null
}

/**
 * Resolve the host selection to a wall on the ACTIVE level, or null.
 * Null (card hidden) when: nothing selected, the node isn't a wall, the
 * wall lives on another level, or extraction drops it (hidden/degenerate).
 */
export function selectedWallInfo(
  nodes: Record<string, Record<string, unknown>>,
  selection: SelectionLike,
  framingNode: Pick<FramingNode, 'wallOverrides'> | undefined,
  result: ComputeResult | null,
): SelectedWallInfo | null {
  if (!framingNode || !result) return null
  const levelId = selection.levelId
  if (!levelId) return null
  const id = selection.selectedIds?.[0]
  if (!id) return null
  const node = nodes[id]
  if (!node || (node.type as string) !== 'wall') return null
  if (node.parentId !== levelId) return null

  // The SHARED compute probe (probeSlabsFor) so the exterior verdict here
  // matches the engines exactly: this level's slabs, else the nearest LOWER
  // storey with flooring in the same building (gable walls on slab-less
  // roof levels read exterior, not interior), attic rule gated on a storey
  // below.
  const { probeSlabs, hasLowerStorey } = probeSlabsFor(nodes, levelId)
  // …and the SHARED colinear dedupe: a selected duplicate resolves to its
  // KEPT twin — the twin's engineering is what's actually framed, and the
  // override write must target the id the engines consume (a duplicate's
  // override is inert). Same A4 parity rule as the probe above.
  const extracted = extractWalls(nodes, levelId, probeSlabs, hasLowerStorey)
  const { walls: keptWalls, duplicateOf } = dedupeColinearWalls(extracted)
  const keptId = duplicateOf.get(id) ?? id
  const wall = keptWalls.find((w) => w.id === keptId)
  if (!wall) return null

  const override = framingNode.wallOverrides?.[wall.id]
  const resolved = resolveWallConstruction(
    wall,
    framingNode,
    profileFor(result.jurisdiction).exteriorWallDefault,
  )
  const construction = resolved.construction

  // Per-wall stud recipe: the override when stored, else the state code's
  // (thickness-picked size + config spacing) — same resolution the engines
  // frame with, so the printed recipe is what the 3D members are.
  const defaultStudSize = studSizeFor(wall, result.spec) as WallStudSize
  const defaultSpacingIn = Math.round(result.spec.studSpacing / METERS_PER_INCH) as WallSpacingIn
  const studSize = resolved.studSize ?? defaultStudSize
  const spacingIn = resolved.spacingIn ?? defaultSpacingIn
  // 'lgs' says the STEEL truth (Phase 1): the assembly line prints the
  // exact profile + spacing the steel engine builds — ONE resolver
  // (lgsWallProfiles) feeds both, so the card can't drift from the 3D
  // members — with the selection basis stated (the mil table cells are
  // unverified; the conservative pick says so). A selected machine (Phase
  // 2) brands the suffix with the REAL constraint state: '· machine <key>'
  // plus, when this wall's resolutions fall back to generic AISI dims, the
  // honest count — the per-designator detail lives in the level warnings
  // (machineConstraintWarning) and on the member labels themselves.
  const lgsAssembly = (): string => {
    const profiles = lgsWallProfiles(wall, result.spec, {
      ...(resolved.studSize !== undefined ? { studSize: resolved.studSize } : {}),
      ...(resolved.spacingIn !== undefined ? { spacingIn: resolved.spacingIn } : {}),
    })
    if (!isResolvedProfile(profiles.stud)) {
      return 'Steel (LGS) — engineered design required (no prescriptive member class)'
    }
    const basis = profiles.basis ? ` — ${profiles.basis}` : ''
    // The count spans every fallback CLASS drawn on THIS wall (round-1
    // skeptic F2: stud + track always compose; the bridging channel only
    // where the wall carries backing members — counting it always would
    // overstate, dropping it understated the exhibit's 2 classes).
    const hasBacking = result.members.some(
      (m) => m.sourceId === wall.id && m.role === 'backing' && m.material === 'steel',
    )
    const fallbacks = [
      profiles.stud,
      profiles.track,
      ...(hasBacking ? [profiles.backing] : []),
    ].filter((r) => isResolvedProfile(r) && r.status !== 'verified').length
    const machineNote = result.spec.lgsMachine
      ? ` · machine ${result.spec.lgsMachine}` +
        (fallbacks > 0
          ? ` (${fallbacks} profile${fallbacks === 1 ? ' falls' : 's fall'} back)`
          : '')
      : ''
    return `Steel (LGS) — ${lgsLabelHead(profiles.stud)} @ ${spacingIn}" o.c.${basis}${machineNote}`
  }
  const assembly =
    construction === 'framed'
      ? `${studSize} studs @ ${spacingIn}" o.c.`
      : construction === 'lgs'
        ? lgsAssembly()
        : construction === 'cmu'
          ? '8" CMU block · running bond'
          : 'Skipped — excluded from every system'

  const ins = result.characteristics?.insulation
  // Steel-frame honesty (round-1 F2): the R figure is the WOOD-frame
  // prescriptive cell — 2021 IECC R402.2.6 / IRC N1102.2.6 give
  // steel-frame walls their own requirement (cavity + continuous
  // insulation, or U-factor path) and nothing here evaluates it. The
  // card line says so instead of letting the wood claim ride.
  const steelInsNote =
    ' — wood-frame prescriptive value; steel framing takes IECC R402.2.6 ' +
    'continuous insulation / U-factor — not evaluated'
  const insulation =
    framedAssembly(construction) && wall.exterior && ins
      ? `R-${ins.wallR} cavity · IECC zone ${ins.climateZone}${construction === 'lgs' ? steelInsNote : ''}`
      : null

  const codeMinR = ins?.wallR ?? 13
  const engineering: WallEngineeringInfo | null =
    framedAssembly(construction)
      ? {
          studSize,
          spacingIn,
          studsDefault: resolved.studSize === undefined && resolved.spacingIn === undefined,
          insulation: resolved.insulation ?? 'none',
          insulationR: resolved.insulationR ?? codeMinR,
          codeMinHint: `code min R-${codeMinR}${ins ? ` (zone ${ins.climateZone})` : ''}`,
          cladding:
            resolved.cladding ??
            ((CLADDING_DATA.defaultCladdingByState[result.jurisdiction] ??
              'vinyl') as WallCladding),
          claddingDefault: resolved.cladding === undefined,
          studsNote:
            resolved.studSize !== undefined &&
            LUMBER_CROSS_SECTIONS[resolved.studSize][1] > wall.thickness - METERS_PER_INCH + 0.002
              ? `${resolved.studSize} studs exceed this ${wall.thickness.toFixed(2)}m wall — ` +
                `framing is drawn compressed to ${formatIn(wall.thickness - METERS_PER_INCH)}; ` +
                `deepen the wall or drop to 2x4`
              : null,
        }
      : null

  // length · gross/net area · openings — the display extras both surfaces
  // print under the controls.
  const grossM2 = wall.length * wall.height
  const openingsM2 = wall.openings.reduce((sum, o) => sum + o.width * o.height, 0)
  const netM2 = Math.max(0, grossM2 - openingsM2)
  const count = wall.openings.length
  const dimensions =
    count === 0
      ? `${wall.length.toFixed(2)} m · ${grossM2.toFixed(1)} m² · no openings`
      : `${wall.length.toFixed(2)} m · ${grossM2.toFixed(1)} m² gross / ${netM2.toFixed(1)} m² net · ${count} opening${count > 1 ? 's' : ''}`

  // Garage fire separation (R302.6): the wall bounds a garage room — either
  // under its kept id or the selected duplicate's own id.
  const boundsGarage = extractRooms(nodes, levelId).some(
    (room) =>
      room.category === 'garage' &&
      (room.boundaryWallIds.includes(wall.id) || room.boundaryWallIds.includes(id)),
  )
  const garageNote = boundsGarage ? GARAGE_SEPARATION_NOTE : null

  // Label the wall whose engineering the card SHOWS — the kept twin when
  // the selection was a duplicate.
  const keptNode = nodes[wall.id] ?? node
  const name = typeof keptNode.name === 'string' ? keptNode.name.trim() : ''
  const label = name !== '' ? name : `Wall ${wall.id.length > 10 ? `…${wall.id.slice(-6)}` : wall.id}`
  const duplicateNote =
    keptId !== id
      ? `Duplicate overlapping wall — showing the framed twin (${label}); edits apply to it`
      : null

  const paintIds = [
    wall.id,
    ...[...duplicateOf.entries()].filter(([, kept]) => kept === wall.id).map(([dup]) => dup),
  ]

  return {
    wallId: wall.id,
    label,
    exterior: wall.exterior,
    curved: wall.curved,
    construction,
    override,
    wallHeightM: wall.height,
    assembly,
    insulation,
    duplicateNote,
    paintIds,
    engineering,
    dimensions,
    garageNote,
  }
}

/** Seam detail note shown under a PARTIAL-height CMU slider (both surfaces). */
export const CMU_SEAM_NOTE = 'PT sill + anchor bolts at the seam — R403.1.6'

/**
 * Everything a CMU height slider needs, derived from the wall height and the
 * stored override. Full-height CMU (plain 'cmu' string, an object with no
 * height, or a jurisdiction default) reads 100%; a partial override reads
 * its course-snapped height. Null when the wall is shorter than one course —
 * there is nothing to lay, so no control renders.
 */
export type CmuHeightControl = {
  /** Course-snapped CMU-zone height the slider shows (m). */
  valueM: number
  courses: number
  totalCourses: number
  /** Slider bounds/step: 1 course → the full wall height, one course per step. */
  minM: number
  maxM: number
  stepM: number
  /** True when only the bottom portion is block — the seam note applies. */
  partial: boolean
  /** '1.02m · 5 courses · 42%' */
  readout: string
}

export function cmuHeightControl(
  wallHeightM: number,
  override: WallOverride | undefined,
): CmuHeightControl | null {
  const totalCourses = courseCount(wallHeightM)
  if (totalCourses < 1) return null
  const requested =
    typeof override === 'object' && override.cmuHeightM !== undefined
      ? override.cmuHeightM
      : wallHeightM // no stored height = full-height CMU, today's default
  const valueM = snapCmuHeight(requested, wallHeightM)
  const courses = courseCount(valueM)
  const partial = courses < totalCourses
  const percent = Math.round((100 * courses) / totalCourses)
  return {
    valueM,
    courses,
    totalCourses,
    minM: COURSE_HEIGHT,
    maxM: wallHeightM,
    stepM: COURSE_HEIGHT,
    partial,
    readout: `${valueM.toFixed(2)}m · ${courses} ${courses === 1 ? 'course' : 'courses'} · ${percent}%`,
  }
}

/**
 * The override value a CMU height-slider write stores. Full height (every
 * course that fits, or beyond) collapses to the plain legacy 'cmu' string —
 * BYTE-EQUAL to what the segmented control writes today — while a partial
 * height stores the object form with the course-snapped height, so the
 * persisted number is exactly what the engines build (S5).
 */
export function cmuHeightOverride(wallHeightM: number, requestedM: number): WallOverride {
  const snapped = snapCmuHeight(requestedM, wallHeightM)
  if (snapped <= 0 || courseCount(snapped) >= courseCount(wallHeightM)) return 'cmu'
  return { construction: 'cmu', cmuHeightM: snapped }
}

/**
 * The update payload for a per-wall construction change — merge, never
 * replace, so one wall's edit can't drop another's override.
 */
export function wallOverridePatch(
  framingNode: Pick<FramingNode, 'wallOverrides'>,
  wallId: string,
  construction: WallOverride,
): { wallOverrides: Record<string, WallOverride> } {
  return { wallOverrides: { ...framingNode.wallOverrides, [wallId]: construction } }
}

/**
 * The MINIMAL stored form of an override object: drop undefined fields and
 * collapse a fields-less object to the plain legacy string — the write side
 * of the byte-equal guarantee (an override that says nothing beyond its
 * construction persists exactly like the segmented control always did).
 */
function normalizeOverride(o: WallEngineeringOverride): WallOverride {
  const out: WallEngineeringOverride = {
    construction: o.construction,
    ...(o.cmuHeightM !== undefined ? { cmuHeightM: o.cmuHeightM } : {}),
    ...(o.studSize !== undefined ? { studSize: o.studSize } : {}),
    ...(o.spacingIn !== undefined ? { spacingIn: o.spacingIn } : {}),
    ...(o.insulation !== undefined ? { insulation: o.insulation } : {}),
    ...(o.insulationR !== undefined ? { insulationR: o.insulationR } : {}),
    ...(o.cladding !== undefined ? { cladding: o.cladding } : {}),
  }
  return Object.keys(out).length === 1 ? out.construction : out
}

/**
 * Construction change that PRESERVES the wall's stored engineering fields
 * (studs/insulation/cladding survive a framed↔cmu flip); `cmuHeightM` is
 * dropped when leaving CMU (the schema rejects it elsewhere). A string or
 * absent override keeps writing the plain string — byte-equal to today.
 */
export function constructionOverride(
  current: WallOverride | undefined,
  next: WallConstruction,
): WallOverride {
  if (typeof current !== 'object' || current === null) return next
  const merged: WallEngineeringOverride = { ...current, construction: next }
  if (next !== 'cmu') merged.cmuHeightM = undefined
  return normalizeOverride(merged)
}

/**
 * One engineering-field write (Studs / Insulation / Exterior finish rows):
 * merges into the stored object (or opens one anchored on the RESOLVED
 * construction), normalizes to the minimal form. A field explicitly set to
 * undefined is REMOVED — back to 'per state code'.
 */
export function engineeringOverride(
  current: WallOverride | undefined,
  construction: WallConstruction,
  patch: Partial<Omit<WallEngineeringOverride, 'construction'>>,
): WallOverride {
  const base: WallEngineeringOverride =
    typeof current === 'object' && current !== null
      ? { ...current }
      : { construction: typeof current === 'string' ? current : construction }
  return normalizeOverride({ ...base, ...patch })
}

/**
 * The CMU height slider's write, engineering-fields preserved: full height
 * collapses per `cmuHeightOverride` (plain 'cmu' when nothing else is
 * stored), a partial height merges the course-snapped value into the
 * existing object.
 */
export function cmuHeightWrite(
  current: WallOverride | undefined,
  wallHeightM: number,
  requestedM: number,
): WallOverride {
  const write = cmuHeightOverride(wallHeightM, requestedM)
  const base = typeof current === 'object' && current !== null ? { ...current } : {}
  return normalizeOverride({
    ...base,
    construction: 'cmu',
    // full height: drop the stored height (legacy-string collapse when
    // nothing else is stored); partial: the course-snapped value.
    cmuHeightM: typeof write === 'string' ? undefined : write.cmuHeightM,
  })
}
