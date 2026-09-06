/**
 * The assembly point: scene nodes + one `bones:framing` config node → every
 * derived Member/Fixture for that level. Pure (no React, no stores) so the
 * whole inference pipeline is testable headlessly; the renderer just calls
 * this and instances the result.
 */

import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import { stableFixtures, stableMembers } from '../core/stable'
import type {
  Fixture,
  Member,
  ServiceOverrides,
  ServicePointOverride,
  SlabSlice,
  WallSlice,
} from '../core/types'
import { formatIn, inches } from '../core/units'
import {
  extractLevels,
  extractPlacedFixtures,
  extractRooms,
  extractServiceOverrides,
  extractSlabs,
  extractWalls,
  type LevelSlice,
  SLEEPING_NAME_RE,
  type WallDatum,
} from '../core/wall-model'
import { type DerivedDevice, deriveWallDevices } from '../device/derive'
import { extractDeviceOverrides } from '../device/overrides'
import { type BuildingCharacteristics, computeCharacteristics } from '../engines/characteristics'
import {
  type CmuDowelLayout,
  cmuDowelPositions,
  cmuWalls,
  courseCount,
  mixedCmuWall,
  snapCmuHeight,
} from '../engines/cmu'
import { frameDeck } from '../engines/deck-framing'
import {
  applyDeviceOverrides,
  layoutElectrical,
  openingSpans,
  overrideWallPoint,
  routeWiring,
  wallPlan,
} from '../engines/electrical'
import { frameFloor } from '../engines/floor-framing'
import { buildFoundation } from '../engines/foundation'
import { flagLinesetTradeCrossings, layoutHvac } from '../engines/hvac'
import { lgsFrameWalls } from '../engines/lgs-wall-framing'
import { layoutPlumbing, placeMeterSpot } from '../engines/plumbing'
import { detectUnframedRoofIntersections, extractRoofs, frameRoofs } from '../engines/roof-framing'
import type { TakeoffAreas } from '../engines/takeoff'
import { bracingWarnings, crossReferenceHoldDowns } from '../engines/wall-bracing'
import {
  dedupeFoundationStraps,
  frameHints,
  frameWalls,
  specForWall,
  studSizeFor,
  upliftPathWarnings,
} from '../engines/wall-framing'
import { layoutWallLayers } from '../engines/wall-layers'
import { resolveJurisdiction, siteStateOf } from '../jurisdiction/guess'
import { applyJurisdiction, nonIrcCodeWarning, profileFor } from '../jurisdiction/profiles'
import { LUMBER_CROSS_SECTIONS } from '../lumber'
import {
  type FramingNode,
  framedAssembly,
  type WallConstruction,
  type WallEngineeringOverride,
} from './schema'

export type ComputeResult = {
  members: Member[]
  fixtures: Fixture[]
  warnings: string[]
  /** Resolved jurisdiction code actually used ('AUTO' → guessed). */
  jurisdiction: string
  spec: FramingSpec
  /** Gross sheet-goods areas for the takeoff (walls/slabs aren't returned). */
  areas: TakeoffAreas
  /** Whole-building metrics (floor area, volume, envelope UA…) — null when
   * there is nothing to measure. Cited/assumption-labeled via `notes`. */
  characteristics: BuildingCharacteristics | null
  /** Colinear-dedupe map (duplicate id → kept id) — consumers that key off
   * member sourceIds (cull exemption) resolve host selections through it. */
  duplicateOf: Record<string, string>
  /** Wall-mounted electrical devices (deterministic deviceIds, final mount
   * anchors) — what the `bones:device` reconciler mirrors into nodes.
   * Empty when electrical is off. */
  devices: DerivedDevice[]
  /** Deduped ACTIVE walls the engines framed ('skip' overrides excluded,
   * S8 merged openings included) — the OpeningSlices the plan set's
   * door/window schedule tabulates (LOD-400 B21d). Openings live on the
   * wall model and are not recoverable from members. LIVE memo references
   * (the same objects the cached result and the engines hold) — do not
   * mutate. */
  walls: WallSlice[]
}

/**
 * Fully-resolved construction for one wall. `cmuHeightM` is only carried for
 * a 'cmu' wall whose override requested a partial height (mixed CMU/framed —
 * the engines snap it to whole courses); undefined = full-height, as today.
 * The engineering fields (studSize/spacingIn/insulation/insulationR/cladding)
 * ride through VERBATIM when the object override carries them — every field
 * stays absent otherwise, so a resolved default is byte-indistinguishable
 * from today's and the engines' fallback paths stay untouched.
 */
export type ResolvedWallConstruction = { construction: WallConstruction } & Omit<
  WallEngineeringOverride,
  'construction'
>

/** Construction resolution for one wall: override → jurisdiction default →
 * the level's framing system → framed. `framingSystem: 'lgs'` (LGS Phase 1)
 * makes steel the DEFAULT for otherwise-framed walls; explicit overrides
 * (string or object form, 'framed' included) always win, and a
 * jurisdiction CMU exterior default (FL) still beats the framing system —
 * `framingSystem` chooses how FRAMED walls frame, never whether a wall is
 * masonry. */
export function resolveWallConstruction(
  wall: WallSlice,
  config: Pick<FramingNode, 'wallOverrides' | 'framingSystem'>,
  exteriorDefault: 'framed' | 'cmu',
): ResolvedWallConstruction {
  const override = config.wallOverrides?.[wall.id]
  if (typeof override === 'string') return { construction: override }
  if (override) {
    return {
      construction: override.construction,
      ...(override.cmuHeightM !== undefined ? { cmuHeightM: override.cmuHeightM } : {}),
      ...(override.studSize !== undefined ? { studSize: override.studSize } : {}),
      ...(override.spacingIn !== undefined ? { spacingIn: override.spacingIn } : {}),
      ...(override.insulation !== undefined ? { insulation: override.insulation } : {}),
      ...(override.insulationR !== undefined ? { insulationR: override.insulationR } : {}),
      ...(override.cladding !== undefined ? { cladding: override.cladding } : {}),
    }
  }
  if (wall.exterior && exteriorDefault === 'cmu') return { construction: 'cmu' }
  if (config.framingSystem === 'lgs') return { construction: 'lgs' }
  return { construction: 'framed' }
}

/** Construction system only (back-compat for the panel/inspector cards). */
export function wallConstruction(
  wall: WallSlice,
  config: Pick<FramingNode, 'wallOverrides' | 'framingSystem'>,
  exteriorDefault: 'framed' | 'cmu',
): WallConstruction {
  return resolveWallConstruction(wall, config, exteriorDefault).construction
}

// Per-config memo: the panel and the 3D renderer both derive from the same
// store snapshot on every scene edit — identical (nodes, config) references
// return the cached result. Keyed by config (WeakMap) so a multi-storey
// scene with an X-ray node per level doesn't thrash a single slot every
// frame (verify round advisory). Pascal's stores hand out immutable
// snapshots, so reference equality is a safe cache key.
const memo = new WeakMap<
  FramingNode,
  { nodes: Record<string, Record<string, unknown>>; result: ComputeResult }
>()

/** The building's foundation record: floor system and finish floor above grade (metres). */
export type FoundationRecord = { type: 'slab' | 'raised'; ffAboveGradeM: number }

/**
 * `metadata.foundation` on the building node — `{ type: 'slab' | 'raised',
 * ffAboveGradeIn }`, written by the generator (PlanCrafters' foundation
 * record). Anything else reads as slab-on-grade at the plate line.
 */
export function foundationOf(building: Record<string, unknown> | undefined): FoundationRecord {
  const meta = building?.metadata as
    | { foundation?: { type?: unknown; ffAboveGradeIn?: unknown } }
    | null
    | undefined
  const f = meta && typeof meta === 'object' ? meta.foundation : undefined
  const type = f?.type === 'raised' ? 'raised' : 'slab'
  const inchesUp =
    typeof f?.ffAboveGradeIn === 'number' && Number.isFinite(f.ffAboveGradeIn)
      ? f.ffAboveGradeIn
      : 0
  return { type, ffAboveGradeM: Math.max(0, inchesUp) * 0.0254 }
}

export function computeLevel(
  nodes: Record<string, Record<string, unknown>>,
  config: FramingNode,
): ComputeResult {
  const hit = memo.get(config)
  if (hit && hit.nodes === nodes) return hit.result
  const result = computeLevelUncached(nodes, config)
  memo.set(config, { nodes, result })
  return result
}

/**
 * A service-point override landing inside a door/window rough opening is
 * honored VERBATIM (checklist A4 — the node is the truth), but never
 * silently: the forced mount skips the engines' clearance scans
 * (panelMountU, placeMeterSpot), so the collision must surface as a level
 * warning (visual round: an unflagged window-RO panel at wallT 0.52).
 * `y` is the mounted device-center height (the routed fixture's Y).
 */
function serviceOverrideRoWarning(
  walls: WallSlice[],
  override: ServicePointOverride | undefined,
  label: string,
  y: number,
  suffix = '',
): string | null {
  if (!override) return null
  const wp = overrideWallPoint(walls, override)
  if (!wp) return null
  const inRo = openingSpans(wp.wall, y - 0.02, y + 0.02).some(
    (sp) => wp.u > sp.lo + 0.01 && wp.u < sp.hi - 0.01,
  )
  return inRo
    ? `Service point “${label}” sits in a door/window rough opening — move it clear${suffix}`
    : null
}

/**
 * A device-blocking row (off-stud box mount) lands INSIDE a stud bay that a
 * per-wall insulation override may have filled with a batt — the installer
 * notches the batt around the block, so the member model SPLITS it: the
 * overlapped batt becomes a below-piece and an above-piece (the block spans
 * the whole bay, S1/S6 — verify night-4 batch F3). Mutates `members`.
 */
export function splitBattsAroundBlocking(members: Member[], blocking: Member[]): void {
  for (const block of blocking) {
    if (block.label !== 'device blocking — box off-stud') continue
    const byLo = block.position[1] - block.dims[1] / 2
    const byHi = block.position[1] + block.dims[1] / 2
    for (let i = members.length - 1; i >= 0; i--) {
      const m = members[i] as Member
      if (m.role !== 'insulation' || m.sourceId !== block.sourceId) continue
      // both boxes are centered on the wall line — colinear overlap test
      const du = Math.hypot(m.position[0] - block.position[0], m.position[2] - block.position[2])
      if (du > (m.dims[0] + block.dims[0]) / 2 - 0.005) continue
      const yLo = m.position[1] - m.dims[1] / 2
      const yHi = m.position[1] + m.dims[1] / 2
      if (byLo >= yHi - 0.001 || byHi <= yLo + 0.001) continue
      const pieces: Member[] = []
      if (byLo - yLo > 0.02) {
        pieces.push({
          ...m,
          dims: [m.dims[0], byLo - yLo, m.dims[2]],
          position: [m.position[0], (yLo + byLo) / 2, m.position[2]],
        })
      }
      if (yHi - byHi > 0.02) {
        pieces.push({
          ...m,
          dims: [m.dims[0], yHi - byHi, m.dims[2]],
          position: [m.position[0], (byHi + yHi) / 2, m.position[2]],
        })
      }
      members.splice(i, 1, ...pieces)
    }
  }
}

/**
 * serviceType → override slot for the service types added AFTER the core five
 * (thermostat / heat-pump / electric-meter). The extraction extension lives
 * HERE rather than in wall-model.ts — same lowest-id-wins, visible-only and
 * NaN-guard contract as `extractServiceOverrides`, but kept out of that file
 * so the parallel exterior-fallback rework there never collides with it.
 */
const EXTRA_SERVICE_KEY: Record<string, 'thermostat' | 'heatPump' | 'electricMeter'> = {
  thermostat: 'thermostat',
  'heat-pump': 'heatPump',
  'electric-meter': 'electricMeter',
}

function extractExtraServiceOverrides(
  nodes: Record<string, Record<string, unknown>>,
  levelId: string,
): {
  overrides: Pick<ServiceOverrides, 'thermostat' | 'heatPump' | 'electricMeter'>
  duplicates: string[]
} {
  const winners = new Map<
    'thermostat' | 'heatPump' | 'electricMeter',
    { id: string; node: Record<string, unknown> }
  >()
  const duplicates = new Set<string>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'bones:service' || node.parentId !== levelId) continue
    if (node.visible === false) continue
    const serviceType = String(node.serviceType)
    const key = EXTRA_SERVICE_KEY[serviceType]
    if (!key) continue
    const id = String(node.id ?? '')
    const current = winners.get(key)
    if (!current) {
      winners.set(key, { id, node })
      continue
    }
    duplicates.add(serviceType)
    if (id < current.id) winners.set(key, { id, node })
  }
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const overrides: Pick<ServiceOverrides, 'thermostat' | 'heatPump' | 'electricMeter'> = {}
  for (const [key, { node }] of winners) {
    const override: ServicePointOverride = {}
    if (typeof node.wallId === 'string' && node.wallId.length > 0) override.wallId = node.wallId
    if (typeof node.wallT === 'number' && Number.isFinite(node.wallT)) override.wallT = node.wallT
    if (typeof node.heightAff === 'number' && Number.isFinite(node.heightAff)) {
      override.heightAff = node.heightAff
    }
    const pos = Array.isArray(node.position) ? (node.position as number[]) : null
    if (pos && pos.length >= 3) {
      override.position = [num(pos[0], 0), num(pos[1], 0), num(pos[2], 0)]
    }
    // Assembly-yaw override (heat-pump rotate parity, HP polish item 4):
    // the node's nullable `yawOverride` threads through as `yaw`; null /
    // absent / non-finite all mean "derive" (hvac squares to the wall).
    if (typeof node.yawOverride === 'number' && Number.isFinite(node.yawOverride)) {
      override.yaw = node.yawOverride
    }
    overrides[key] = override
  }
  return { overrides, duplicates: [...duplicates].sort() }
}

/**
 * The ONE wall-classification probe (checklist A4 parity): this level's own
 * slabs, widened to the nearest LOWER storey with flooring in the same
 * building when the level has none (plan projection — the footprint below
 * says which side of a gable wall is in), then — when the whole building has
 * NO flooring at all — this level's INDOOR zone polygons as declared floor
 * coverage (the starter-template shape: walls + zones, no slab; 2026-08-22),
 * plus the hasLowerStorey flag that gates the attic blanket-exterior rule.
 * Exported so the service seeding action (place.ts) and the per-element
 * drawer (panel-selection.ts) classify walls EXACTLY like the engines —
 * seeding with a narrower probe moved the water meter on creation (verify
 * round 2026-08-16, F3).
 * `levels` (building-scoped, ordinal-sorted) is accepted to save the
 * re-extraction when the caller already has it.
 */
export function probeSlabsFor(
  nodes: Record<string, Record<string, unknown>>,
  levelId: string,
  levels?: LevelSlice[],
): { slabs: SlabSlice[]; probeSlabs: SlabSlice[]; hasLowerStorey: boolean } {
  const scoped =
    levels ??
    (() => {
      const all = extractLevels(nodes)
      const myBuilding = all.find((l) => l.id === levelId)?.buildingId ?? null
      return all.filter((l) => l.buildingId === myBuilding)
    })()
  const levelIndex = scoped.findIndex((l) => l.id === levelId)
  const slabs = extractSlabs(nodes, levelId)
  // Outdoor floors (a deck, a porch pad) are exactly the outdoors the probes
  // hunt for: they never count as coverage, on this level or the one below
  // (W10b — a porch slab against the front wall made the wall under the
  // porch read interior and lose its sheathing, WRB and siding).
  const indoor = (list: SlabSlice[]) => list.filter((s) => !s.outdoor)
  let probeSlabs = indoor(slabs)
  if (probeSlabs.length === 0) {
    for (let i = levelIndex - 1; i >= 0; i--) {
      const lowerId = scoped[i]?.id
      if (!lowerId) continue
      const lower = indoor(extractSlabs(nodes, lowerId))
      if (lower.length > 0) {
        probeSlabs = lower
        break
      }
    }
  }
  // A building with NO flooring anywhere still knows its indoors when zones
  // are drawn: INDOOR room polygons are declared floor area, so they stand in
  // as probe coverage (zero-thickness pseudo-slabs — every consumer reads
  // only `.polygon`). The starter templates ship walls + zones and no slab;
  // without this the election probe found both sides of every perimeter wall
  // equally 'uncovered' and framed the whole shell INTERIOR — no condenser
  // wall, no AC disconnect, ⚠-flagged pad at the fallback anchor, no outdoor
  // receptacles, no sheathing/WRB/cladding (starter-template heat-pump
  // report 2026-08-22). OUTDOOR zones (garden/patio/yard…) never count —
  // they are exactly the outdoors the probe is trying to detect, and the
  // wall-layers exteriorSide probe stays coherent: indoor pseudo-slab on one
  // side + nothing on the garden side still picks the outdoor face.
  if (probeSlabs.length === 0) {
    const zoneFloors = extractRooms(nodes, levelId)
      .filter((room) => room.category !== 'outdoor')
      .map(
        (room): SlabSlice => ({
          id: `zonefloor_${room.id}`,
          polygon: room.polygon,
          holes: [],
          elevation: 0,
          thickness: 0,
        }),
      )
    if (zoneFloors.length > 0) probeSlabs = zoneFloors
  }
  return { slabs, probeSlabs, hasLowerStorey: levelIndex > 0 }
}

/**
 * Duplicate colinear walls (host scenes routinely carry overlapping
 * segments) framed TWICE: z-fighting studs, doubled plates, ~20% phantom
 * lumber in the takeoff (quality round-1 A5). Keep the longer of any
 * near-coincident pair; `duplicateOf` maps every dropped id to its kept
 * twin. Exported so the per-element drawer (panel-selection.ts) resolves a
 * selected duplicate to the wall that IS framed — the card used to claim
 * studs for a never-framed wall and write inert overrides against its id
 * (skeptic 2026-08-16).
 */
export function dedupeColinearWalls(rawWalls: WallSlice[]): {
  walls: WallSlice[]
  duplicateOf: Map<string, string>
} {
  const walls: WallSlice[] = []
  const duplicateOf = new Map<string, string>()
  for (const w of [...rawWalls].sort((a, b) => b.length - a.length)) {
    const dupIdx = walls.findIndex((kept) => {
      if (Math.abs(kept.thickness - w.thickness) > 0.03) return false
      const cross = Math.abs(kept.dir[0] * w.dir[1] - kept.dir[1] * w.dir[0])
      if (cross > 0.05) return false
      // both endpoints of w lie on kept's centerline band
      const on = (p: readonly [number, number]): boolean => {
        const dx = p[0] - kept.start[0]
        const dz = p[1] - kept.start[1]
        const along = dx * kept.dir[0] + dz * kept.dir[1]
        const off = Math.abs(-dx * kept.dir[1] + dz * kept.dir[0])
        return along > -0.05 && along < kept.length + 0.05 && off < kept.thickness / 2
      }
      return on(w.start) && on(w.end)
    })
    if (dupIdx < 0) {
      walls.push(w)
      continue
    }
    const kept = walls[dupIdx] as WallSlice
    duplicateOf.set(w.id, kept.id)
    // The twins usually come from two rooms each drawing their own boundary
    // — and only ONE of them carries the door. Dropping the duplicate used
    // to drop its openings with it, framing studs straight through real
    // doorways (verify round, doors exhibit). Project the duplicate's
    // openings onto the kept centerline and merge the ones the kept wall
    // doesn't already have.
    const merged = [...kept.openings]
    let added = false
    for (const o of w.openings) {
      const px = w.start[0] + w.dir[0] * o.u
      const pz = w.start[1] + w.dir[1] * o.u
      const u = (px - kept.start[0]) * kept.dir[0] + (pz - kept.start[1]) * kept.dir[1]
      if (u < -0.05 || u > kept.length + 0.05) continue
      const twin = merged.some(
        (k) => Math.abs(k.u - u) < 0.15 && Math.abs(k.roughWidth - o.roughWidth) < 0.15,
      )
      if (twin) continue
      merged.push({ ...o, u: Math.min(Math.max(u, 0), kept.length) })
      added = true
    }
    if (added) {
      merged.sort((a, b) => a.u - b.u)
      walls[dupIdx] = { ...kept, openings: merged }
    }
  }
  return { walls, duplicateOf }
}

function computeLevelUncached(
  nodes: Record<string, Record<string, unknown>>,
  config: FramingNode,
): ComputeResult {
  const warnings: string[] = []
  const levelId = config.parentId
  if (!levelId) {
    return {
      members: [],
      fixtures: [],
      warnings: ['Framing node has no level'],
      jurisdiction: 'INTL',
      spec: DEFAULT_SPEC,
      areas: {},
      characteristics: null,
      duplicateOf: {},
      devices: [],
      walls: [],
    }
  }

  const { code } = resolveJurisdiction(config.jurisdiction, siteStateOf(nodes))
  const profile = profileFor(code)
  let spec: FramingSpec = {
    ...DEFAULT_SPEC,
    detail: config.detail,
    studSpacing: inches(config.studSpacingIn),
  }
  // LGS Phase 1: the config's framing system rides the spec so the wall
  // engines (and profileFor's machine resolution) see it. Folded ONLY when
  // present — an absent field keeps the spec object byte-identical to
  // master (the E5 baseline pins the spec).
  if (config.framingSystem !== undefined) spec = { ...spec, framingSystem: config.framingSystem }
  if (config.lgsMachine !== undefined) spec = { ...spec, lgsMachine: config.lgsMachine }
  if (config.roofSystem !== undefined) spec = { ...spec, roofSystem: config.roofSystem }
  // 400 (fabrication) builds ON TOP of the code-sized pass — jurisdiction applies to both.
  if (config.detail !== '200') {
    spec = applyJurisdiction(spec, profile)
    // ircBase:null honesty (WI-UDC / Canadian-NBC class): the engines cite
    // IRC sections unconditionally — on a non-IRC jurisdiction that is
    // generic practice, not local law, and the level says so out loud.
    const nonIrc = nonIrcCodeWarning(profile)
    if (nonIrc) warnings.push(nonIrc)
  }

  // ALL level arithmetic stays inside THIS level's building — a second
  // building's ground floor is still a ground floor (verify round: global
  // indexing skipped its foundation and framed its slab as an upper floor).
  const allLevels = extractLevels(nodes)
  const myBuilding = allLevels.find((l) => l.id === levelId)?.buildingId ?? null
  const levels = allLevels.filter((l) => l.buildingId === myBuilding)
  const levelIndex = levels.findIndex((l) => l.id === levelId)
  const isGroundLevel = levelIndex <= 0
  // The FOUNDATION record (PlanCrafters' model.foundation, carried on the
  // building node's metadata by the generator): the floor system and how far
  // the finish floor stands above grade. Absent = slab-on-grade with grade at
  // the plate line, which keeps every existing scene byte-identical.
  const foundation = foundationOf(myBuilding ? nodes[myBuilding] : undefined)
  const gradeY = isGroundLevel ? -foundation.ffAboveGradeM : 0
  const raisedFloor = isGroundLevel && foundation.type === 'raised'

  // Slabs feed the exterior fallback: hosts often mark BOTH wall faces
  // 'interior' (quality round-1 A1) — flooring says which side is in.
  // Roof/attic levels carry NO slabs of their own, so the probe found both
  // sides of a gable-end wall equally 'uncovered' and framed it as INTERIOR
  // (prod starter house 2026-08-16 — no sheathing/WRB/cladding). The PROBE
  // set widens to the nearest LOWER storey with flooring in the same
  // building (probeSlabsFor — shared with place.ts / panel-selection.ts so
  // every consumer classifies walls identically, A4). Only the probes use
  // it: floor framing / foundation / areas keep this level's own (empty)
  // slab list. hasLowerStorey gates the attic blanket-exterior rule: only a
  // level with a storey below it can be an attic/gable storey — an
  // in-progress GROUND storey keeps interior walls, so the takeoff never
  // books sheathing the layer engine can't render (checklist S4).
  const { slabs, probeSlabs, hasLowerStorey } = probeSlabsFor(nodes, levelId, levels)
  // The level's vertical datum for the walls (W11b), the host's way: a wall
  // with no explicit height reaches the wall plane — the floor-to-floor
  // line, lowered to the underside of a covering slab of the storey above
  // over its run (core getWallPlaneTop) — and a wall on a support slab at
  // another height (the garage pad at grade beside a raised platform)
  // stands on it: base = that slab's surface in the framing datum, where
  // the highest slab's surface is the plate line (foundation emitSlabField).
  const levelAboveForPlane = levels[levelIndex + 1]
  const floorToFloor = levelAboveForPlane
    ? levelAboveForPlane.baseY - (levels[levelIndex]?.baseY ?? 0)
    : (levels[levelIndex]?.height ?? 2.7)
  const coveringSlabs = levelAboveForPlane
    ? extractSlabs(nodes, levelAboveForPlane.id).filter((s) => s.kind !== 'deck')
    : []
  const slabTopElevation =
    slabs.length > 0
      ? Math.max(...slabs.filter((s) => s.kind !== 'deck').map((s) => s.elevation))
      : 0
  const insidePoly = (
    p: readonly [number, number],
    poly: readonly (readonly [number, number])[],
  ): boolean => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i] as readonly [number, number]
      const [xj, zj] = poly[j] as readonly [number, number]
      if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi)
        inside = !inside
    }
    return inside
  }
  const wallDatum: WallDatum = {
    planeTopFor: (start, end) => {
      let plane = floorToFloor
      for (const slab of coveringSlabs) {
        const underside = floorToFloor + (slab.elevation - slab.thickness)
        if (underside >= plane) continue
        // the wall runs under the slab when any of five stations along its centreline does
        let covered = false
        for (let i = 0; i <= 4 && !covered; i++) {
          const t = 0.1 + 0.2 * i
          const p: [number, number] = [
            start[0] + (end[0] - start[0]) * t,
            start[1] + (end[1] - start[1]) * t,
          ]
          covered = insidePoly(p, slab.polygon) && !slab.holes.some((h) => insidePoly(p, h))
        }
        if (covered) plane = underside
      }
      return plane
    },
    supportBaseFor: (slabId) => {
      const slab = slabs.find((s) => s.id === slabId)
      return slab ? slab.elevation - slabTopElevation : null
    },
  }
  const rawWalls = extractWalls(nodes, levelId, probeSlabs, hasLowerStorey, wallDatum)
  // Walls standing below the plate line (on the garage pad): their members
  // are framed from y = 0 like any wall and moved down onto their slab at
  // the end (`baseYById`); the foundation reads `baseY` itself.
  const baseYById = new Map<string, number>()
  for (const w of rawWalls) if (w.baseY !== undefined) baseYById.set(w.id, w.baseY)
  const { walls, duplicateOf } = dedupeColinearWalls(rawWalls)
  if (duplicateOf.size > 0) {
    warnings.push(
      `${duplicateOf.size} duplicate overlapping wall${duplicateOf.size > 1 ? 's' : ''} skipped (framed once, not twice)`,
    )
  }
  // Zone twins (S8 class): duplicated zones sharing a polygon collapse to
  // ONE room at extraction — a twin used to make the honesty warnings
  // contradict the sheets ('countertop not modeled' for the sink-less twin
  // while the other twin's counter run was drawn) and welded B13's false
  // traveler. Say so, like the wall dedupe above.
  const zoneTwins: { kept: string; dropped: string }[] = []
  const rooms = extractRooms(nodes, levelId, zoneTwins)
  for (const twin of zoneTwins) {
    warnings.push(
      `duplicate zone “${twin.dropped}” shares “${twin.kept}”'s polygon — merged (classified once, not twice)`,
    )
  }
  // R314 never drops silently (round-2 advisory + day-9 head-noun): a
  // LEADING outdoor qualifier ('Outdoor bedroom') OR an outdoor HEAD NOUN
  // ('Master terrace', 'Bedroom terrace') can classify a sleeping-word
  // name outdoors, which strips its smoke alarm — the check keys on the
  // RESULT (category + name), so every path that lands a sleeping-word
  // name in 'outdoor' speaks; 'Garden bedroom' stays indoors (head noun)
  // and stays silent. Say so.
  for (const room of rooms) {
    if (room.category === 'outdoor' && SLEEPING_NAME_RE.test(room.name)) {
      warnings.push(
        `zone “${room.name}” reads as open-air — no smoke alarm placed (R314); rename if it is conditioned space`,
      )
    }
  }

  const members: Member[] = []
  const fixtures: Fixture[] = []

  // A wall overridden to 'skip' is excluded from EVERY system — no framing,
  // no foundation under it, no devices on it. It's "not real construction".
  const activeWalls = walls.filter(
    (wall) => wallConstruction(wall, config, profile.exteriorWallDefault) !== 'skip',
  )
  // Rooms must not reference skipped walls either: plumbing anchors its wet
  // wall (and electrical its garage panel) through `boundaryWallIds`, and a
  // dangling id would starve the engines' nearest-wall fallbacks.
  const activeWallIds = new Set(activeWalls.map((wall) => wall.id))
  const activeRooms = rooms.map((room) =>
    room.boundaryWallIds.every((id) => activeWallIds.has(id))
      ? room
      : { ...room, boundaryWallIds: room.boundaryWallIds.filter((id) => activeWallIds.has(id)) },
  )

  if (config.showWalls) {
    // Route walls as GROUPS so cross-wall fabrication (corner assemblies,
    // partition backing, CMU corner interlock) can see its neighbors.
    // MIXED walls (CMU below a course-snapped seam, framed above) join
    // neither group's corner fabrication — they BUTT at shared corners/tees
    // instead (both zones inset to the neighbor's near face, per-corner
    // advisory), so mixedCmuWall gets the full active-wall neighbor context.
    const framed: WallSlice[] = []
    /** Steel (LGS, IRC R603) walls — Phase 1: their SKELETON frames in the
     * steel engine; their layer stack (sheathing/drywall/WRB/cladding/
     * batts) rides the same layer pass as lumber walls, so sheet-goods
     * members and areas stay byte-equal to a framed twin (F1). */
    const steel: WallSlice[] = []
    /** framed + steel in the ORIGINAL wall order — the shared hint graph,
     * the junction warnings and the layer pass all consume this list so a
     * construction flip never reorders another wall's output. */
    const assemblies: WallSlice[] = []
    const masonry: WallSlice[] = []
    const mixed: { wall: WallSlice; seam: number }[] = []
    // Per-wall engineering (studSize/spacingIn/insulation/cladding…) rides
    // to the framed-wall engines keyed by wall id — resolved once here so
    // frameWalls and layoutWallLayers consume the identical fields.
    const engineering = new Map<string, ResolvedWallConstruction>()
    for (const wall of activeWalls) {
      if (wall.curved) {
        warnings.push(`Curved wall skipped (framing for curved walls lands later)`)
        continue
      }
      const resolved = resolveWallConstruction(wall, config, profile.exteriorWallDefault)
      const { construction, cmuHeightM } = resolved
      if (construction === 'cmu' && cmuHeightM !== undefined) {
        // Snap HERE so a height at/above every course that fits routes the
        // wall down today's full-height path (regression guarantee).
        const seam = snapCmuHeight(cmuHeightM, wall.height)
        if (seam > 0 && courseCount(seam) < courseCount(wall.height)) {
          mixed.push({ wall, seam })
          continue
        }
      }
      if (construction === 'cmu') masonry.push(wall)
      else if (framedAssembly(construction)) {
        // 'framed' AND 'lgs' share the framed-ASSEMBLY path (layers, areas,
        // engineering, junction warnings); the skeleton splits below —
        // lumber walls to frameWalls, steel walls to lgsFrameWalls — over
        // ONE shared hint graph so corners/tees compose across materials.
        // Both lists keep the activeWalls scan order, and `assemblies`
        // below re-joins them IN that order so the layer pass emits
        // byte-identically to a construction flip (F1 layer parity).
        if (construction === 'lgs') steel.push(wall)
        else framed.push(wall)
        assemblies.push(wall)
        engineering.set(wall.id, resolved)
        // An EXPLICIT stud override deeper than the drawn wall can hold
        // still warns — the geometry now draws CAVITY-FIT (compressed to
        // thickness − 1", the batt rule extended to lumber; night-4), so
        // the message names the compression instead of a clash.
        if (resolved.studSize) {
          const depth = LUMBER_CROSS_SECTIONS[resolved.studSize][1]
          // 2mm tolerance (the SAT skin): the textbook 0.114m partition is
          // 0.3mm shy of a true 4.5" assembly and must NOT warn on 2x4
          // (verify round: false positive on the standard wall).
          if (depth > wall.thickness - inches(1) + 0.002) {
            warnings.push(
              `Wall ${wall.id}: ${resolved.studSize} studs (${depth.toFixed(2)}m) exceed the ` +
                `${wall.thickness.toFixed(2)}m drawn wall — framing is drawn compressed to ` +
                `${formatIn(wall.thickness - inches(1))}; deepen the wall to ` +
                `${(depth + inches(1) - 0.002).toFixed(2)}m for true ${resolved.studSize} or drop to 2x4`,
            )
          }
        }
      }
    }
    // Lumber + steel walls share ONE junction/hint graph: corners and tees
    // between the two materials resolve through the same through/butt
    // conventions (cap-plate laps excepted — wood never laps onto a steel
    // top track; frameHints suppresses those deltas at mixed-material
    // corners). Scenes with no steel walls see the identical list.
    // Junction honesty (night-5 skeptic d1/e): the tee detector's
    // parallelism guard (cross < 0.3) means a NEAR-PARALLEL contact gets
    // no junction treatment AT ALL — warn instead of silently framing
    // through it; and a stem SHORTER than its junction insets re-extends
    // to the 4t minimum run — honest geometry, never silent.
    for (const stem of assemblies) {
      for (const which of ['start', 'end'] as const) {
        const p = which === 'start' ? stem.start : stem.end
        for (const other of assemblies) {
          if (other.id === stem.id || other.curved) continue
          const cross = Math.abs(stem.dir[0] * other.dir[1] - stem.dir[1] * other.dir[0])
          if (cross >= 0.3) continue // real tees handle themselves
          const proj =
            (p[0] - other.start[0]) * other.dir[0] + (p[1] - other.start[1]) * other.dir[1]
          if (proj < other.thickness || proj > other.length - other.thickness) continue
          const fx = other.start[0] + other.dir[0] * proj
          const fz = other.start[1] + other.dir[1] * proj
          const dist = Math.hypot(p[0] - fx, p[1] - fz)
          if (dist > (other.thickness + stem.thickness) / 2 + 0.001) continue
          warnings.push(
            `Wall ${stem.id}: near-parallel contact with ${other.id} (< ~17°) — not framed as a junction, verify the drawing`,
          )
        }
      }
    }
    {
      const hintMap = frameHints(assemblies, spec, engineering)
      for (const w of assemblies) {
        const h = hintMap.get(w.id)
        if (!h) continue
        const insetSum = (h.startInset ?? 0) + (h.endInset ?? 0)
        const minRun =
          4 * LUMBER_CROSS_SECTIONS[studSizeFor(w, specForWall(spec, engineering.get(w.id)))][0]
        if (insetSum > 0 && w.length - insetSum < minRun) {
          warnings.push(
            `Wall ${w.id}: run shorter than its junction insets — framing re-extends to the ${(minRun * 100).toFixed(0)}cm minimum, verify`,
          )
        }
      }
    }
    // Ground level = slab-on-grade in this model (the foundation owns the
    // slab): bottom plates bear directly on concrete, so frameWalls emits
    // them as PT sole plates (IRC R317.1(2), LOD-400 audit B5). Upper
    // storeys bear on framed floors and keep untreated plates. Mixed CMU
    // walls are untouched — their framed zone bears on the PT seam sill,
    // which already books PT (cmu.ts).
    // B9 round 2: the CS-PF portal minimum widens to 24" under a SECOND
    // storey (Figure R602.10.6.4 first-of-two-storeys) — plumb the REAL
    // storey context instead of assuming: a slabbed level above this one
    // in the same building is a storey; an attic/roof level (no slabs)
    // is not.
    const levelAbove = levels[levelIndex + 1]
    const storeyAbove = levelAbove !== undefined && extractSlabs(nodes, levelAbove.id).length > 0
    // Walls on their own slab below the plate line (the garage pad beside
    // a raised platform) bear on concrete whatever the level does.
    const slabBearingIds = new Set(
      [...baseYById].filter(([, y]) => y < 0 && isGroundLevel).map(([id]) => id),
    )
    if (slabBearingIds.size > 0 && raisedFloor) {
      warnings.push(
        `${slabBearingIds.size} wall${slabBearingIds.size === 1 ? '' : 's'} on the garage pad at grade — framed down to the pad (${formatIn(-Math.min(...[...baseYById.values()]))} below the platform) on a PT sole plate, stemwall to the pad`,
      )
    }
    members.push(
      ...frameWalls(framed, spec, engineering, {
        // A raised floor's plates sit on the platform, not on concrete.
        slabBearing: isGroundLevel && !raisedFloor,
        ...(slabBearingIds.size > 0 ? { slabBearingIds } : {}),
        storeyAbove,
        // Steel neighbors participate in the corner/tee hint graph so a
        // lumber wall butting a steel one insets exactly like it would
        // against lumber (identical when `steel` is empty).
        ...(steel.length > 0 ? { hintWalls: assemblies } : {}),
      }),
    )
    // Steel (LGS) skeletons — IRC R603 C-stud/track assemblies from the
    // cited catalog (Phase 1). Same hint graph as above; per-level honesty
    // (conservative mil selection, R603.1.1 applicability, machine status)
    // rides the warnings channel.
    if (steel.length > 0) {
      const storeys = levels.filter(
        (l, i) => i === 0 || extractSlabs(nodes, l.id).length > 0,
      ).length
      const lgs = lgsFrameWalls(steel, spec, engineering, {
        hintWalls: assemblies,
        slabBearing: isGroundLevel && !raisedFloor,
        groundSnowLoadPsf: profile.groundSnowLoadPsf,
        ultimateWindMph: profile.ultimateWindMph,
        storeys,
        // masonry neighbors (full-CMU + mixed) — strap runs trim clear of
        // their bodies (round-1 F4d; the hint graph is masonry-blind)
        cmuNeighbors: [...masonry, ...mixed.map((mx) => mx.wall)],
      })
      members.push(...lgs.members)
      warnings.push(...lgs.warnings)
    }
    // Assembly layers (round 13): drywall / sheathing / WRB / cladding per
    // face, jurisdiction-defaulted cladding + climate labels. The renderer's
    // dollhouse cut hides the camera-facing stacks. Probe slabs (widened to
    // the storey below on slab-less levels) — exteriorSide needs the same
    // inside/outside signal the exterior fallback used. Steel (LGS) walls
    // ride the SAME pass: their sheet-goods stack is byte-identical to a
    // framed twin's (F1 — the batt layout is steel-aware via the
    // engineering map's construction).
    members.push(...layoutWallLayers(assemblies, activeRooms, spec, code, probeSlabs, engineering))
    members.push(...cmuWalls(masonry, spec))
    for (const { wall, seam } of mixed) {
      const neighbors = activeWalls.filter((w) => w.id !== wall.id && !w.curved)
      const result = mixedCmuWall(wall, spec, seam, neighbors)
      members.push(...result.members)
      warnings.push(...result.warnings)
    }
    if (mixed.length > 0) {
      // Layers v1: unchanged per wall — a mixed wall keeps the CMU
      // treatment (no framed-zone sheathing/drywall split at the seam).
      warnings.push(
        `${mixed.length} mixed CMU/framed wall${mixed.length > 1 ? 's' : ''}: assembly layers follow the CMU treatment for the whole wall (v1)`,
      )
    }
    // Wall bracing declaration (R602.10, LOD-400 B9): braced wall lines are
    // identified from the LUMBER-framed exterior graph and each declares
    // CS-WSP as its method with an honest not-verified assumption flag —
    // the required panel length/spacing is panel-schedule math (v2). CMU
    // walls brace as reinforced masonry (cmu.ts), never CS-WSP, and STEEL
    // (LGS) walls stay out too — R602.10 is the wood method; their R603.9
    // shear story is a per-level honesty warning from lgsFrameWalls. LOD
    // 200 emits nothing (no code claims).
    warnings.push(...bracingWarnings(framed, spec))
  }

  // Rooms with no flooring at all deserve a call-out regardless of level
  // (quality round-2: a phantom room had no slab and nothing said so).
  if (slabs.length > 0) {
    const inPoly = (
      p: readonly [number, number],
      poly: readonly (readonly [number, number])[],
    ): boolean => {
      let inside = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i] as readonly [number, number]
        const [xj, zj] = poly[j] as readonly [number, number]
        if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi)
          inside = !inside
      }
      return inside
    }
    for (const room of activeRooms) {
      // OUTDOOR zones need no floor slab — a garden/terrace/yard over bare
      // ground is not a defect, and the warning read as one (M4, day-9
      // advisory: 'Room "Back garden" has no floor slab under it' beside a
      // house whose garden is grass). Indoor rooms keep the call-out.
      if (room.category === 'outdoor') continue
      const c = room.polygon.reduce<[number, number]>(
        (acc, p) => [acc[0] + p[0] / room.polygon.length, acc[1] + p[1] / room.polygon.length],
        [0, 0],
      )
      // Sample the centroid AND points nudged toward vertices: a centroid
      // landing exactly on a slab corner ray-casts as covered
      // (quality round-3 — the warning never fired).
      const samples: [number, number][] = [c]
      for (const v of room.polygon.slice(0, 4)) {
        samples.push([c[0] + (v[0] - c[0]) * 0.5, c[1] + (v[1] - c[1]) * 0.5])
      }
      const covered = samples.filter((pt) => slabs.some((sl) => inPoly(pt, sl.polygon))).length
      if (covered <= samples.length / 2) {
        warnings.push(`Room "${room.name}" has no floor slab under it`)
      }
    }
  }

  // What each slab node IS (SlabKind, from the generator's `metadata.floor`
  // tag): the storey floor, concrete at its own elevation (a garage pad or
  // porch slab at grade beside a raised house), or a wood deck. Decks are
  // framed by the deck engine on every level and never poured; 'slab'
  // kinds are poured by the foundation and never framed; only the floor
  // kind is a platform on a raised house.
  const deckSlabs = slabs.filter((s) => s.kind === 'deck')
  const pouredSlabs = slabs.filter((s) => s.kind !== 'deck')
  const platformSlabs = slabs.filter((s) => s.kind !== 'deck' && s.kind !== 'slab')

  // The ground level's own framed platform (raised floor) — its girder posts
  // need pads from the foundation pass below.
  let groundPlatform: Member[] = []
  // Decks (PlanCrafters F.deck / W10b): PT joists on a ledger at the house
  // wall, rims, a dropped 4x8 beam on 4x4 posts down to the grade below
  // (the yard on a ground storey, the storey below's floor plane on an
  // upper one — a balcony deck stands on posts too). Their posts get pads
  // from the foundation pass like the platform's girder posts.
  const deckMembers: Member[] = []
  if (config.showFloor) {
    if (isGroundLevel && raisedFloor) {
      // RAISED floor: the platform hangs under the floor slab node (the
      // subfloor) exactly like an upper storey's — joists, rim, girders —
      // and its posts run down to the crawl grade, where the foundation
      // pours their pads.
      if (platformSlabs.length === 0) {
        warnings.push('No floor platform on this level — rooms have no floor to derive')
      } else {
        groundPlatform = frameFloor(platformSlabs, activeWalls, spec, Math.max(0.1, -gradeY))
        members.push(...groundPlatform)
        warnings.push(
          `Ground floor is a framed platform over a crawl space (finish floor ${Math.round(foundation.ffAboveGradeM / 0.0254)}" above grade) — joists on a PT mudsill on the stemwall, girder posts on pads, Class I ground cover (R408)`,
        )
      }
    } else if (isGroundLevel) {
      // Ground floors are slab-on-grade here — the FOUNDATION owns that
      // geometry, and since B17 it actually BUILDS it (slab field members +
      // vapor retarder, buildFoundation). Say so instead of silently doing
      // nothing (quality A4: the toggle looked dead), and call out rooms
      // with no slab at all. Gate: the warning names geometry that exists
      // (compute.multistorey.test.ts B17).
      if (slabs.length === 0) {
        warnings.push('No floor slabs on this level — rooms have no floor to derive')
      } else if (config.showFoundation) {
        warnings.push(
          'Ground floor is slab-on-grade — the Foundation system draws the slab field, vapor retarder and footings',
        )
      } else {
        // Foundation toggled OFF: the pointed-at geometry is not in this
        // result — the wording must not promise members that aren't drawn
        // (skeptic rider, B17 round 1; pinned in compute.multistorey B17).
        warnings.push(
          'Ground floor is slab-on-grade — enable Foundation to see the slab field, vapor retarder and footings',
        )
      }
    } else {
      // Host floor-to-floor is baseY delta (resolveLevelFloorToFloorHeight),
      // not the raw storey height — baseElevation offsets count too.
      const below = levels[levelIndex - 1]
      const storeyBelowHeight = below ? (levels[levelIndex]?.baseY ?? 0) - below.baseY : 2.4
      members.push(...frameFloor(pouredSlabs, activeWalls, spec, storeyBelowHeight))
    }
    if (deckSlabs.length > 0) {
      const below = levels[levelIndex - 1]
      const deckGrade = isGroundLevel
        ? gradeY
        : -(
            (levels[levelIndex]?.baseY ?? 0) -
            (below?.baseY ?? (levels[levelIndex]?.baseY ?? 0) - 2.4)
          )
      for (const deck of deckSlabs)
        deckMembers.push(...frameDeck(deck, activeWalls, spec, deckGrade).members)
      members.push(...deckMembers)
      warnings.push(
        `${deckSlabs.length === 1 ? 'A wood deck' : `${deckSlabs.length} wood decks`} framed — PT joists hung on a ledger at the house, a beam (dropped 4x8, or a flush doubled rim on a low deck) on 4x4 posts to grade, pads under the posts (IRC R507)`,
      )
    }
  }

  if (config.showRoof) {
    // Roof segments live wherever the designer drew them — porch roofs on
    // the ground level, the main roof on its own level on top. ONE X-ray
    // per building frames ALL of them (re-verify round: a single owner that
    // stopped at the first roof-bearing level framed the main roof and
    // orphaned the porch); everyone else says where to look. Ownership =
    // highest storey with showRoof on, tie by id — building-scoped.
    const levelRoofs = levels
      .map((l) => ({ level: l, roofs: extractRoofs(nodes, l.id) }))
      .filter((entry) => entry.roofs.length > 0)
    if (levelRoofs.length > 0) {
      const rivals = Object.values(nodes).filter(
        (n) =>
          n.type === config.type &&
          n.showRoof !== false &&
          typeof n.parentId === 'string' &&
          levels.some((l) => l.id === n.parentId),
      )
      const ordinalOf = (n: Record<string, unknown>) =>
        levels.find((l) => l.id === n.parentId)?.level ?? Number.NEGATIVE_INFINITY
      const owner =
        rivals.length > 0
          ? rivals.reduce((best, n) => {
              const a = ordinalOf(n)
              const b = ordinalOf(best)
              if (a > b) return n
              if (a === b && String(n.id) < String(best.id)) return n
              return best
            })
          : null
      if (owner && String(owner.id) !== String(config.id)) {
        warnings.push('Roof is framed by the X-ray on another storey')
      } else {
        // Members come out roof-LEVEL-local and STAY that way: a baked
        // storey offset is only right in stacked view — exploded mode moves
        // each level +5 m per ordinal and solo hides whole level groups, so
        // cross-level members are TAGGED with their source level instead
        // and the renderer mounts them into that level's own Object3D
        // (prod 2026-08-15 rounds 1-2: roof at ground level, then trusses
        // detached from the roof in exploded/solo). Foreign members whose
        // source level sits strictly ABOVE this owner also carry
        // strataAbove — the renderer's exploded roof stratum applies only
        // to those (a ground-storey porch roof below the owner must never
        // drop into the storey under it — verify round 2026-08-16, F1).
        // Unknown owner ordinal (dangling parentId) = nothing above: flush
        // is the safe default.
        const myOrdinal = levels[levelIndex]?.level ?? Number.POSITIVE_INFINITY
        for (const { level, roofs } of levelRoofs) {
          const framed = frameRoofs(roofs, activeWalls, spec)
          // B8c: segment pairs the valley detector does NOT serve (a hip
          // wing into a gable main, skewed/parallel/buried gable pairs)
          // frame straight through with no members — that gap must PRINT,
          // never ride a docblock. One warning per unserved overlapping
          // pair; LOD 200 stays schematic (valleys aren't framed there
          // either — no code claims).
          if (spec.detail !== '200') {
            warnings.push(...detectUnframedRoofIntersections(roofs))
          }
          members.push(
            ...(level.id === levelId
              ? // Owner ON the roof level (F1b, user prod report: trusses rode
                // the shell as ONE exploded layer): when the owner's level is
                // a true attic/roof storey (no rooms, no slabs, and a storey
                // BELOW it — an in-progress walls-only ground level is not an
                // attic), its own roof members still form the carpentry
                // stratum. mountLevelId is RENDER-ONLY: the sheets draw these
                // owner-local (re-verify: the levelId tag double-lifted them
                // on elevations). A lived storey's porch roof stays flush.
                slabs.length === 0 && rooms.length === 0 && hasLowerStorey
                ? framed.map((m) => ({ ...m, mountLevelId: level.id, strataAbove: true as const }))
                : framed
              : framed.map((m) =>
                  level.level > myOrdinal
                    ? { ...m, levelId: level.id, strataAbove: true as const }
                    : { ...m, levelId: level.id },
                )),
          )
        }
      }
    }
  }

  // B10 uplift-path honesty at the roof seam: high-wind wall connectors
  // under a roof that frames rafters with ZERO hurricane ties (every
  // framed shape calls tieAt since B8b — this fires only on future
  // tie-less shapes) warn per roof — the wall
  // continues a path the roof never starts, and that must be SAID (P4
  // prints it), never implied. Results with no roof members stay silent
  // (a toggled-off / other-storey roof is not missing hardware — B9c).
  warnings.push(...upliftPathWarnings(members))

  if (config.showFoundation && isGroundLevel) {
    // B18b: CMU-based walls (full-CMU and mixed knee walls) carry no sole
    // plate at the foundation top — the foundation swaps their R403.1.6
    // bolt kit for #5 dowels lapping the wall's own grouted-cell verticals
    // (one layout truth: cmu.ts cmuDowelPositions). Mixed walls keep their
    // seam-sill bolts on the bond beam (cmu.ts).
    const cmuAnchorage = new Map<string, CmuDowelLayout>()
    for (const wall of activeWalls) {
      if (wall.curved) continue
      const resolved = resolveWallConstruction(wall, config, profile.exteriorWallDefault)
      if (resolved.construction !== 'cmu') continue
      const neighbors = activeWalls.filter((w) => w.id !== wall.id && !w.curved)
      cmuAnchorage.set(wall.id, cmuDowelPositions(wall, resolved.cmuHeightM, neighbors))
    }
    // B18d: the storey ABOVE's girder 4x4 posts land on this level's floor
    // plane — derive their plan spots from the same floor-framing pass the
    // upper storey renders (walls only sister joists, so [] reproduces the
    // girder/post layout exactly) and pour an R403.1/R407.3 pad under each
    // (buildFoundation carves the slab field around them).
    const girderPosts: { plan: readonly [number, number]; sourceId: string }[] = []
    const above = levels[levelIndex + 1]
    if (above) {
      const aboveSlabs = extractSlabs(nodes, above.id)
      if (aboveSlabs.length > 0) {
        const storeyHeight = above.baseY - (levels[levelIndex]?.baseY ?? 0)
        for (const m of frameFloor(aboveSlabs, [], spec, storeyHeight)) {
          if (m.role !== 'post') continue
          girderPosts.push({ plan: [m.position[0], m.position[2]], sourceId: m.sourceId })
        }
      }
    }
    // A raised floor's OWN girder posts bear on pads at the crawl grade too,
    // and so do the deck posts (R507.3: a footing under every deck post).
    for (const m of groundPlatform) {
      if (m.role === 'post')
        girderPosts.push({ plan: [m.position[0], m.position[2]], sourceId: m.sourceId })
    }
    for (const m of deckMembers) {
      if (m.role === 'post')
        girderPosts.push({ plan: [m.position[0], m.position[2]], sourceId: m.sourceId })
    }
    // The stemwall tops out under the platform: the lowest joist / rim bottom
    // less the mudsill.
    let raised: { stemTop: number; sillWidth: number } | undefined
    if (raisedFloor && groundPlatform.length > 0) {
      let joistBottom = Number.POSITIVE_INFINITY
      for (const m of groundPlatform) {
        if (m.role !== 'joist' && m.role !== 'rim-joist') continue
        joistBottom = Math.min(joistBottom, m.position[1] - m.dims[1] / 2)
      }
      if (Number.isFinite(joistBottom)) {
        raised = {
          stemTop: joistBottom - inches(1.5),
          sillWidth: LUMBER_CROSS_SECTIONS[spec.exteriorStudSize][1],
        }
      }
    }
    members.push(
      ...buildFoundation(activeWalls, pouredSlabs, spec, {
        cmu: cmuAnchorage,
        girderPosts,
        gradeY,
        raised,
      }),
    )
    // B9c: tie the foundation's SDC-D hold-downs to the wall framing above
    // them, both directions (a hold-down with no post above / a portal post
    // with no hold-down below gets flagged). Only when BOTH systems are in
    // this result — a toggled-off system is not missing hardware.
    if (config.showWalls) {
      crossReferenceHoldDowns(members)
      // B10c: a plate-to-foundation uplift strap where the foundation's
      // R403.1.6 J-bolt (or a seismic HDU) already clamps the plate is the
      // SAME anchorage point — the bolt wins, the strap dedupes; surviving
      // straps fill the runs between bolts. Walls-only results keep the
      // full ladder (same toggle honesty as the cross-ref above).
      dedupeFoundationStraps(members)
    }
  }

  // bones:service nodes on this level are AUTHORITATIVE — the engines route
  // to them instead of auto-placing (checklist A4); reactivity is free since
  // computeLevel re-runs on any node change. Duplicate nodes of one type:
  // lowest id wins, the extras are called out.
  const core = extractServiceOverrides(nodes, levelId)
  const extra = extractExtraServiceOverrides(nodes, levelId)
  const services: ServiceOverrides = { ...core.overrides, ...extra.overrides }
  for (const dup of [...core.duplicates, ...extra.duplicates].sort()) {
    warnings.push(`duplicate service point (${dup}) — extra node ignored`)
  }

  // Placed sanitary items (toilet/shower/sinks…) — extracted ONCE: the
  // electrical layout consumes them for the 210.8(A)(7)/(9) sink-radius
  // GFCI flip + counter/basin receptacles (B14), plumbing for its demand
  // points, and the B12 GES water-bond check reuses the same slice.
  const placedFixtures = extractPlacedFixtures(nodes, levelId)

  let devices: DerivedDevice[] = []
  if (config.showElectrical) {
    // B13a: layout-level warnings (un-placeable R314.3(2)/R315.3 alarms)
    // surface with the level warnings — never a silent drop.
    const derived = layoutElectrical(activeWalls, activeRooms, services, warnings, placedFixtures)
    // Movable outlets (Q7): moved `bones:device` nodes override the derived
    // receptacle/switch spots — code-aware (RO snap-out, stud rule +
    // blocking, height clamps, spacing advisory). Unmoved nodes are ignored
    // by construction (device/overrides.ts), so a scene of untouched nodes
    // computes byte-equal to a node-less one. The blocking members join the
    // wall framing; the wiring below consumes the POST-override positions.
    const deviceExtraction = extractDeviceOverrides(nodes, levelId)
    for (const dup of deviceExtraction.duplicates) {
      warnings.push(`duplicate device node (${dup}) — extra node ignored`)
    }
    const applied = applyDeviceOverrides(
      derived,
      activeWalls,
      activeRooms,
      members,
      deviceExtraction.overrides,
      { rawWalls, duplicateOf: Object.fromEntries(duplicateOf) },
    )
    const electrical = applied.fixtures
    splitBattsAroundBlocking(members, applied.members)
    members.push(...applied.members)
    warnings.push(...applied.warnings)
    fixtures.push(...electrical)
    // B13 round-2 (E6 honesty): compute is per-LEVEL, so every storey mints
    // its OWN panel + its OWN SD-1 — the modeled interconnect stops at the
    // storey line, while IRC R314.4 requires interconnection across the
    // DWELLING. When sibling storeys of this building carry rooms (they
    // place their own alarms), say so — six alarms must never claim one
    // chain with zero cable between floors. Member labels carry the same
    // scope: 'alarm interconnect (this storey)'.
    if (
      electrical.some((f) => f.kind === 'smoke-alarm' || f.kind === 'co-alarm') &&
      levels.some((l, i) => i !== levelIndex && extractRooms(nodes, l.id).length > 0)
    ) {
      warnings.push(
        'alarm interconnect modeled per storey — R314.4 requires interconnection across the dwelling; verify the cross-storey chain',
      )
    }
    // The device manifest the bones:device reconciler mirrors into nodes —
    // built from the same walls + final fixtures the engines used.
    devices = deriveWallDevices(electrical, activeWalls)
    // Panel override forced into a door/window RO → explicit warning
    // (NEC 110.26 working space — placePanel skips panelMountU's scan).
    const panelFx = electrical.find((f) => f.kind === 'panel')
    if (panelFx) {
      const warn = serviceOverrideRoWarning(
        activeWalls,
        services.panel,
        'panel',
        panelFx.position[1],
        ' (NEC 110.26)',
      )
      if (warn) warnings.push(warn)
    }
    // Electric-meter override parity: the meter mounts verbatim too, so an
    // override into a window RO must warn exactly like the panel's (skeptic
    // 2026-08-16: tstat + meter overrides sat in ROs silently).
    const meterFx = electrical.find((f) => f.kind === 'electric-meter')
    if (meterFx) {
      const warn = serviceOverrideRoWarning(
        activeWalls,
        services.electricMeter,
        'electric-meter',
        meterFx.position[1],
      )
      if (warn) warnings.push(warn)
    }
    // LOD 400: homerun + branch wiring following the walls to the panel.
    if (spec.detail === '400') {
      // B12 GES cross-trade seam: the NEC 250.104 water-pipe bond targets
      // the SAME entry point plumbing will use — the waterEntry service
      // node override (authoritative), else plumbing's OWN water-meter
      // auto-spot (`placeMeterSpot`) mirrored deterministically (plumbing
      // runs after electrical; the placed path emits its water-meter
      // fixture exactly there — parity gated). The room-category FALLBACK
      // plumbing models no water meter at all, so a fallback-path scene
      // has no entry to bond to: the engine LABELS the assumption on the
      // intersystem termination member and the level warns — never silent.
      const forcedEntry = overrideWallPoint(activeWalls, services.waterEntry)
      const plumbingModelsMeter = config.showPlumbing && placedFixtures.length > 0
      const entrySpot = forcedEntry
        ? {
            wall: forcedEntry.wall,
            u: forcedEntry.u,
            heightAff: services.waterEntry?.heightAff ?? 0.3,
          }
        : plumbingModelsMeter
          ? placeMeterSpot(activeWalls)
          : null
      let waterEntry: readonly [number, number, number] | null = null
      if (entrySpot) {
        const plan = wallPlan({ wall: entrySpot.wall, u: entrySpot.u })
        waterEntry = [plan[0], entrySpot.heightAff, plan[1]]
      } else if (panelFx && meterFx) {
        // Warn only where the GES actually lands (meter + panel = service).
        warnings.push(
          'water-pipe bond (NEC 250.104) not modeled — no water service entry visible; bond the metal water line at its entry',
        )
      }
      members.push(...routeWiring(electrical, activeWalls, { waterEntry, rooms: activeRooms }))
      // B12 round-3 F4 (the E6 honesty class): compute routes one LEVEL,
      // so every storey with a service chain mints its own GES — while a
      // dwelling service has ONE electrode system (NEC 250.53/250.58).
      // Sibling storeys with rooms mint their own chains; say so — the
      // exact mirror of the B13 per-storey interconnect warning above.
      if (
        panelFx &&
        meterFx &&
        levels.some((l, i) => i !== levelIndex && extractRooms(nodes, l.id).length > 0)
      ) {
        warnings.push(
          'grounding electrode system modeled per storey — a dwelling service has ONE electrode system (NEC 250.53/250.58); verify the single grade-level GES',
        )
      }
    }
  }

  if (config.showPlumbing) {
    // Placed sanitary items are the demand points; the engine's
    // room-category inference is only the fallback (slice hoisted above —
    // shared with the electrical sink-radius/counter/basin machinery).
    const plumbing = layoutPlumbing(
      activeWalls,
      activeRooms,
      spec,
      placedFixtures,
      services,
      isGroundLevel,
    )
    members.push(...plumbing.members)
    fixtures.push(...plumbing.fixtures)
    // Upper storeys have no foundation and no sewer: the buried tree hangs
    // in the floor cavity and its main ends at a riser nobody models yet —
    // never silent (skeptic S2; the soffit-duct warning pattern).
    if (!isGroundLevel && plumbing.members.some((m) => m.sourceId.startsWith('dwv-'))) {
      warnings.push(
        'Upper-storey drains need a riser to the storey below — not modeled; runs shown end at the drain main',
      )
    }
    // The room-category fallback's WH is a SCHEMATIC placeholder — the
    // placed-fixture path ships real T&P/pan/stand/strap members (P6); the
    // fallback cannot (no tank member to hang them off). Never silent
    // (B20 closing round): the level states exactly what is not modeled.
    if (plumbing.fixtures.some((f) => f.kind === 'water-heater' && f.meta?.schematic === true)) {
      warnings.push(
        'Water-heater safety hardware not modeled on the schematic (room-category) path — T&P valve + discharge, drain pan, seismic strapping per P2803/P2801; place real fixtures or verify at install',
      )
    }
    // WH / water-entry overrides forced into an RO → same explicit warning
    // (the pipe legs already flag, but the service POINT must too).
    const roChecks = [
      { override: services.waterHeater, kind: 'water-heater', label: 'water-heater' },
      { override: services.waterEntry, kind: 'water-meter', label: 'water-entry' },
    ] as const
    for (const { override, kind, label } of roChecks) {
      const fx = plumbing.fixtures.find((f) => f.kind === kind)
      if (!fx) continue
      const warn = serviceOverrideRoWarning(activeWalls, override, label, fx.position[1])
      if (warn) warnings.push(warn)
    }
    // Cross-level stacks land later — each level owns its fixtures for now.
    if (allLevels.some((l) => l.id !== levelId && extractPlacedFixtures(nodes, l.id).length > 0)) {
      warnings.push(
        'Placed plumbing fixtures on another storey — X-ray that level for its plumbing',
      )
    }
  }

  if (config.showHvac) {
    // Thermostat / heat-pump service nodes are authoritative here too —
    // the tstat re-mounts and the outdoor unit + lineset re-anchor.
    // A LIVED-IN level above means this is an interior storey: no attic —
    // layoutHvac caps the trunk as a dropped-soffit run and warns
    // (checklist M1). A roof/attic level above — even one carrying GABLE
    // walls — IS the attic (re-verify round: gable end walls flipped the
    // gabled starter house to soffit routing with a spurious warning), so
    // only levels with rooms or slabs count as storeys.
    const hasLevelAbove =
      levelIndex >= 0 &&
      levels.slice(levelIndex + 1).some((l) => {
        const lived = extractSlabs(nodes, l.id).length > 0 || extractRooms(nodes, l.id).length > 0
        if (!lived) return false
        return Object.values(nodes).some(
          (n) => n.type === 'wall' && n.parentId === l.id && n.visible !== false,
        )
      })
    // Coverage for the condenser-spot validation: the SAME probe the wall
    // classification uses (probeSlabsFor — A4 parity), so "under floor
    // coverage" means exactly "inside the footprint the election trusted".
    const hvac = layoutHvac(activeWalls, activeRooms, spec, services, {
      hasLevelAbove,
      stateCode: code,
      coverage: probeSlabs,
    })
    members.push(...hvac.members)
    fixtures.push(...hvac.fixtures)
    warnings.push(...hvac.warnings)
    // UPPER-STOREY CONDENSER TRUTH (condenser-honesty set F2, hunt 4a):
    // compute is per-LEVEL, so this storey's condenser row mints at ITS
    // level-local grade — an upper-storey X-ray draws the "outdoor" unit at
    // facade height (world y ≈ storey base + pad). The cross-level mounting
    // machinery (Member.levelId — the B6/B7 roofs ride it) could drop the
    // row's MEMBERS into the ground storey's frame, but its FIXTURES
    // (condenser + disconnect) cannot follow — the renderer mounts foreign
    // MEMBERS only (buildGroups builds fixture-less foreign groups), so a
    // remount would split the unit from its own selectable fixture, and the
    // pad/whip/line-set drop legs would still need a facade riser to the
    // storey's wall penetration that the engine doesn't model. Honest
    // warning instead; grade mounting is queued on the board.
    if (!isGroundLevel && hvac.fixtures.some((f) => f.meta?.equipment === 'condenser')) {
      warnings.push(
        'condenser for this storey drawn at its floor elevation — grade mounting not modeled; verify',
      )
    }
    // Cross-trade coordination (post-merge seam round): the line-set pair
    // rides a lateral off the plumbing plane, but a 3" DWV stack is wider
    // than the wall cavity lets it dodge and thin-wall runs clamp back onto
    // the shared plane — any residual crossing gets a coordinate-trades
    // flag on the member, never a silent bore (M2). Plumbing landed its
    // members earlier in this pass, so the scan sees both trades.
    if (config.showPlumbing) flagLinesetTradeCrossings(members)
    // Thermostat override parity: same RO warning the panel/WH/water-entry
    // overrides get — the tstat mounts verbatim, never silently in a window.
    const tstatFx = hvac.fixtures.find((f) => f.kind === 'thermostat')
    if (tstatFx) {
      const warn = serviceOverrideRoWarning(
        activeWalls,
        services.thermostat,
        'thermostat',
        tstatFx.position[1],
      )
      if (warn) warnings.push(warn)
    }
    // AC "connection to power" (user ask): each condenser disconnect carries
    // a dedicated circuit (AC-n) — homerun it from the panel like any device.
    // The subset has NO meter fixture, so routeServiceCable inside bails and
    // the service entrance is never doubled.
    if (spec.detail === '400' && config.showElectrical) {
      const panelFx = fixtures.find((f) => f.kind === 'panel')
      const disconnects = hvac.fixtures.filter(
        (f) => f.kind === 'disconnect' && typeof f.meta?.circuit === 'string',
      )
      if (panelFx && disconnects.length > 0) {
        members.push(...routeWiring([panelFx, ...disconnects], activeWalls))
      }
    }
  }

  // MEP EMPTINESS HONESTY (condenser-honesty set F1 — the class behind the
  // second "I don't see the heat pump" prod report): HVAC + plumbing DERIVE
  // from rooms, so a level whose zones can't feed them composes ZERO
  // hvac/plumbing output while framing/electrical render fine — and nothing
  // said so (hunt classes 7a walls+slab+no-zones, 7b garage+hallway only,
  // 7c outdoor-only, 7d zones parented to the building, 4b/4c two-storey
  // zone/level mismatch, roof levels). Three honest classes, keyed off the
  // ACTUAL compose (a system that emitted anything is not silent; a
  // toggled-off system is not missing hardware — B9c convention):
  //  - no zones parented to this level at all (walls-only storeys, zones
  //    hung on the building node, the wrong storey X-rayed);
  //  - zones exist but ALL classify outdoor (the day-9 outdoor-category
  //    delta: these levels LOST a previously-drawn condenser honestly —
  //    garden zones no longer count as rooms — but silently);
  //  - indoor zones exist but none habitable (garage/hallway-only levels —
  //    layoutHvac's habitable filter is the same silent early-return).
  // One warning covering both systems (the alarm-interconnect grammar);
  // it reaches the panel Warnings drawer and the plan set's flags block on
  // the standard result.warnings channel.
  if (config.showHvac || config.showPlumbing) {
    const hvacSilent =
      config.showHvac &&
      !members.some((m) => m.system === 'hvac') &&
      !fixtures.some((f) => f.system === 'hvac')
    const plumbingSilent =
      config.showPlumbing &&
      !members.some((m) => m.system === 'plumbing') &&
      !fixtures.some((f) => f.system === 'plumbing')
    if (hvacSilent || plumbingSilent) {
      const indoor = activeRooms.filter((room) => room.category !== 'outdoor')
      const systems =
        hvacSilent && plumbingSilent
          ? 'HVAC + plumbing are'
          : hvacSilent
            ? 'HVAC is'
            : 'plumbing is'
      if (activeRooms.length === 0) {
        warnings.push(
          `no indoor zones on this level — ${systems} derived from rooms; draw zones here or X-ray the storey that has them`,
        )
      } else if (indoor.length === 0) {
        warnings.push('all zones on this level are outdoor — no conditioned space to serve')
      } else if (
        hvacSilent &&
        indoor.every((room) => room.category === 'garage' || room.category === 'hallway')
      ) {
        warnings.push(
          'no habitable rooms on this level (garage/hallway zones only) — HVAC has no conditioned space to serve' +
            (plumbingSilent ? '; plumbing found no wet rooms or placed fixtures' : ''),
        )
      }
    }
  }

  // ---- gross sheet-goods areas for the takeoff ----
  // Sheets are bought gross (openings are cut out of a full sheet), so the
  // areas are simple length × height / polygon sums over the ACTIVE walls.
  const areas: TakeoffAreas = { wallSheathingM2: 0, subfloorM2: 0, drywallM2: 0 }
  for (const wall of activeWalls) {
    if (wall.curved) continue
    const construction = wallConstruction(wall, config, profile.exteriorWallDefault)
    const faceArea = wall.length * wall.height
    // WSP sheathing wraps FRAMED-ASSEMBLY exterior walls only (CMU gets
    // stucco/furring). framedAssembly, not === 'framed': an 'lgs' wall
    // carries the identical sheet-goods stack on steel bones (screwed per
    // R603.2.5 instead of nailed), so booking it zero sheathing/drywall
    // would be the F1 silent under-buy — the areas are pinned byte-equal
    // to the framed twin's.
    if (wall.exterior && framedAssembly(construction)) {
      areas.wallSheathingM2 = (areas.wallSheathingM2 ?? 0) + faceArea
    }
    // Drywall: both faces of interior walls, the inside face of exterior
    // ones — framed-assembly walls only (LOD-400 audit B4 sibling): the layer
    // engine never sees masonry walls, so a CMU wall renders ZERO gypsum and
    // booking its faces was a ghost buy on every CMU scene. Mixed walls
    // resolve 'cmu' too and follow the CMU layer treatment whole-wall (v1).
    if (framedAssembly(construction)) {
      areas.drywallM2 = (areas.drywallM2 ?? 0) + faceArea * (wall.exterior ? 1 : 2)
    }
  }
  if (!isGroundLevel) {
    for (const slab of slabs) {
      let area = 0
      const ring = (poly: readonly (readonly [number, number])[]): number => {
        let sum = 0
        for (let i = 0; i < poly.length; i++) {
          const [x1, z1] = poly[i] as readonly [number, number]
          const [x2, z2] = poly[(i + 1) % poly.length] as readonly [number, number]
          sum += x1 * z2 - x2 * z1
        }
        return Math.abs(sum) / 2
      }
      area += ring(slab.polygon)
      for (const hole of slab.holes) area -= ring(hole)
      areas.subfloorM2 = (areas.subfloorM2 ?? 0) + Math.max(0, area)
    }
  }

  // Whole-building metrics (floor area / volume / envelope UA…) — shared by
  // the panel drawer and the blueprints' schedules block. Steel (LGS)
  // walls make the wood-frame IECC cavity claim dishonest — the flag keys
  // on wall CONSTRUCTION resolution (not member emission) so the note
  // holds even with the walls system toggled off (round-1 F2).
  const hasSteelWalls = activeWalls.some(
    (w) =>
      !w.curved &&
      resolveWallConstruction(w, config, profile.exteriorWallDefault).construction === 'lgs',
  )
  const characteristics = computeCharacteristics(activeWalls, activeRooms, slabs, spec, code, {
    ...(hasSteelWalls ? { steelWalls: true } : {}),
  })

  // Walls on a support slab below the plate line: everything framed ON the
  // wall (its skeleton, layers, devices, pipes) was laid out from y = 0 —
  // move it down onto the slab. The foundation placed its own members from
  // the wall's `baseY` already; roof members sourced by a wall (gable
  // infill) sit on the plate line and stay.
  if (baseYById.size > 0) {
    for (let i = 0; i < members.length; i++) {
      const m = members[i] as Member
      const baseY = baseYById.get(m.sourceId)
      if (baseY === undefined || m.system === 'foundation' || m.system === 'roof-framing') continue
      members[i] = { ...m, position: [m.position[0], m.position[1] + baseY, m.position[2]] }
    }
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i] as (typeof fixtures)[number]
      const baseY = baseYById.get(f.sourceId)
      if (baseY === undefined) continue
      fixtures[i] = { ...f, position: [f.position[0], f.position[1] + baseY, f.position[2]] }
    }
  }

  return {
    members: stableMembers(members),
    fixtures: stableFixtures(fixtures),
    warnings,
    jurisdiction: code,
    spec,
    areas,
    characteristics,
    duplicateOf: Object.fromEntries(duplicateOf),
    devices,
    walls: activeWalls,
  }
}
