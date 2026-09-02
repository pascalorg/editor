/**
 * Plumbing engine — DWV + supply. Pure function:
 * (WallSlice[], RoomSlice[], FramingSpec, PlacedFixtureSlice[]) → {members, fixtures}.
 *
 * TWO paths:
 *  - PLACED fixtures (the items the user actually dropped — toilet, shower,
 *    sinks…) are the demand points: a water-service meter + ¾" cold main, a
 *    water heater placed like the electrical panel (garage tank / exterior
 *    tankless), per-fixture hot+cold homeruns along the wall graph, and a
 *    real DWV tree — trap → trap arm (P3105.1 limits) → DFU-sized branches
 *    (P3004.1 / P3005.4.1, never decreasing downstream, ≥3" once a WC is
 *    upstream) falling at the P3005.3 slope under the slab to a 3" stack,
 *    building drain and sewer-exit cleanout.
 *  - No placed fixtures → the original room-category fallback below.
 *
 * The room-category fallback mirrors how residential plumbing is organized
 * (docs/research/mep.md, data/mep-rules.json):
 *  - wet rooms (kitchen / bathroom / laundry) cluster around a shared
 *    plumbing core to minimize runs;
 *  - ONE 3" vent stack rises inside the wet wall nearest the bathroom and
 *    penetrates the roof (IRC P3102/P3103);
 *  - drains route MANHATTAN (axis-aligned legs, no diagonal air runs)
 *    UNDER THE FLOOR (user feedback 2026-08-20: the crawl space showed no
 *    evacuation for toilets/showers/sinks — drains used to float on a
 *    schematic plane INSIDE the room volume): every fixture class drops
 *    through the floor (3" closet bend, 2" shower trap, 1½" lav/sink
 *    trap — Table P3005.4.1 sizes) and every horizontal run hangs below
 *    the floor plane falling at the P3005.3 slope for its size, so remote
 *    rooms arrive at the stack lower than they left;
 *  - the 3" building drain continues from the stack base, buried, to a
 *    sewer exit at the nearest exterior wall, with a cleanout at each end
 *    (P3005.2) and a DFU check against Table P3005.4.1 (flags when 3" is
 *    undersized);
 *  - each remote room re-vents: a 1½" riser to 6" above the flood rim
 *    (P3104.4) then level legs back to the stack;
 *  - supplies split at the water heater: a ¾" cold service from the nearest
 *    exterior wall feeds the WH, ½" cold branches serve every stub, ½" hot
 *    branches (the WH loop) serve everything but toilets;
 *  - fixtures rough in at standard heights (toilet 12" center-off-wall,
 *    lav ~21" AFF drain, kitchen sink ~18" AFF, laundry box ~42").
 */

import mepRules from '../../data/mep-rules.json'
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type {
  Fixture,
  Member,
  RoomSlice,
  ServiceOverrides,
  WallSlice,
} from '../core/types'
import { feet, inches, toFeet } from '../core/units'
import type { PlacedFixtureSlice } from '../core/wall-model'
import {
  buildWallGraph,
  clearOfOpenings,
  nearestWallPoint,
  openingSpans,
  overridePlanPoint,
  overrideWallPoint,
  panelMountU,
  placePanelSpot,
  pointInPolygon,
  wallPath,
  wallPlan,
  type WallPoint,
} from './electrical'

type Pt = readonly [number, number]

const rules = mepRules as {
  plumbing?: {
    wetWall?: {
      shieldPlateRequiredWithinInOfStudFace?: number
    }
    dwv?: {
      buildingDrainIn?: number
      ventStackIn?: number
      slopeInPerFtBySize?: Record<string, number>
      maxTrapArmFtBySize?: Record<string, number>
      maxDfuHorizontalBranchBySize?: Record<string, number>
      maxDfuBuildingDrainBySizeAtQuarterInSlope?: Record<string, number>
    }
    supply?: {
      mainIn?: number
      branchIn?: number
      waterHeater?: {
        garageIgnitionElevationIn?: number
        tpDischargeMaxAboveFloorIn?: number
        panMinDepthIn?: number
        seismicStraps?: { count?: number; lowerAboveControlsIn?: number }
      }
    }
    fixtureRoughIn?: {
      toiletCenterFromWallIn?: number
      lavHeightIn?: number
      toiletSupplyHeightIn?: number
      lavSupplyHeightIn?: number
      lavDrainHeightIn?: number
      showerValveHeightIn?: number
      tubValveHeightIn?: number
    }
  }
}

/** Pipe box side for a nominal diameter (round pipe drawn as a square box). */
const pipeSide = (nominalIn: number): number => inches(nominalIn)

const MAIN_DRAIN = pipeSide(rules.plumbing?.dwv?.buildingDrainIn ?? 3)
const STACK_SIDE = pipeSide(rules.plumbing?.dwv?.ventStackIn ?? 3)
const SUPPLY_MAIN = pipeSide(0.75)
const SUPPLY_BRANCH = pipeSide(0.5)
const VENT_SIDE = pipeSide(1.5)

/**
 * Under-floor burial margin: the HIGHEST under-floor drain node hangs this
 * far below the floor plane (level-local y = 0), so every horizontal DWV
 * run clears the structure sharing that stratum — a default framed
 * platform (2x12 joists + deck hung under the slab surface, band bottom
 * ≈ −0.29) and the 12" interior thickened footings (R403.1, bottom
 * −0.305) — and the renderer's buried ghost pass picks the whole tree up
 * (top of pipe below the floor line). Slab-on-grade drains render as
 * below-grade ghosts exactly like the buried electric service lateral.
 */
export const UNDER_FLOOR_CLEAR = 0.45
/** Drain drops leave the wet wall this far INTO the room so through-floor
 * risers clear the 16"-wide footings/stemwalls under the wall (R403.1). */
const DROP_SETBACK = 0.3
/** P3005.3: horizontal DWV slope — 1/4" per foot = 1:48. */
export const DRAIN_SLOPE = 1 / 48
/** P3104.4: vents reconnect >= 6" above the fixture flood rim (~36" lav). */
const VENT_RECONNECT_Y = inches(42)
// Below the electrical drill band (WIRE_RUN_Y 0.457 + 12mm/circuit): hot
// tops out at 0.34 + 5*0.008 = 0.38, leaving >= 6cm of stud between the
// trades (verify round D2: hot homeruns interpenetrated circuit runs).
const SUPPLY_COLD_Y = 0.28
const SUPPLY_HOT_Y = 0.34

/**
 * Drainage fixture units per wet-room group (Table P3004.1: WC 3 + lav 1 +
 * tub/shower 2 = bathroom group 6; kitchen sink 2; laundry standpipe 2).
 */
export const DFU_BY_CATEGORY: Record<string, number> = {
  bathroom: 6,
  kitchen: 2,
  laundry: 2,
}
/** Table P3005.4.1: a 3" building drain at 1/4"/ft carries 42 DFU. */
export const MAIN_CAPACITY_DFU = 42

export function polygonCentroid(polygon: readonly Pt[]): Pt {
  let x = 0
  let z = 0
  for (const [px, pz] of polygon) {
    x += px
    z += pz
  }
  const n = Math.max(1, polygon.length)
  return [x / n, z / n]
}

/** Closest point on a wall's segment to `p`, plus the distance. */
function nearestOnWall(wall: WallSlice, p: Pt): { point: Pt; distance: number } {
  const [ax, az] = wall.start
  const [dx, dz] = wall.dir
  const t = Math.max(0, Math.min(wall.length, (p[0] - ax) * dx + (p[1] - az) * dz))
  const point: Pt = [ax + dx * t, az + dz * t]
  return { point, distance: Math.hypot(p[0] - point[0], p[1] - point[1]) }
}

/** Nearest point on any exterior wall — the sewer/service exit. */
function nearestExteriorPoint(walls: WallSlice[], p: Pt): Pt | null {
  let best: Pt | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const wall of walls) {
    if (!wall.exterior || wall.curved) continue
    const { point, distance } = nearestOnWall(wall, p)
    if (distance < bestDist) {
      bestDist = distance
      best = point
    }
  }
  return best
}

/** Face point offset off a wall — room containment probes (WH side pick). */
function facePoint(wall: WallSlice, side: 1 | -1, u: number): Pt {
  return [
    wall.start[0] + wall.dir[0] * u + -wall.dir[1] * side * (wall.thickness / 2 + 0.08),
    wall.start[1] + wall.dir[1] * u + wall.dir[0] * side * (wall.thickness / 2 + 0.08),
  ]
}

/** The garage bounding a wall — boundary list or face-midpoint containment. */
function garageBoundingWall(wall: WallSlice, rooms: RoomSlice[]): RoomSlice | undefined {
  const garages = rooms.filter((r) => r.category === 'garage')
  return garages.find(
    (g) =>
      g.boundaryWallIds.includes(wall.id) ||
      pointInPolygon(facePoint(wall, 1, wall.length / 2), g.polygon) ||
      pointInPolygon(facePoint(wall, -1, wall.length / 2), g.polygon),
  )
}

/**
 * AUTO spot for the water-service meter: the longest exterior wall (else the
 * longest wall), clear of ROs. Exported so the Bones panel action can seed a
 * `bones:service` water-entry node exactly where the engine auto-places.
 */
export function placeMeterSpot(
  walls: WallSlice[],
): { wall: WallSlice; u: number; heightAff: number } | null {
  const straight = walls.filter((w) => !w.curved && w.length >= 0.1)
  if (straight.length === 0) return null
  const exterior = straight.filter((w) => w.exterior)
  const meterWall = [...(exterior.length > 0 ? exterior : straight)].sort(
    (p, q) => q.length - p.length,
  )[0] as WallSlice
  const meterU = clearOfOpenings(meterWall, panelMountU(meterWall), 0, ANCHOR_CLEAR_TOP)
  return { wall: meterWall, u: meterU, heightAff: 0.3 }
}

/**
 * AUTO spot for the water heater: a garage wall with room beside the panel
 * (tank, M1307.3) — else tankless on the meter wall. `heightAff` is the
 * equipment CENTER height. Exported for the Bones panel action.
 */
export function placeWhSpot(
  walls: WallSlice[],
  rooms: RoomSlice[],
): { wall: WallSlice; u: number; tank: boolean; heightAff: number } | null {
  const straight = walls.filter((w) => !w.curved && w.length >= 0.1)
  const meter = placeMeterSpot(walls)
  if (!meter) return null
  const garageCandidates = straight
    .filter((w) => garageBoundingWall(w, rooms) !== undefined)
    .sort((p, q) => q.length - p.length)
  // Tank (0.6) + panel enclosure (0.4) + NEC 110.26 working space (0.76)
  // need ~1.0m of separation; a short garage wall can't host both trades
  // (re-verify: the 1.2m offset clamped back onto the panel below 3.2m).
  const garageWall = garageCandidates.find(
    (w) => Math.abs(panelMountU(w) - Math.max(0.4, panelMountU(w) - 1.2)) >= 0.999 ||
           panelMountU(w) + 1.2 <= w.length - 0.4,
  )
  const tank = garageWall !== undefined
  const whWall = garageWall ?? meter.wall
  const whURaw = (() => {
    if (whWall === meter.wall) return Math.min(whWall.length - 0.4, meter.u + 1.2)
    // The electrical panel claims panelMountU on this SAME wall (both
    // trades elect the longest garage wall) — keep the tank a panel-width
    // + NEC 110.26 working space away (verify round D1: the 50-gal tank
    // ENGULFED the panel).
    const panelU = panelMountU(whWall)
    const off = 1.2
    return panelU + off <= whWall.length - 0.4 ? panelU + off : Math.max(0.4, panelU - off)
  })()
  const whU = clearOfOpenings(whWall, whURaw, 0, 2.1)
  const height = tank ? 1.5 : 0.6
  const bottom = tank ? inches(18) : 1.2 // M1307.3 garage ignition height
  return { wall: whWall, u: whU, tank, heightAff: bottom + height / 2 }
}

/**
 * Sewer exit from a stack position: nearest exterior point, carried 0.6m
 * past the wall (away from the wet core) when the stack already sits on it.
 * Shared by the placed-fixture and room-fallback paths (identical code).
 */
function sewerExitFrom(walls: WallSlice[], stackAt: Pt, core: Pt): Pt {
  let exit: Pt = nearestExteriorPoint(walls, stackAt) ?? [stackAt[0] + 1, stackAt[1]]
  if (manhattanDist(stackAt, exit) < 0.3) {
    const ox = exit[0] - core[0]
    const oz = exit[1] - core[1]
    const n = Math.max(1e-6, Math.hypot(ox, oz))
    exit = [exit[0] + (ox / n) * 0.6, exit[1] + (oz / n) * 0.6]
  }
  return exit
}

/**
 * AUTO plan point of the sewer exit — mirrors the engine's stack choice
 * (DFU-weighted centroid of placed fixtures when present, else the wet-room
 * fallback's stack wall). Exported for the Bones panel action.
 */
export function placeSewerExit(
  walls: WallSlice[],
  rooms: RoomSlice[],
  placed: PlacedFixtureSlice[] = [],
): Pt | null {
  const straight = walls.filter((w) => !w.curved && w.length >= 0.1)
  if (straight.length === 0) return null
  if (placed.length > 0) {
    const totalDfu = placed.reduce((s, f) => s + f.dfu, 0)
    const wx = placed.reduce((s, f) => s + f.plan[0] * f.dfu, 0) / Math.max(1, totalDfu)
    const wz = placed.reduce((s, f) => s + f.plan[1] * f.dfu, 0) / Math.max(1, totalDfu)
    const stackAnchor = nearestWallPoint(walls, [wx, wz], Number.POSITIVE_INFINITY)
    if (stackAnchor) return sewerExitFrom(walls, wallPlan(stackAnchor) as Pt, [wx, wz])
  }
  const wetRooms = rooms.filter(
    (r) => r.category === 'kitchen' || r.category === 'bathroom' || r.category === 'laundry',
  )
  if (wetRooms.length === 0) return null
  const core = polygonCentroid(wetRooms.flatMap((r) => [polygonCentroid(r.polygon)]))
  const stackRoom = wetRooms.find((r) => r.category === 'bathroom') ?? (wetRooms[0] as RoomSlice)
  const stackWall = wetWallFor(stackRoom, walls, core)
  if (!stackWall) return null
  const stackAt = nearestOnWall(stackWall, polygonCentroid(stackRoom.polygon)).point
  return sewerExitFrom(walls, stackAt, core)
}

/** The wet wall for a room: a boundary wall (else the nearest wall) whose
 * midpoint is closest to the shared wet-core centroid. */
export function wetWallFor(
  room: RoomSlice,
  walls: WallSlice[],
  core: Pt,
): WallSlice | null {
  const candidates =
    room.boundaryWallIds.length > 0
      ? walls.filter((w) => room.boundaryWallIds.includes(w.id))
      : walls
  if (candidates.length === 0) return null
  const centroid = polygonCentroid(room.polygon)
  let best: WallSlice | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const wall of candidates) {
    const mid: Pt = [
      wall.start[0] + (wall.dir[0] * wall.length) / 2,
      wall.start[1] + (wall.dir[1] * wall.length) / 2,
    ]
    // Serve the room (near its centroid) AND the core (short shared runs).
    const score =
      Math.hypot(mid[0] - centroid[0], mid[1] - centroid[1]) +
      Math.hypot(mid[0] - core[0], mid[1] - core[1])
    if (score < bestScore) {
      bestScore = score
      best = wall
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Pipe emitters
// ---------------------------------------------------------------------------

export type PipeSpec = {
  side: number
  material: Member['material']
  role: Member['role']
  sourceId: string
  label: string
  flag?: string
}

/**
 * One horizontal pipe leg from `from` (HIGH end, at `yHigh`) to `to`,
 * dropping `slope` per unit of plan length when `sloped`. Returns the
 * arrival height so chained legs keep falling. Rotation follows the rafter
 * convention: [0, ψ, tilt] with +X pointing uphill.
 */
function leg(
  members: Member[],
  spec: PipeSpec,
  from: Pt,
  to: Pt,
  yHigh: number,
  sloped: boolean,
  minLen = 0.05,
  slope = DRAIN_SLOPE,
): number {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const plan = Math.hypot(dx, dz)
  if (plan < minLen) return yHigh
  const drop = sloped ? plan * slope : 0
  const yLow = yHigh - drop
  const length = Math.hypot(plan, drop)
  // +X must point UPHILL: from `to` (low) toward `from` (high).
  const yaw = Math.atan2(-(from[1] - to[1]), from[0] - to[0])
  members.push({
    system: 'plumbing',
    role: spec.role,
    dims: [length, spec.side, spec.side],
    length,
    position: [(from[0] + to[0]) / 2, (yHigh + yLow) / 2, (from[1] + to[1]) / 2],
    rotation: [0, yaw, sloped ? Math.atan2(drop, plan) : 0],
    material: spec.material,
    sourceId: spec.sourceId,
    label: spec.label,
    flag: spec.flag,
  })
  return yLow
}

/** Manhattan (X-leg then Z-leg) run; returns the arrival height. */
function manhattan(
  members: Member[],
  spec: PipeSpec,
  from: Pt,
  to: Pt,
  yHigh: number,
  sloped: boolean,
  slope = DRAIN_SLOPE,
): number {
  const elbow: Pt = [to[0], from[1]]
  const y1 = leg(members, spec, from, elbow, yHigh, sloped, 0.05, slope)
  return leg(members, spec, elbow, to, y1, sloped, 0.05, slope)
}

/** Total Manhattan plan distance. */
const manhattanDist = (a: Pt, b: Pt): number => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])

/**
 * The P2603.4 sleeve note when a horizontal leg passes THROUGH the
 * concrete under some wall (round-2 skeptic R2/R3: the old terminal-leg
 * heuristic sleeved the leg that reached the EXIT, not the legs that
 * actually crossed concrete — a corner powder room ran its main's X-leg
 * bare through the west stemwall; a courtyard branch crossed both
 * courtyard stemwalls bare). Concrete extents from the same spec the
 * foundation engine builds from: perimeter stemwall+footing reach
 * −spec.footingDepth; interior BEARING walls (≥ 2.4 m — the foundation's
 * INTERIOR_BEARING_MIN_LENGTH) carry a 12" thickened footing; short
 * partitions bear on the slab (no concrete). Transversal crossings only —
 * parallel coexistence is prevented by the DROP_SETBACK inboard geometry.
 */
function sleeveNoteFor(
  walls: WallSlice[],
  fspec: FramingSpec,
  from: Pt,
  to: Pt,
  yHigh: number,
  side: number,
  slope: number,
): string | undefined {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const len = Math.hypot(dx, dz)
  if (len < 1e-6) return undefined
  for (const w of walls) {
    if (w.curved || w.length < 0.1) continue
    if (!w.exterior && w.length < 2.4) continue // partition on slab
    const depth = w.exterior ? fspec.footingDepth : inches(12)
    // widest concrete under the wall + the pipe's half side
    const half = Math.max(fspec.footingWidth, fspec.stemwallThickness) / 2 + side / 2
    const wx = w.dir[0] * w.length
    const wz = w.dir[1] * w.length
    const den = dx * wz - dz * wx
    if (Math.abs(den) < 1e-9) continue // parallel — setback geometry owns it
    const t = ((w.start[0] - from[0]) * wz - (w.start[1] - from[1]) * wx) / den
    const u = ((w.start[0] - from[0]) * dz - (w.start[1] - from[1]) * dx) / den
    if (t < -half / len || t > 1 + half / len) continue
    if (u < -half / w.length || u > 1 + half / w.length) continue
    // pipe TOP at the crossing point vs the concrete's bottom
    const yAt = yHigh - Math.max(0, Math.min(1, t)) * len * slope
    if (yAt + side / 2 > -depth) return ' — sleeved through foundation (P2603.4)'
  }
  return undefined
}

/**
 * Concrete band half-width + clearance a buried DROP vertical must keep
 * from a wall's centerline — the SAME concrete model sleeveNoteFor uses:
 * exterior walls carry stemwall+footing (to spec.footingDepth), interior
 * BEARING walls (≥ 2.4 m, the foundation's INTERIOR_BEARING_MIN_LENGTH)
 * a 12" thickened footing, short partitions bear on the slab (no
 * concrete). Null = no concrete under this wall.
 */
function dropClearNeed(w: WallSlice, fspec: FramingSpec, side: number): number | null {
  if (w.curved || w.length < 0.1) return null
  if (!w.exterior && w.length < 2.4) return null
  return Math.max(fspec.footingWidth, fspec.stemwallThickness) / 2 + side / 2 + 0.02
}

/**
 * F3 residuals (B20): trap-DROP verticals were validated only against the
 * fixture's OWN anchor wall — a corner-flush lav's drop riser ran bare
 * through the PERPENDICULAR frost stemwall, and a toilet 0.22 m off an
 * interior bearing wall dropped inside that wall's 12" thickened footing.
 * Push the drop point out of EVERY wall's concrete band (4 passes cover
 * corners where clearing one wall approaches another); a point that cannot
 * clear (pinched between bands) reports clear:false and the caller SLEEVES
 * the drop (P2603.4) — never a silent bare crossing.
 */
function clampDropClear(
  walls: WallSlice[],
  fspec: FramingSpec,
  at: Pt,
  side: number,
): { at: Pt; clear: boolean } {
  let p: Pt = at
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const w of walls) {
      const need = dropClearNeed(w, fspec, side)
      if (need === null) continue
      const dx = p[0] - w.start[0]
      const dz = p[1] - w.start[1]
      const u = dx * w.dir[0] + dz * w.dir[1]
      if (u < -need || u > w.length + need) continue
      const off = -dx * w.dir[1] + dz * w.dir[0]
      if (Math.abs(off) >= need) continue
      // push across the wall just PAST the band edge (the 5 mm overshoot
      // keeps float noise from re-triggering this wall next pass), on the
      // side the point already leans (drops arrive inboard of their OWN
      // wall, so the lean picks the room side of the offending wall)
      const s = off >= 0 ? 1 : -1
      const out = need + 0.005
      p = [
        w.start[0] + w.dir[0] * u - w.dir[1] * s * out,
        w.start[1] + w.dir[1] * u + w.dir[0] * s * out,
      ]
      moved = true
    }
    if (!moved) return { at: p, clear: true }
  }
  return { at, clear: false }
}

const toIn = (m: number): number => m / 0.0254

/**
 * P2603.2.1 (B20 — the shield-plate data was DEAD): pipe closer than 1.5"
 * to the stud face takes steel shield plates. The 3" stack centers in its
 * wet wall, so the drawn thickness tells the cover story — a 2x4 partition
 * leaves ~0.3" (the hub does not even fit; wet walls frame 2x6, see
 * mep-rules wetWall), a default 0.15 m wall ~1.45" — both under the 1.5"
 * threshold. The FLAG ships here; the physical nail-plate members ride B15.
 */
function stackShieldFlag(wallThickness: number): string | undefined {
  const shieldIn = rules.plumbing?.wetWall?.shieldPlateRequiredWithinInOfStudFace ?? 1.5
  const coverIn = toIn((wallThickness - STACK_SIDE) / 2)
  if (coverIn >= shieldIn) return undefined
  const thickIn = toIn(wallThickness).toFixed(1)
  if (coverIn < 0.5) {
    return (
      `SHIELD: 3" DWV stack in a ${thickIn}" wall has ${Math.max(0, coverIn).toFixed(2)}" of cover — ` +
      `it does not fit the stud bay; frame the wet wall 2x6 and add steel shield plates (P2603.2.1)`
    )
  }
  return (
    `SHIELD: 3" DWV stack sits ${coverIn.toFixed(2)}" from the wall face (< ${shieldIn}") — ` +
    `steel shield plates required (P2603.2.1)`
  )
}

/**
 * Buried drain run: Manhattan legs falling at `slope`, each leg carrying
 * the P2603.4 sleeve note IFF it crosses concrete (sleeveNoteFor) — the
 * drainage SAT gate exempts crossings by label, so the note must sit on
 * exactly the crossing legs, never blanket the run (S3a/R2/R3). Above the
 * ground storey there is no foundation — no leg ever sleeves.
 */
function drainManhattan(
  members: Member[],
  spec: PipeSpec,
  walls: WallSlice[],
  fspec: FramingSpec,
  from: Pt,
  to: Pt,
  yHigh: number,
  slope: number,
  groundLevel: boolean,
): number {
  const elbow: Pt = [to[0], from[1]]
  const specFor = (a: Pt, b: Pt, y: number): PipeSpec => {
    const note = groundLevel ? sleeveNoteFor(walls, fspec, a, b, y, spec.side, slope) : undefined
    return note ? { ...spec, label: `${spec.label}${note}` } : spec
  }
  const y1 = leg(members, specFor(from, elbow, yHigh), from, elbow, yHigh, true, 0.05, slope)
  return leg(members, specFor(elbow, to, y1), elbow, to, y1, true, 0.05, slope)
}

/**
 * A wall point pulled DROP_SETBACK off the wall centerline toward `inside`
 * — the under-floor junctions live INBOARD so buried runs and their
 * through-floor verticals never enter the stemwall/footing volume under
 * the wall (skeptic S1: frost stemwalls reach the drain depth).
 */
function inboardOf(at: Pt, wall: WallSlice, inside: Pt): Pt {
  const nx = -wall.dir[1]
  const nz = wall.dir[0]
  const side = Math.sign((inside[0] - at[0]) * nx + (inside[1] - at[1]) * nz) || 1
  return [at[0] + nx * side * DROP_SETBACK, at[1] + nz * side * DROP_SETBACK]
}

/** Vertical pipe segment at a plan point. */
function riser(
  members: Member[],
  spec: PipeSpec,
  at: Pt,
  y0: number,
  y1: number,
): void {
  const length = Math.abs(y1 - y0)
  // Only true no-ops are dropped — a kitchen hot stub 1.8cm above the hot
  // plane still deserves its riser (round-6 advisory).
  if (length < 0.008) return
  members.push({
    system: 'plumbing',
    role: spec.role,
    dims: [spec.side, length, spec.side],
    length,
    position: [at[0], (y0 + y1) / 2, at[1]],
    rotation: [0, 0, 0],
    material: spec.material,
    sourceId: spec.sourceId,
    label: spec.label,
    flag: spec.flag,
  })
}

/** A braided hose longer than this wants a re-routed stub, not more hose. */
const CONN_MAX = 0.6

/**
 * Braided supply connector: a 3-segment sagging arc from the wall stub to
 * the fixture's connection point (user ask — a toilet standing off the wall
 * showed pipe dead-ending in air). Chained endpoints land EXACTLY on stub
 * and fixture so the connectivity harness sees continuous pipe. No new
 * roles: plain copper pipe-runs under sourceId `conn-<side>-<fixture id>`
 * — ONE id per hose, so the takeoff counts hoses, never phantom pipe.
 * Segments are sampled through the same RO logic as risers (P5d — a hose
 * through a doorway is still pipe through an opening; round-3 scorecard:
 * 6 unflagged crossings for a lav dropped in the door RO), and hoses over
 * CONN_MAX carry a too-long flag instead of silently spanning the room.
 */
function connectorArc(
  members: Member[],
  walls: WallSlice[],
  side: 'cold' | 'hot',
  id: string,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): void {
  const sag = Math.min(0.05, 0.25 * Math.hypot(to[0] - from[0], to[2] - from[2]))
  // quadratic bezier through a control point sagging below the chord
  const cx = (from[0] + to[0]) / 2
  const cy = (from[1] + to[1]) / 2 - sag * 2
  const cz = (from[2] + to[2]) / 2
  const pt = (t: number): [number, number, number] => {
    const u = 1 - t
    return [
      u * u * from[0] + 2 * u * t * cx + t * t * to[0],
      u * u * from[1] + 2 * u * t * cy + t * t * to[1],
      u * u * from[2] + 2 * u * t * cz + t * t * to[2],
    ]
  }
  const pts = [pt(0), pt(1 / 3), pt(2 / 3), pt(1)]
  // total hose length — the fixture is too far when the arc exceeds CONN_MAX
  let hoseLen = 0
  for (let i = 0; i < 3; i++) {
    const a = pts[i] as [number, number, number]
    const b = pts[i + 1] as [number, number, number]
    hoseLen += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  const lenFlag =
    hoseLen > CONN_MAX
      ? 'connector too long — move the fixture closer or route the stub'
      : undefined
  // chord sampled every 3cm at its own heights against every RO volume
  const crossesRO = (a: readonly number[], b: readonly number[]): boolean => {
    const steps = Math.max(
      2,
      Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!) / 0.03),
    )
    for (let i = 0; i <= steps; i++) {
      const x = a[0]! + ((b[0]! - a[0]!) * i) / steps
      const y = a[1]! + ((b[1]! - a[1]!) * i) / steps
      const z = a[2]! + ((b[2]! - a[2]!) * i) / steps
      if (pointInAnyRO(walls, [x, z], y)) return true
    }
    return false
  }
  for (let i = 0; i < 3; i++) {
    const a = pts[i] as [number, number, number]
    const b = pts[i + 1] as [number, number, number]
    const hi = a[1] >= b[1] ? a : b
    const lo = hi === a ? b : a
    const plan = Math.hypot(hi[0] - lo[0], hi[2] - lo[2])
    const drop = hi[1] - lo[1]
    const length = Math.hypot(plan, drop)
    const roFlag = crossesRO(a, b)
      ? 'OPENING: braided supply connector crosses a rough opening — move the fixture clear of the door/window'
      : undefined
    members.push({
      system: 'plumbing',
      role: 'pipe-run',
      dims: [length, 0.012, 0.012],
      length,
      position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
      rotation: [0, Math.atan2(-(hi[2] - lo[2]), hi[0] - lo[0]), Math.atan2(drop, Math.max(1e-6, plan))],
      material: 'copper',
      sourceId: `conn-${side}-${id}`,
      label: 'braided supply connector',
      flag: roFlag ?? lenFlag,
    })
  }
}

// ---------------------------------------------------------------------------
// Placed-fixture engine (LOD 400 rebuild): the items the user dropped are
// the demand points; the room-category path stays as the fallback.
// ---------------------------------------------------------------------------

/** IRC P3005.3 slope for a nominal size: 1/4"/ft ≤ 2.5", 1/8"/ft ≥ 3". */
function slopeFor(sizeIn: number): number {
  const table = rules.plumbing?.dwv?.slopeInPerFtBySize ?? {}
  const inPerFt = table[String(sizeIn)] ?? (sizeIn >= 3 ? 0.125 : 0.25)
  return inPerFt / 12
}

/** IRC Table P3105.1 trap-arm limit (m, trap weir → vent) for a trap size. */
function trapArmMax(sizeIn: number): number {
  return feet(rules.plumbing?.dwv?.maxTrapArmFtBySize?.[String(sizeIn)] ?? 8)
}

/** Nominal drain sizes the engine stocks (2.5" is skipped — uncommon). */
const BRANCH_SIZES = [1.5, 2, 3, 4] as const

/**
 * Smallest horizontal-branch size that carries `dfu` (Table P3005.4.1),
 * never below the largest upstream trap, ≥ 3" once a water closet is
 * upstream (P3005.4.1: no WC on a pipe smaller than 3").
 */
function branchSize(dfu: number, minIn: number, hasWC: boolean): number {
  const table = rules.plumbing?.dwv?.maxDfuHorizontalBranchBySize ?? {}
  const floor = Math.max(minIn, hasWC ? 3 : 1.5)
  for (const size of BRANCH_SIZES) {
    if (size < floor) continue
    if (dfu <= (table[String(size)] ?? Number.POSITIVE_INFINITY)) return size
  }
  return 4
}

/** Supply rough-in stub heights (fixtureRoughIn.* — practice defaults). */
const STUB_HEIGHT: Record<PlacedFixtureSlice['kind'], number> = {
  toilet: inches(rules.plumbing?.fixtureRoughIn?.toiletSupplyHeightIn ?? 7),
  lavatory: inches(rules.plumbing?.fixtureRoughIn?.lavSupplyHeightIn ?? 21),
  shower: inches(rules.plumbing?.fixtureRoughIn?.showerValveHeightIn ?? 44),
  bathtub: inches(rules.plumbing?.fixtureRoughIn?.tubValveHeightIn ?? 30),
  'clothes-washer': inches(42), // laundry outlet box — practice, not code
  'kitchen-sink': inches(18), // supplies under the sink — practice
}

/** Where the braided supply connector lands ON the fixture (tank inlet /
 * faucet tails) — user ask: a fixture standing off its wall shows the hose. */
const CONN_HEIGHT: Record<PlacedFixtureSlice['kind'], number> = {
  toilet: 0.2, // tank inlet
  lavatory: 0.3, // faucet tails
  shower: STUB_HEIGHT.shower, // valve height — hose runs level
  bathtub: STUB_HEIGHT.bathtub,
  'clothes-washer': STUB_HEIGHT['clothes-washer'],
  'kitchen-sink': 0.35, // tails under the sink
}

/** A fixture farther than this from its wall stub gets a visible connector. */
const CONN_MIN = 0.06

/** Where the fixture's tailpiece meets its trap (drop start height). */
const DRAIN_CONN_Y: Record<PlacedFixtureSlice['kind'], number> = {
  toilet: 0, // closet flange at the floor
  lavatory: inches(rules.plumbing?.fixtureRoughIn?.lavDrainHeightIn ?? 19),
  shower: 0, // floor drain
  bathtub: 0,
  'clothes-washer': inches(30), // 2" standpipe trap
  'kitchen-sink': inches(18),
}

const KIND_LABEL: Record<PlacedFixtureSlice['kind'], string> = {
  toilet: 'Toilet',
  lavatory: 'Lavatory',
  shower: 'Shower',
  bathtub: 'Bathtub',
  'clothes-washer': 'Clothes washer',
  'kitchen-sink': 'Kitchen sink',
}

/** Per-branch plane step (like electrical's per-circuit drill planes). */
const SUPPLY_STEP = 0.008
/** Anchors must clear ROs across the whole stub band (44" shower valve). */
const ANCHOR_CLEAR_TOP = 1.25
/** A fixture farther than this from any wall is an island (air-run + flag). */
const ISLAND_DIST = 1.2

const round1ft = (m: number): number => Math.round(toFeet(m) * 10) / 10

/**
 * One level pipe leg along a wall at `runY`, detouring around any rough
 * opening crossing that plane — over the header when wall remains above,
 * under the sill otherwise. Supply and vent pipes may jog like cable
 * (checklist P5 inherits invariant E1); drains never route through here.
 */
function pipeWallLeg(
  members: Member[],
  spec: PipeSpec,
  wall: WallSlice,
  u0: number,
  u1: number,
  runY: number,
  /** Half-height of the vertical band the run occupies around `runY` —
   * 0.02 for a single pipe (the historical default, byte-pure for every
   * plumbing caller); a pipe PAIR routed once passes its envelope so an RO
   * sill landing between the two pipes still triggers ONE shared detour
   * decision (line-set skeptic round: split bands made the pair CROSS). */
  bandHalf = 0.02,
): void {
  const dir = Math.sign(u1 - u0) || 1
  const legLo = Math.min(u0, u1)
  const legHi = Math.max(u0, u1)
  const crossed = openingSpans(wall, runY - bandHalf, runY + bandHalf)
    .filter((s) => s.lo < legHi && s.hi > legLo)
    .sort((a, b) => (a.lo - b.lo) * dir)
  const at = (u: number): Pt => [wall.start[0] + wall.dir[0] * u, wall.start[1] + wall.dir[1] * u]
  const clamp = (u: number) => Math.max(legLo, Math.min(legHi, u))
  let cursor = u0
  for (const s of crossed) {
    // Risers stand 4.5cm past the RO edge — electrical's risers occupy the
    // edge itself (re-verify: colinear pipe/wire verticals, 0.000 apart).
    // The offset must ALSO clear every other opening over the riser's full
    // height (re-verify round 3: a mulled window 1.5cm past the door edge
    // swallowed the blindly-shifted riser) — step outward until clear.
    const EDGE_OFF = 0.045
    // 2.5cm skin: also clears the ELECTRICAL risers standing exactly on the
    // RO edges (verify round 4: 1cm skin left 1.5cm pipe/wire separation).
    // Clearance is tested on the CLAMPED value each step; exhaustion (24
    // steps = 1.2m, the widest common window) returns ok:false and the
    // risers are emitted FLAGGED — never a silent crossing.
    const riserU = (start: number, step: number): { u: number; ok: boolean } => {
      const allSpans = openingSpans(wall, 0.02, wall.height - 0.02)
      const isClear = (u: number) => !allSpans.some((sp) => u > sp.lo - 0.025 && u < sp.hi + 0.025)
      let u = start
      let prev = Number.NaN
      for (let i = 0; i < 24; i++) {
        const c = clamp(u)
        if (isClear(c)) return { u: c, ok: true }
        if (c === prev) break // pinned at a leg boundary — hopeless
        prev = c
        u += step
      }
      return { u: clamp(start), ok: false }
    }
    const nearR = riserU(dir > 0 ? s.lo - EDGE_OFF : s.hi + EDGE_OFF, dir > 0 ? -0.05 : 0.05)
    const farR = riserU(dir > 0 ? s.hi + EDGE_OFF : s.lo - EDGE_OFF, dir > 0 ? 0.05 : -0.05)
    const near = nearR.u
    const far = farR.u
    const roFlag =
      nearR.ok && farR.ok
        ? undefined
        : 'OPENING: pipe riser has no clear stud bay beside the opening — crosses the RO; review routing'
    const blockedAt = (yy: number) =>
      openingSpans(wall, yy - bandHalf, yy + bandHalf).some((o) => o.lo < s.hi && o.hi > s.lo)
    let detourY: number | null = null
    // start 7in over the header (electrical crosses at +4in — verify round
    // D2: coincident 0.95m pipe/wire segments over the same door)
    for (let yy = s.topY + inches(7); yy <= wall.height - 0.05; yy += inches(4)) {
      if (!blockedAt(yy)) {
        detourY = yy
        break
      }
    }
    if (detourY === null) {
      for (let yy = s.sillY - inches(7); yy >= 0.04; yy -= inches(4)) {
        if (!blockedAt(yy)) {
          detourY = yy
          break
        }
      }
    }
    if (detourY === null) {
      // RO spans floor to ceiling — nowhere inside this wall to route.
      leg(
        members,
        { ...spec, label: `${spec.label} (⚠ crosses full-height opening — verify)` },
        at(cursor),
        at(far),
        runY,
        false,
        0.015,
      )
      cursor = far
      continue
    }
    leg(members, spec, at(cursor), at(near), runY, false, 0.015)
    riser(members, roFlag ? { ...spec, flag: spec.flag ?? roFlag } : spec, at(near), runY, detourY)
    leg(members, spec, at(near), at(far), detourY, false, 0.015)
    riser(members, roFlag ? { ...spec, flag: spec.flag ?? roFlag } : spec, at(far), detourY, runY)
    cursor = far
  }
  leg(members, spec, at(cursor), at(u1), runY, false, 0.015)
}

/**
 * Route a level pipe between two wall anchors following the wall graph at
 * `runY` (buildWallGraph BFS — same rails as electrical homeruns), bridging
 * junction gaps explicitly. Disconnected wall islands fall back to flagged
 * Manhattan air legs.
 */
/** A plan point inside ANY wall's rough-opening volume at height y — the
 * cross-wall tee case pipeWallLeg can't see (verify round 4: a w_mid vent
 * leg ended at a junction sitting inside w_s's window RO). */
function pointInAnyRO(walls: WallSlice[], pt: Pt, y: number): boolean {
  for (const w of walls) {
    const dx = pt[0] - w.start[0]
    const dz = pt[1] - w.start[1]
    const u = dx * w.dir[0] + dz * w.dir[1]
    const off = Math.abs(-dx * w.dir[1] + dz * w.dir[0])
    if (off > w.thickness / 2 + 0.03 || u < 0 || u > w.length) continue
    if (openingSpans(w, y - 0.02, y + 0.02).some((sp) => u > sp.lo + 0.01 && u < sp.hi - 0.01)) {
      return true
    }
  }
  return false
}

/** Exported for the HVAC engine: the refrigerant line-set follows the SAME
 * wall rails as supply/vent pipe (E1 detours, junction jumpers, flagged
 * air-run fallback) — one routing machinery, not two (M2 line-set round). */
export function routePipe(
  members: Member[],
  spec: PipeSpec,
  graph: ReturnType<typeof buildWallGraph>,
  from: WallPoint,
  to: WallPoint,
  runY: number,
  allWalls: WallSlice[] = [],
  /** See pipeWallLeg — a pair routed once passes its band envelope here. */
  bandHalf = 0.02,
): void {
  const legs = wallPath(graph, from, to)
  if (legs) {
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i] as { wall: WallSlice; u0: number; u1: number }
      // a leg whose ENDPOINT sits inside another wall's RO can't detour —
      // emit it flagged (never silent)
      const endIn =
        allWalls.length > 0 &&
        (pointInAnyRO(allWalls, wallPlan({ wall: l.wall, u: l.u0 }) as Pt, runY) ||
          pointInAnyRO(allWalls, wallPlan({ wall: l.wall, u: l.u1 }) as Pt, runY))
      const legSpec = endIn
        ? { ...spec, flag: spec.flag ?? 'OPENING: run ends inside a rough opening at a wall junction — reroute or move the opening' }
        : spec
      pipeWallLeg(members, legSpec, l.wall, l.u0, l.u1, runY, bandHalf)
      const next = legs[i + 1]
      if (next) {
        const a = wallPlan({ wall: l.wall, u: l.u1 })
        const b = wallPlan({ wall: next.wall, u: next.u0 })
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.015) {
          // the jumper bridges two snapped leg ends — if either sits in an
          // RO the bridge crosses it too (verify round 5: the last silent
          // crossing class — vent jumpers through a tee-spanning window)
          const jumpIn =
            allWalls.length > 0 &&
            (pointInAnyRO(allWalls, a as Pt, runY) || pointInAnyRO(allWalls, b as Pt, runY))
          const jumpSpec = jumpIn
            ? { ...legSpec, flag: legSpec.flag ?? 'OPENING: junction jumper crosses a rough opening — reroute or move the opening' }
            : legSpec
          leg(members, { ...jumpSpec, label: `${spec.label} (junction jumper)` }, a, b, runY, false, 0.01)
        }
      }
    }
    return
  }
  const a = wallPlan(from)
  const b = wallPlan(to)
  manhattan(
    members,
    {
      ...spec,
      label: `${spec.label} (air run — no wall path, verify)`,
      flag: spec.flag ?? `AIR RUN: ${spec.label} found no wall path — route under floor/ceiling`,
    },
    a,
    b,
    runY,
    false,
  )
}

/** One anchored fixture in the DWV/supply solve. */
type Anchored = {
  f: PlacedFixtureSlice
  anchor: WallPoint
  /** Wall-anchor plan point (stub bay, clear of ROs). */
  plan: Pt
  /** Buried drain junction — `plan` pulled DROP_SETBACK into the room so
   * under-floor runs never enter the concrete under the wall (S1). */
  node: Pt
  /** Where the trap riser drops through the floor: the fixture's plan
   * point, pulled to the junction when the fixture sits closer to the
   * wall than DROP_SETBACK — a flush fixture's bare vertical ran through
   * the frost stemwall (R4b); the real closet bend sits ~12" off the
   * wall under the bowl anyway. */
  dropAt: Pt
  /** Drop point could not clear every wall's concrete band (pinched at a
   * corner) — the drop emits SLEEVED per P2603.4 instead of bare. */
  dropSleeved: boolean
  /** Too far from every wall — island air-run fallback. */
  island: boolean
  /** Where the stub-out fixture sits (the wall bay; the item itself for islands). */
  stubAt: Pt
  stubY: number
  /** Fixture → wall-anchor plan distance (supply hoses, island detection). */
  offWall: number
  /** Trap-arm plan length fixture → buried junction. */
  armLen: number
  /** Manhattan distance junction → stack junction (drain-tree ordering). */
  dist: number
  /** Drain rise above the stack base at this node (P3005.3 chaining). */
  rise: number
  /** Drain-tree parent (index into the anchored list; -1 = the stack). */
  parent: number
  /** Downstream accumulation: subtree DFU / largest trap / WC upstream. */
  subDfu: number
  subMaxDrain: number
  subWC: boolean
  /** Size (in) of the branch edge from this node toward its parent. */
  edgeSize: number
}

/**
 * The placed-fixture engine. Geometry contract (gated in
 * plumbing.connectivity.test.ts, checklist row P5):
 *  - every fixture is cold-reachable from the service meter, hot fixtures
 *    hot-reachable from the water heater, as physically continuous pipe;
 *  - every trap drains to the sewer exit along a strictly falling path;
 *  - no pipe crosses a rough opening (supply/vents detour like cable);
 *  - trap arms over the P3105.1 limit carry flags.
 */
function placedPlumbing(
  walls: WallSlice[],
  rooms: RoomSlice[],
  spec: FramingSpec,
  placed: PlacedFixtureSlice[],
  overrides?: ServiceOverrides,
  groundLevel = true,
): { members: Member[]; fixtures: Fixture[] } {
  const members: Member[] = []
  const fixtures: Fixture[] = []
  const fab = spec.detail !== '200' // traps/vents/supply branches gate
  const straight = walls.filter((w) => !w.curved && w.length >= 0.1)
  if (straight.length === 0) return { members, fixtures }
  const graph = buildWallGraph(walls)

  // ---- anchors: snap each fixture to its nearest wall stud bay, clear of
  // every RO the stub/vent band crosses ----
  // Fixture centroid — the inboard fallback for a fixture dropped EXACTLY
  // on its wall centerline (its own offset can't pick the room side).
  const cx = placed.reduce((s, f) => s + f.plan[0], 0) / Math.max(1, placed.length)
  const cz = placed.reduce((s, f) => s + f.plan[1], 0) / Math.max(1, placed.length)
  const anchored: Anchored[] = []
  for (const f of placed) {
    const anchor = nearestWallPoint(walls, f.plan, ANCHOR_CLEAR_TOP)
    if (!anchor) continue
    const plan = wallPlan(anchor) as Pt
    const offWall = Math.hypot(plan[0] - f.plan[0], plan[1] - f.plan[1])
    const node = inboardOf(plan, anchor.wall, offWall > 0.01 ? f.plan : [cx, cz])
    const armLen = Math.hypot(node[0] - f.plan[0], node[1] - f.plan[1])
    const island = offWall > ISLAND_DIST
    anchored.push({
      f,
      anchor,
      plan,
      node,
      dropAt: offWall >= DROP_SETBACK ? f.plan : node,
      dropSleeved: false,
      island,
      stubAt: island ? f.plan : plan,
      stubY: STUB_HEIGHT[f.kind],
      offWall,
      armLen,
      dist: 0,
      rise: 0,
      parent: -1,
      subDfu: f.dfu,
      subMaxDrain: f.drainIn,
      subWC: f.kind === 'toilet',
      edgeSize: 3,
    })
  }
  if (anchored.length === 0) return { members, fixtures }

  // ---- F3 residuals: validate every DROP vertical against ALL walls'
  // concrete, not just the anchor wall — clamp the junction + drop point
  // out of every band (corner-flush fixtures, perpendicular stemwalls,
  // interior thickened footings); an unclampable point sleeves instead.
  // Upper storeys have no foundation — geometry stays byte-pure there. ----
  if (groundLevel) {
    for (const a of anchored) {
      const dropSide = pipeSide(Math.max(a.f.drainIn, 1.25))
      const n = clampDropClear(walls, spec, a.node, dropSide)
      const d = clampDropClear(walls, spec, a.dropAt, dropSide)
      a.node = n.at
      a.dropAt = d.at
      a.dropSleeved = !n.clear || !d.clear
      a.armLen = Math.hypot(a.node[0] - a.f.plan[0], a.node[1] - a.f.plan[1])
    }
  }

  // ---- the stack lands on the wall nearest the DFU-weighted centroid (the
  // wet wall carrying the most drainage) ----
  const totalDfu = anchored.reduce((s, a) => s + a.f.dfu, 0)
  const wx = anchored.reduce((s, a) => s + a.f.plan[0] * a.f.dfu, 0) / Math.max(1, totalDfu)
  const wz = anchored.reduce((s, a) => s + a.f.plan[1] * a.f.dfu, 0) / Math.max(1, totalDfu)
  const stackAnchor = nearestWallPoint(walls, [wx, wz], Number.POSITIVE_INFINITY)
  if (!stackAnchor) return { members, fixtures }
  const stackAt = wallPlan(stackAnchor) as Pt
  // Buried root junction — inboard of the stack wall (toward the DFU
  // centroid), so the under-floor tee and the drop never sit inside a
  // frost-depth stemwall (S1/S1b) — then clamped clear of EVERY wall's
  // concrete band (a corner stack's junction can land in the
  // perpendicular wall's stemwall, F3 residual class).
  const stackNodeRaw = inboardOf(stackAt, stackAnchor.wall, [wx, wz])
  const stackNode = groundLevel
    ? clampDropClear(walls, spec, stackNodeRaw, STACK_SIDE).at
    : stackNodeRaw

  // ---- drain tree: each node's parent is the nearest node strictly closer
  // to the stack (acyclic by construction; distances only fall downstream) ----
  for (const a of anchored) a.dist = manhattanDist(a.node, stackNode)
  const order = anchored
    .map((_, i) => i)
    .sort((i, j) => (anchored[i] as Anchored).dist - (anchored[j] as Anchored).dist)
  for (const i of order) {
    const me = anchored[i] as Anchored
    let best = -1
    let bestDist = me.dist // default parent: the stack itself
    for (let j = 0; j < anchored.length; j++) {
      if (j === i) continue
      const other = anchored[j] as Anchored
      if (other.dist >= me.dist - 0.01) continue
      const d = manhattanDist(me.node, other.node)
      if (d < bestDist) {
        bestDist = d
        best = j
      }
    }
    me.parent = best
  }
  // Downstream DFU accumulation (children first — farthest nodes first).
  for (let k = order.length - 1; k >= 0; k--) {
    const me = anchored[order[k] as number] as Anchored
    if (me.parent >= 0) {
      const p = anchored[me.parent] as Anchored
      p.subDfu += me.subDfu
      p.subMaxDrain = Math.max(p.subMaxDrain, me.subMaxDrain)
      p.subWC = p.subWC || me.subWC
    }
  }
  // Edge sizes + heights, root outward: h(child) = h(parent) + run × slope
  // (IRC P3005.3) — sizes never decrease downstream because downstream
  // subtrees are supersets.
  for (const i of order) {
    const me = anchored[i] as Anchored
    me.edgeSize = branchSize(me.subDfu, me.subMaxDrain, me.subWC)
    const parent = me.parent >= 0 ? (anchored[me.parent] as Anchored) : null
    const pNode = parent ? parent.node : stackNode
    const pRise = parent ? parent.rise : 0
    me.rise = pRise + manhattanDist(me.node, pNode) * slopeFor(me.edgeSize)
  }
  // Bury the whole DWV tree under the floor: the stack base sits deep
  // enough that the farthest trap arm still arrives UNDER_FLOOR_CLEAR
  // below the floor plane — clear of joists/girders and interior footings.
  let maxRise = 0
  for (const a of anchored) {
    maxRise = Math.max(maxRise, a.rise + a.armLen * slopeFor(a.f.drainIn))
  }
  const base = -(maxRise + UNDER_FLOOR_CLEAR)

  // ---- stack: floor line up through the roof (P3103.1). It stops AT the
  // floor — a frost stemwall owns the wall line below grade (S1b), so the
  // buried connection is a separate SLEEVED drop at the inboard junction. ----
  const stackTop = stackAnchor.wall.height + 0.6
  members.push({
    system: 'plumbing',
    role: 'vent-stack',
    dims: [STACK_SIDE, stackTop, STACK_SIDE],
    length: stackTop,
    position: [stackAt[0], stackTop / 2, stackAt[1]],
    rotation: [0, 0, 0],
    material: 'pvc',
    sourceId: 'dwv-stack',
    label: '3" DWV stack — through roof (P3103.1)',
    flag: stackShieldFlag(stackAnchor.wall.thickness),
  })
  // Floor-line jog bridging the stack (wall line) to the buried drop at the
  // inboard junction — round-2 skeptic R1: stopping the stack at the floor
  // SEVERED it from the drainage (a through-roof vent tied to nothing,
  // P3104). The jog's bottom face rides ON the slab (contact, never inside
  // the concrete) and falls at 1/4"/ft toward the drop.
  const yJog = leg(
    members,
    {
      side: STACK_SIDE,
      material: 'pvc',
      role: 'pipe-run',
      sourceId: 'dwv-stack-base',
      label: '3" stack base — floor-line jog to the buried drop',
    },
    stackAt,
    stackNode,
    STACK_SIDE / 2 + 0.04, // bottom face clears the 3/4" deck top over its fall
    true,
    0.01,
  )
  riser(
    members,
    {
      side: STACK_SIDE,
      material: 'pvc',
      role: 'pipe-run',
      sourceId: 'dwv-stack-base',
      label: groundLevel
        ? '3" stack base drop — sleeved through slab (P2603.4)'
        : '3" stack base drop — into the floor cavity',
    },
    stackNode,
    yJog,
    base,
  )
  fixtures.push({
    system: 'plumbing',
    kind: 'cleanout',
    position: [stackNode[0], 0.15, stackNode[1]],
    rotationY: 0,
    sourceId: 'dwv-stack',
    label: 'Cleanout at stack base (P3005.2)',
  })

  // ---- one re-vent riser per wet wall (P3104.4): the carrier is the
  // wall's trap nearest the stack. HOISTED before the trap loop so every
  // trap can measure its TRUE weir→vent distance against the riser that
  // actually serves it — the old flag measured fixture→wall, so one
  // re-vent "served" every trap on the wall at ANY distance (B20). ----
  const ventWalls = new Map<string, Anchored>()
  for (const a of anchored) {
    if (a.island) continue
    const prev = ventWalls.get(a.anchor.wall.id)
    if (!prev || a.dist < prev.dist) ventWalls.set(a.anchor.wall.id, a)
  }
  /** The vent point serving a trap: its wall's re-vent riser when that
   * wall carries one, else the stack (which IS the vent when the carrier
   * stands on the stack wall bay — the loop below skips the redundant
   * riser). Islands have NO modeled vent — the stack is the nearest one.
   * `kind` names the measured target so a flag on a vent-less wall STATES
   * what it measured to (skeptic attack 3: never crash, never vague). */
  const ventNodeFor = (a: Anchored): { at: Pt; kind: string } => {
    const carrier = ventWalls.get(a.anchor.wall.id)
    if (carrier && !a.island && manhattanDist(carrier.plan, stackAt) >= 0.3) {
      return { at: carrier.node, kind: "its wall's re-vent" }
    }
    return { at: stackNode, kind: 'the stack vent' }
  }

  // ---- per fixture: stub-out + P-trap + trap arm + DFU-sized branch ----
  for (const a of anchored) {
    const rotationY = a.island
      ? a.f.yaw
      : Math.atan2(a.f.plan[0] - a.plan[0], a.f.plan[1] - a.plan[1])
    fixtures.push({
      system: 'plumbing',
      kind: 'stub-out',
      position: [a.stubAt[0], a.stubY, a.stubAt[1]],
      rotationY,
      sourceId: a.f.id,
      label: `${KIND_LABEL[a.f.kind]} rough-in — supply @ ${Math.round(a.stubY / 0.0254)}" AFF, ${a.f.drainIn}" trap`,
      meta: { fixtureId: a.f.id, kind: a.f.kind, hot: a.f.hot, dfu: a.f.dfu },
    })

    const drainSide = pipeSide(Math.max(a.f.drainIn, 1.25))
    const yNode = base + a.rise
    if (fab) {
      // IRC P2705.1: WC centerline ≥ 30" center-to-center from neighbors —
      // measured WITHIN a room: a wall between the two fixtures means
      // back-to-back bathrooms, not a clearance violation (verify round D5).
      const wallBetween = (pA: Pt, pB: Pt): boolean =>
        walls.some((w) => {
          const q1: Pt = w.start
          const q2: Pt = [w.start[0] + w.dir[0] * w.length, w.start[1] + w.dir[1] * w.length]
          const d = (o: Pt, e: Pt, pt: Pt) => (e[0] - o[0]) * (pt[1] - o[1]) - (e[1] - o[1]) * (pt[0] - o[0])
          const d1 = d(pA, pB, q1)
          const d2 = d(pA, pB, q2)
          const d3 = d(q1, q2, pA)
          const d4 = d(q1, q2, pB)
          return d1 * d2 < 0 && d3 * d4 < 0
        })
      const crowd =
        a.f.kind === 'toilet'
          ? placed.find(
              (o) =>
                o.id !== a.f.id &&
                Math.hypot(o.plan[0] - a.f.plan[0], o.plan[1] - a.f.plan[1]) < inches(30) &&
                !wallBetween(a.f.plan, o.plan),
            )
          : undefined
      // The arm's EMITTED plan length: dropAt → junction (a flush fixture's
      // drop is pulled to the junction, R4b — the arm then vanishes).
      const armPlan = Math.hypot(a.node[0] - a.dropAt[0], a.node[1] - a.dropAt[1])
      const yArm = yNode + armPlan * slopeFor(a.f.drainIn)
      // A trap riser dropping inside a door/window rough opening is never
      // silent (verify round D4: unflagged 1.25" riser through a doorway).
      // Tested at the riser's ACTUAL plan point (dropAt).
      const riserTop = Math.max(DRAIN_CONN_Y[a.f.kind], 0.5)
      const inRO = walls.some((w) => {
        const dx = a.dropAt[0] - w.start[0]
        const dz = a.dropAt[1] - w.start[1]
        const u = dx * w.dir[0] + dz * w.dir[1]
        const off = Math.abs(-dx * w.dir[1] + dz * w.dir[0])
        if (off > w.thickness / 2 + 0.06 || u < 0 || u > w.length) return false
        return openingSpans(w, 0, riserTop).some((sp) => u > sp.lo && u < sp.hi)
      })
      const roFlag = inRO
        ? `OPENING: ${KIND_LABEL[a.f.kind]} sits in a door/window rough opening — its trap riser crosses the RO; move the fixture`
        : undefined
      // A drop pinched between concrete bands (unclampable corner) emits
      // SLEEVED — the label is what the drainage SAT gate exempts, and a
      // FLAG carries it onto the schedules block (P4): the riser is
      // VERTICAL so the sheets' tick layer never draws it — a label alone
      // was paper-invisible (examiner gap, closing round).
      const dropSleeveNote = a.dropSleeved ? ' — sleeved where it crosses concrete (P2603.4)' : ''
      const sleeveFlag = a.dropSleeved
        ? `SLEEVE: ${KIND_LABEL[a.f.kind]} trap drop is pinched between concrete footings — sleeved through the pour (P2603.4); coordinate the sleeve before placement`
        : undefined
      const crowdFlag = crowd
        ? `CLEARANCE: ${KIND_LABEL[crowd.kind]} sits within 30" of the WC centerline (P2705.1)`
        : undefined
      const dropFlags = [roFlag, crowdFlag, sleeveFlag].filter(Boolean).join(' | ')
      riser(
        members,
        {
          side: drainSide,
          material: 'pvc',
          role: 'pipe-run',
          sourceId: `dwv-trap-${a.f.id}`,
          label: `${a.f.drainIn}" P-trap + drop — ${KIND_LABEL[a.f.kind]} (P3201)${dropSleeveNote}`,
          flag: dropFlags.length > 0 ? dropFlags : undefined,
        },
        a.dropAt,
        DRAIN_CONN_Y[a.f.kind],
        yArm,
      )
      // Trap arm — Table P3105.1 limits the TRAP WEIR → VENT FITTING
      // distance, not fixture → wall (B20: the old measure let one re-vent
      // serve every trap on its wall at any distance). The developed
      // distance runs down the emitted arm to the junction, then along the
      // branch to the vent riser serving this wall (or the stack when it
      // IS the vent — islands' nearest vent is always the stack). WCs are
      // exempt in the IRC; flagged anyway when clearly unroutable.
      const limit = trapArmMax(a.f.drainIn)
      const vent = ventNodeFor(a)
      const weirToVent = armPlan + manhattanDist(a.node, vent.at)
      const islandFlag = a.island
        ? `ISLAND VENT: ${KIND_LABEL[a.f.kind]} is an island fixture — island venting required (P3112), not modeled; verify loop vent/AAV with the AHJ`
        : undefined
      const armFlag =
        weirToVent > limit
          ? `TRAP ARM: ${KIND_LABEL[a.f.kind]} trap weir sits ${round1ft(weirToVent)} ft from ${vent.kind} — exceeds ${toFeet(limit).toFixed(0)} ft for a ${a.f.drainIn}" arm (Table P3105.1); vent closer to the trap`
          : undefined
      const ventFlags = [islandFlag, armFlag].filter(Boolean).join(' | ')
      leg(
        members,
        {
          side: drainSide,
          material: 'pvc',
          role: 'pipe-run',
          sourceId: `dwv-arm-${a.f.id}`,
          label: `${a.f.drainIn}" trap arm — ${KIND_LABEL[a.f.kind]} (weir→vent ≤ ${toFeet(limit).toFixed(0)} ft, P3105.1)${dropSleeveNote}`,
          flag: ventFlags.length > 0 ? ventFlags : undefined,
        },
        a.dropAt,
        a.node,
        yArm,
        true,
        0.015,
        slopeFor(a.f.drainIn),
      )
    }
    // Branch drain toward the parent node — DFU-sized (P3004.1/P3005.4.1),
    // falling at the P3005.3 slope for its size. Junction-to-junction:
    // every buried node sits DROP_SETBACK inboard of its wall (S1); legs
    // that still cross concrete transversally (courtyard stemwalls, R3)
    // carry the per-crossing sleeve note.
    const pNode = a.parent >= 0 ? (anchored[a.parent] as Anchored).node : stackNode
    drainManhattan(
      members,
      {
        side: pipeSide(a.edgeSize),
        material: 'pvc',
        role: 'pipe-run',
        sourceId: `dwv-branch-${a.f.id}`,
        label: `${a.edgeSize}" branch drain — ${a.subDfu} DFU @ ${a.edgeSize >= 3 ? '1/8' : '1/4'}"/ft (P3004.1, P3005.3)`,
      },
      walls,
      spec,
      a.node,
      pNode,
      yNode,
      slopeFor(a.edgeSize),
      groundLevel,
    )
  }

  // ---- building drain: stack base → sewer-exit cleanout at the nearest
  // exterior point (or the sewer-exit service node, verbatim — the drains
  // re-slope toward wherever it stands), at 1/4"/ft ----
  const core: Pt = [wx, wz]
  const exit: Pt =
    overridePlanPoint(walls, overrides?.sewerExit) ?? sewerExitFrom(walls, stackAt, core)
  const drainTable = rules.plumbing?.dwv?.maxDfuBuildingDrainBySizeAtQuarterInSlope ?? {}
  const cap3 = drainTable['3'] ?? 42
  const cap4 = drainTable['4'] ?? 216
  // No size reduction in the direction of flow (P3005.3 / module contract):
  // the main is at least the largest branch discharging into the stack
  // (verify round D3: a 4" branch fed a 3" main unflagged).
  const maxBranchIn = anchored.reduce((m, a) => Math.max(m, a.edgeSize), 0)
  const mainSize = Math.max(
    totalDfu > cap3 ? 4 : (rules.plumbing?.dwv?.buildingDrainIn ?? 3),
    maxBranchIn,
  )
  // Every main leg that passes through concrete carries its own P2603.4
  // sleeve note (per-crossing, R2); legs shallower than a wall's footing
  // sleeve, deep frost footings are passed under. Above the ground storey
  // there is no foundation and no sewer: the run is a branch main that
  // NEEDS a riser to the storey below — say so instead of printing
  // foundation fiction (S2).
  drainManhattan(
    members,
    {
      side: pipeSide(mainSize),
      material: 'pvc',
      role: 'pipe-run',
      sourceId: 'dwv-main',
      label: groundLevel
        ? `${mainSize}" building drain — ${totalDfu} DFU @ 1/4"/ft → sewer/septic (P3005.4.1)`
        : `${mainSize}" drain main — ${totalDfu} DFU @ 1/4"/ft → riser to storey below (not modeled)`,
      flag:
        totalDfu > cap4
          ? `UNDERSIZED: ${totalDfu} DFU exceeds ${cap4} on a 4" building drain (P3005.4.1) — engineered sizing required`
          : undefined,
    },
    walls,
    spec,
    stackNode,
    exit,
    base,
    0.25 / 12,
    groundLevel,
  )
  fixtures.push({
    system: 'plumbing',
    kind: 'cleanout',
    position: [exit[0], 0.15, exit[1]],
    rotationY: 0,
    sourceId: 'dwv-main',
    label: groundLevel
      ? 'Cleanout @ sewer exit (P3005.2.1)'
      : 'Cleanout @ drain main terminus (P3005.2)',
  })

  // ---- re-vents: one per wet wall, rising to 6" above the flood rim and
  // returning to the stack along the wall graph (P3104.4). The map is
  // hoisted above the trap loop (weir→vent measurement). ----
  if (fab) {
    for (const [wallId, a] of ventWalls) {
      if (manhattanDist(a.plan, stackAt) < 0.3) continue // the stack IS this wall's vent
      const ventSpec: PipeSpec = {
        side: VENT_SIDE,
        material: 'pvc',
        role: 'pipe-run',
        sourceId: `dwv-vent-${wallId}`,
        label: '1½" re-vent — reconnects 6" above flood rim (P3104.4)',
      }
      // Rise at the buried junction (inboard — never inside a frost
      // stemwall), jog to the wall above the flood rim, then follow the
      // wall graph back to the stack.
      riser(members, ventSpec, a.node, base + a.rise, VENT_RECONNECT_Y)
      leg(members, ventSpec, a.node, a.plan, VENT_RECONNECT_Y, false, 0.015)
      routePipe(members, ventSpec, graph, a.anchor, stackAnchor, VENT_RECONNECT_Y, walls)
    }
  }

  // ---- main water service: meter on the longest exterior wall, clear of
  // ROs (P2903.7: ¾" minimum service) — or the water-entry service node ----
  const meterForced = overrideWallPoint(walls, overrides?.waterEntry)
  const meterSpot = meterForced
    ? { wall: meterForced.wall, u: meterForced.u, heightAff: overrides?.waterEntry?.heightAff ?? 0.3 }
    : (placeMeterSpot(straight) as { wall: WallSlice; u: number; heightAff: number })
  const meterWall = meterSpot.wall
  const meterU = meterSpot.u
  const meterAnchor: WallPoint = { wall: meterWall, u: meterU }
  const meterPlan = wallPlan(meterAnchor) as Pt
  const METER_Y = meterSpot.heightAff
  // NEC 110.26(E): the panel's dedicated space (equipment footprint, floor
  // → 6 ft above) admits NO foreign piping — and both trades elect the
  // longest wall at panelMountU, so the meter + cold-main riser land
  // exactly there (wave-2 confirmed). HONEST WARNING here; the cross-
  // engine spatial reservation itself rides B12/B16. Threshold: half the
  // 30" working-space width + half a meter body.
  const panelForced = overrideWallPoint(walls, overrides?.panel)
  const panelSpot = panelForced ?? placePanelSpot(walls, rooms)
  const meterInPanelSpace =
    panelSpot !== null &&
    panelSpot.wall.id === meterWall.id &&
    Math.abs(panelSpot.u - meterU) < inches(15) + 0.15
  const panelClashFlag = meterInPanelSpace
    ? `TRADE CLASH: water meter + cold main sit in the electrical panel's dedicated space (NEC 110.26(E) — no foreign piping over the panel footprint); move the water entry along the wall`
    : undefined
  fixtures.push({
    system: 'plumbing',
    kind: 'water-meter',
    position: [meterPlan[0], METER_Y, meterPlan[1]],
    rotationY: 0,
    sourceId: meterWall.id,
    label: `Water service meter — ¾" min (P2903.7)${meterInPanelSpace ? ' — ⚠ in panel dedicated space (NEC 110.26(E))' : ''}`,
  })

  // ---- water heater: garage wall like the electrical panel (tank, M1307.3
  // 18" ignition height) — else tankless on an exterior wall at 1.2 m AFF —
  // or the water-heater service node, verbatim ----
  const whForced = overrideWallPoint(walls, overrides?.waterHeater)
  const whSpot = whForced
    ? {
        wall: whForced.wall,
        u: whForced.u,
        tank: garageBoundingWall(whForced.wall, rooms) !== undefined,
      }
    : placeWhSpot(walls, rooms)
  if (!whSpot) return { members, fixtures }
  const whWall = whSpot.wall
  const whU = whSpot.u
  const tank = whSpot.tank
  const whAnchor: WallPoint = { wall: whWall, u: whU }
  const whWallPlan = wallPlan(whAnchor) as Pt
  let side: 1 | -1 = 1
  const whGarage = tank ? garageBoundingWall(whWall, rooms) : undefined
  if (whGarage) {
    if (pointInPolygon(facePoint(whWall, -1, whU), whGarage.polygon)) side = -1
  } else if (rooms.some((r) => pointInPolygon(facePoint(whWall, -1, whU), r.polygon))) {
    side = -1
  }
  // Tank anchor measures from the FINISHED FACE, not the centerline — the
  // old 0.35-from-centerline put the pan edge AT the centerline (6 cm into
  // the studs) and the stand through the plate band (examiner, closing
  // round): face + pan overhang (5 cm) + 2 cm gap + tank half-depth (0.3).
  const whOff = tank ? whWall.thickness / 2 + 0.05 + 0.02 + 0.3 : whWall.thickness / 2 + 0.13
  const nx = -whWall.dir[1] * side
  const nz = whWall.dir[0] * side
  const whPlan: Pt = [whWallPlan[0] + nx * whOff, whWallPlan[1] + nz * whOff]
  const whDims: readonly [number, number, number] = tank ? [0.6, 1.5, 0.6] : [0.45, 0.6, 0.25]
  const whBottom = tank ? inches(18) : 1.2 // M1307.3 garage ignition height
  const whCenterY = overrides?.waterHeater?.heightAff ?? whBottom + whDims[1] / 2
  members.push({
    system: 'plumbing',
    role: 'water-heater',
    dims: whDims,
    length: whDims[1],
    position: [whPlan[0], whCenterY, whPlan[1]],
    rotation: [0, Math.atan2(nx, nz), 0],
    material: 'steel',
    sourceId: 'wh',
    label: tank
      ? 'Water heater — 50 gal tank (M1305.1 30×30" service space, M1307.3 18" ignition height)'
      : 'Tankless water heater — wall-mounted 1.2 m AFF (M1305.1 service space)',
  })
  fixtures.push({
    system: 'plumbing',
    kind: 'water-heater',
    position: [whPlan[0], whCenterY, whPlan[1]],
    rotationY: Math.atan2(nx, nz),
    sourceId: 'wh',
    label: tank ? 'Water heater (50 gal tank)' : 'Water heater (tankless)',
  })

  // ---- WH safety hardware (B20 — the tank used to ship BARE and floating
  // 18" in the air): a STAND is what holds the burner at the M1307.3
  // ignition height, the tank sits in a drain pan (P2801.6), every heater
  // carries a T&P relief valve with a full-size discharge terminating
  // within 6" of the floor (P2803.6.1), and SDC-D specs strap the tank at
  // its upper + lower thirds (P2801.8). Low-seismic specs ship NO straps —
  // the matrix is spec-driven, never blanket. ----
  const whRules = rules.plumbing?.supply?.waterHeater
  const whBot = whCenterY - whDims[1] / 2
  const whYaw = Math.atan2(nx, nz)
  const PAN_DEPTH = Math.max(inches(whRules?.panMinDepthIn ?? 1.5), 0.05)
  if (tank) {
    const standH = whBot - (fab ? PAN_DEPTH : 0)
    if (standH > 0.02) {
      members.push({
        system: 'plumbing',
        role: 'equipment',
        dims: [whDims[0] + 0.06, standH, whDims[2] + 0.06],
        length: standH,
        position: [whPlan[0], standH / 2, whPlan[1]],
        rotation: [0, whYaw, 0],
        material: 'steel',
        sourceId: 'wh-stand',
        label: 'Water-heater stand — ignition source 18" above the garage floor (M1307.3)',
      })
    }
    if (fab) {
      // Pan directly under the tank, on the stand — tank rests IN the pan.
      members.push({
        system: 'plumbing',
        role: 'equipment',
        dims: [whDims[0] + 0.1, PAN_DEPTH, whDims[2] + 0.1],
        length: whDims[0] + 0.1,
        position: [whPlan[0], Math.max(PAN_DEPTH / 2, whBot - PAN_DEPTH / 2), whPlan[1]],
        rotation: [0, whYaw, 0],
        material: 'steel',
        sourceId: 'wh-pan',
        label: 'Water-heater drain pan — ¾" drain to approved location (P2801.6)',
      })
    }
    if (fab && spec.seismicHoldDowns) {
      // P2801.8 (SDC D0–D2 / state amendments incl. CA): strap within the
      // upper AND lower thirds of the tank; the lower one ≥ 4" above the
      // controls. Each strap = a 3-leg band (wall face → around the tank
      // front → wall face), lagged to the wall framing.
      const wallFace: Pt = [
        whWallPlan[0] + nx * (whWall.thickness / 2),
        whWallPlan[1] + nz * (whWall.thickness / 2),
      ]
      const halfW = whDims[0] / 2 + 0.02
      const frontOff = whOff + whDims[2] / 2 + 0.02
      const frontC: Pt = [whWallPlan[0] + nx * frontOff, whWallPlan[1] + nz * frontOff]
      // Lower strap: inside the lower third but never closer than the
      // data's controls clearance (controls sit ~15 cm up a tank shell).
      const controlsClearIn = whRules?.seismicStraps?.lowerAboveControlsIn ?? 4
      const lowerY = Math.max(whBot + whDims[1] / 4, whBot + 0.15 + inches(controlsClearIn))
      const strapYs: [string, number][] = [
        ['upper', whBot + whDims[1] * (5 / 6)],
        ['lower', lowerY],
      ]
      for (const [zone, strapY] of strapYs) {
        const sSpec: PipeSpec = {
          side: 0.03,
          material: 'steel',
          role: 'equipment',
          sourceId: `wh-strap-${zone}`,
          label: `Seismic strap — ${zone} third of tank, lagged to wall framing (P2801.8)`,
        }
        const along = (p: Pt, s: number): Pt => [
          p[0] + whWall.dir[0] * s,
          p[1] + whWall.dir[1] * s,
        ]
        leg(members, sSpec, along(wallFace, -halfW), along(frontC, -halfW), strapY, false, 0.01)
        leg(members, sSpec, along(frontC, -halfW), along(frontC, halfW), strapY, false, 0.01)
        leg(members, sSpec, along(frontC, halfW), along(wallFace, halfW), strapY, false, 0.01)
      }
    }
  }
  if (fab) {
    // T&P relief valve on the tank side (tankless: cabinet bottom), its
    // discharge dropping OUTSIDE the pan rim to within 6" of the floor.
    const TP_TERM_IN = whRules?.tpDischargeMaxAboveFloorIn ?? 6
    const bodyHalf = tank ? whDims[0] / 2 : Math.max(whDims[0], whDims[2]) / 2
    const tpY = tank ? whCenterY + whDims[1] / 2 - 0.15 : whBot + 0.08
    const alongWall = (p: Pt, s: number): Pt => [
      p[0] + whWall.dir[0] * s,
      p[1] + whWall.dir[1] * s,
    ]
    const valveAt = alongWall(whPlan, bodyHalf + 0.04)
    const dischargeAt = alongWall(whPlan, bodyHalf + 0.13)
    members.push({
      system: 'plumbing',
      role: 'equipment',
      dims: [0.09, 0.08, 0.06],
      length: 0.09,
      position: [valveAt[0], tpY, valveAt[1]],
      rotation: [0, Math.atan2(-whWall.dir[1], whWall.dir[0]), 0],
      material: 'copper',
      sourceId: 'wh-tp-valve',
      label: 'T&P relief valve (P2803.1)',
    })
    const tpSpec: PipeSpec = {
      side: SUPPLY_MAIN,
      material: 'copper',
      role: 'pipe-run',
      sourceId: 'wh-tp-discharge',
      label: `¾" T&P discharge — terminates ${TP_TERM_IN}" above the floor (P2803.6.1)`,
    }
    leg(members, tpSpec, valveAt, dischargeAt, tpY, false, 0.01)
    riser(members, tpSpec, dischargeAt, tpY, inches(TP_TERM_IN))
  }

  // ---- supply: ¾" cold main meter → WH, manifolds at the WH wall, then
  // ½" hot/cold homeruns along the wall graph on stepped planes ----
  if (fab) {
    const mainSpec: PipeSpec = {
      side: SUPPLY_MAIN,
      material: 'copper',
      role: 'pipe-run',
      sourceId: 'cold-main',
      label: 'Cold main ¾" — water service (P2903.7)',
    }
    // The meter riser is the pipe that physically stands in the panel's
    // dedicated space when the trades collide — it carries the warning.
    riser(
      members,
      panelClashFlag ? { ...mainSpec, flag: panelClashFlag } : mainSpec,
      meterPlan,
      METER_Y,
      SUPPLY_COLD_Y,
    )
    routePipe(members, mainSpec, graph, meterAnchor, whAnchor, SUPPLY_COLD_Y, walls)
    // Manifold riser at the WH wall bay: crosses every stepped cold plane,
    // then feeds the tank inlet.
    riser(members, mainSpec, whWallPlan, SUPPLY_COLD_Y, whCenterY)
    leg(members, mainSpec, whWallPlan, whPlan, whCenterY, false, 0.015)
    const hotMain: PipeSpec = {
      side: SUPPLY_MAIN,
      material: 'copper',
      role: 'pipe-run',
      sourceId: 'hot-main',
      label: 'Hot header ¾" — from water heater',
    }
    const hotHeaderY = whCenterY - 0.1
    leg(members, hotMain, whPlan, whWallPlan, hotHeaderY, false, 0.015)
    riser(members, hotMain, whWallPlan, hotHeaderY, SUPPLY_HOT_Y)

    let coldIdx = 0
    let hotIdx = 0
    for (const a of anchored) {
      const coldY = SUPPLY_COLD_Y + (coldIdx++ % 6) * SUPPLY_STEP
      const cold: PipeSpec = {
        side: SUPPLY_BRANCH,
        material: 'copper',
        role: 'pipe-run',
        sourceId: `cold-${a.f.id}`,
        label: `Cold ½" — ${KIND_LABEL[a.f.kind]}`,
      }
      routePipe(members, cold, graph, whAnchor, a.anchor, coldY, walls)
      riser(members, cold, a.plan, coldY, a.stubY)
      if (a.island) {
        manhattan(
          members,
          {
            ...cold,
            label: `${cold.label} (island — air run under floor, verify)`,
            flag: `ISLAND: ${KIND_LABEL[a.f.kind]} sits ${round1ft(a.offWall)} ft from the nearest wall — supply routed as an air run; run it under the floor`,
          },
          a.plan,
          a.stubAt,
          a.stubY,
          false,
        )
      } else if (a.offWall > CONN_MIN) {
        // Visible braided connector stub → fixture (islands keep air runs).
        connectorArc(
          members,
          walls,
          'cold',
          a.f.id,
          [a.plan[0], a.stubY, a.plan[1]],
          [a.f.plan[0], CONN_HEIGHT[a.f.kind], a.f.plan[1]],
        )
      }
      if (a.f.hot) {
        const hotY = SUPPLY_HOT_Y + (hotIdx++ % 6) * SUPPLY_STEP
        const hot: PipeSpec = {
          side: SUPPLY_BRANCH,
          material: 'copper',
          role: 'pipe-run',
          sourceId: `hot-${a.f.id}`,
          label: `Hot ½" — ${KIND_LABEL[a.f.kind]} (WH loop)`,
        }
        // Hot drops in the same bay, nudged 1" along the wall so red and
        // blue never z-fight (lav spread is 8" in reality).
        const hotAt: Pt = [
          a.plan[0] + a.anchor.wall.dir[0] * 0.025,
          a.plan[1] + a.anchor.wall.dir[1] * 0.025,
        ]
        routePipe(members, hot, graph, whAnchor, a.anchor, hotY, walls)
        leg(members, hot, a.plan, hotAt, hotY, false, 0.01)
        riser(members, hot, hotAt, hotY, a.stubY)
        if (a.island) {
          manhattan(
            members,
            { ...hot, label: `${hot.label} (island — air run under floor, verify)` },
            hotAt,
            a.stubAt,
            a.stubY,
            false,
          )
        } else if (a.offWall > CONN_MIN) {
          // Hot connector lands beside the cold one — same 1" nudge along
          // the wall as the hot drop, so red and blue hoses never z-fight.
          connectorArc(
            members,
            walls,
            'hot',
            a.f.id,
            [hotAt[0], a.stubY, hotAt[1]],
            [
              a.f.plan[0] + a.anchor.wall.dir[0] * 0.025,
              CONN_HEIGHT[a.f.kind],
              a.f.plan[1] + a.anchor.wall.dir[1] * 0.025,
            ],
          )
        }
      }
    }
  }

  return { members, fixtures }
}

// ---------------------------------------------------------------------------
// The engine — dispatcher + room-category fallback
// ---------------------------------------------------------------------------

/**
 * Lay out plumbing for one level. When the scene carries PLACED sanitary
 * fixtures they are the demand points; otherwise the room-category fallback
 * guesses a schematic layout from wet-room zones.
 */
export function layoutPlumbing(
  walls: WallSlice[],
  rooms: RoomSlice[],
  spec: FramingSpec = DEFAULT_SPEC,
  placed: PlacedFixtureSlice[] = [],
  overrides?: ServiceOverrides,
  /** False on upper storeys: no foundation to sleeve, no sewer to reach —
   * the drain main truthfully labels its missing riser instead (S2). */
  groundLevel = true,
): { members: Member[]; fixtures: Fixture[] } {
  if (placed.length > 0) {
    const result = placedPlumbing(walls, rooms, spec, placed, overrides, groundLevel)
    // Placed fixtures but no usable walls → let the fallback try (it
    // returns empty on wall-less scenes too, but never crashes).
    if (result.members.length > 0 || result.fixtures.length > 0) return result
  }
  return roomPlumbing(walls, rooms, spec, overrides, groundLevel)
}

type Stub = {
  kind: Fixture['kind']
  y: number
  label: string
  offset: number
  /** Toilets are cold-only — everything else joins the water-heater loop. */
  hot: boolean
  /** Drain size (in) by fixture class — Table P3005.4.1 labels. */
  drainIn: number
  /** Where the tailpiece leaves the fixture (closet flange / shower pan at
   * the floor, lav/sink trap under the rim) — the drop's TOP. */
  dropY: number
  dropLabel: string
}

/** Room-category fixture set: the drainage fixtures a wet room implies.
 * Supply stub heights are practice rough-ins (fixtureRoughIn.*); drain
 * sizes are the Table P3005.4.1 fixture classes (WC 3", shower 2",
 * lav/sink 1½", washer standpipe 2"). */
function fallbackStubs(category: RoomSlice['category']): Stub[] {
  if (category === 'bathroom') {
    return [
      {
        kind: 'stub-out',
        y: inches(rules.plumbing?.fixtureRoughIn?.toiletCenterFromWallIn ?? 12),
        label: 'Toilet rough-in 12" off wall',
        offset: -0.4,
        hot: false,
        drainIn: 3,
        dropY: 0,
        dropLabel: '3" closet bend — toilet drop through floor (Table P3005.4.1)',
      },
      {
        kind: 'stub-out',
        y: inches(rules.plumbing?.fixtureRoughIn?.showerValveHeightIn ?? 44),
        label: 'Shower valve rough-in 44" AFF',
        offset: 0,
        hot: true,
        drainIn: 2,
        dropY: 0,
        dropLabel: '2" shower trap — drop through floor (Table P3005.4.1)',
      },
      {
        kind: 'stub-out',
        y: inches(rules.plumbing?.fixtureRoughIn?.lavHeightIn ?? 21),
        label: 'Lavatory supply/drain',
        offset: 0.4,
        hot: true,
        drainIn: 1.5,
        dropY: inches(rules.plumbing?.fixtureRoughIn?.lavDrainHeightIn ?? 19),
        dropLabel: '1.5" lav trap + drop through floor (Table P3005.4.1)',
      },
    ]
  }
  if (category === 'kitchen') {
    return [
      {
        kind: 'stub-out',
        y: inches(18),
        label: 'Kitchen sink supply/drain',
        offset: 0,
        hot: true,
        drainIn: 1.5,
        dropY: inches(18),
        dropLabel: '1.5" sink trap + drop through floor (Table P3005.4.1)',
      },
    ]
  }
  return [
    {
      kind: 'stub-out',
      y: inches(42),
      label: 'Laundry box',
      offset: 0,
      hot: true,
      drainIn: 2,
      dropY: inches(30),
      dropLabel: '2" washer standpipe + drop through floor (Table P3005.4.1)',
    },
  ]
}

/** Room-category fallback — used when the scene carries no placed fixtures. */
function roomPlumbing(
  walls: WallSlice[],
  rooms: RoomSlice[],
  spec: FramingSpec,
  overrides?: ServiceOverrides,
  groundLevel = true,
): { members: Member[]; fixtures: Fixture[] } {
  const members: Member[] = []
  const fixtures: Fixture[] = []
  const fab = spec.detail !== '200' // traps/vents/supply branches gate
  const wetRooms = rooms.filter((r) =>
    r.category === 'kitchen' || r.category === 'bathroom' || r.category === 'laundry',
  )
  if (wetRooms.length === 0 || walls.length === 0) return { members, fixtures }

  // Shared wet core: the centroid of every wet room — plumbing clusters.
  const core = polygonCentroid(wetRooms.flatMap((r) => [polygonCentroid(r.polygon)]))

  // The stack lives at the bathroom's wet wall (else the first wet room's).
  const stackRoom = wetRooms.find((r) => r.category === 'bathroom') ?? (wetRooms[0] as RoomSlice)
  const stackWall = wetWallFor(stackRoom, walls, core)
  if (!stackWall) return { members, fixtures }
  const stackAt = nearestOnWall(stackWall, polygonCentroid(stackRoom.polygon)).point
  // Buried root junction — inboard of the stack wall (toward the wet
  // core), so the under-floor tee and its drop never sit inside a
  // frost-depth stemwall (S1).
  const stackNode = inboardOf(stackAt, stackWall, core)
  const stackHeight = stackWall.height + 0.6 // through-roof vent (P3103.1)

  members.push({
    system: 'plumbing',
    role: 'vent-stack',
    dims: [STACK_SIDE, stackHeight, STACK_SIDE],
    length: stackHeight,
    position: [stackAt[0], stackHeight / 2, stackAt[1]],
    rotation: [0, 0, 0],
    material: 'pvc',
    sourceId: stackRoom.id,
    label: '3" DWV vent stack (through roof)',
    flag: stackShieldFlag(stackWall.thickness),
  })
  fixtures.push({
    system: 'plumbing',
    kind: 'cleanout',
    position: [stackAt[0], 0.15, stackAt[1]],
    rotationY: 0,
    sourceId: stackRoom.id,
    label: 'Cleanout (P3005.2)',
  })

  // ---- per wet room: geometry pre-pass. Drops leave the wet wall
  // DROP_SETBACK into the room (through-floor risers clear the footings
  // under the wall) and rises chain from the stack per P3005.3 so the
  // whole tree can be buried in one pass. ----
  type RoomDwv = {
    room: RoomSlice
    wall: WallSlice
    /** Wall point nearest the room centroid — supply stubs live here. */
    at: Pt
    rotationY: number
    /** Unit normal, wall → room centroid. */
    normal: Pt
    /** Under-floor branch collection point, DROP_SETBACK into the room. */
    roomAt: Pt
    stubs: Stub[]
    /** Along-wall stub offsets CLAMPED into the room polygon (R4a: a 1 m
     * corner bath put the toilet drop inside the side wall's stemwall; a
     * 0.7 m one dropped it outside the building). Aligned with `stubs`. */
    offsets: number[]
    drainIn: number
    branchPlan: number
    /** Branch arrival rise above the stack base at roomAt (P3005.3). */
    rise: number
  }
  const plans: RoomDwv[] = []
  for (const room of wetRooms) {
    const wall = wetWallFor(room, walls, core)
    if (!wall) continue
    const centroid = polygonCentroid(room.polygon)
    const at = nearestOnWall(wall, centroid).point
    // Face the room: normal pointing from the wall point toward the centroid.
    let nx = centroid[0] - at[0]
    let nz = centroid[1] - at[1]
    const nLen = Math.hypot(nx, nz)
    if (nLen < 1e-6) {
      nx = -wall.dir[1]
      nz = wall.dir[0]
    } else {
      nx /= nLen
      nz /= nLen
    }
    const roomAt: Pt = [at[0] + nx * DROP_SETBACK, at[1] + nz * DROP_SETBACK]
    // Branch size: the bathroom group carries the WC — its branch must be 3"
    // (P3005 water closets discharge to min 3"); sinks/laundry run 2".
    const drainIn = room.category === 'bathroom' ? (rules.plumbing?.dwv?.buildingDrainIn ?? 3) : 2
    const branchPlan = manhattanDist(roomAt, stackNode)
    const stubs = fallbackStubs(room.category)
    // R4a: shrink each along-wall offset until the DROP point (with the
    // perpendicular pull applied) sits inside the room polygon with a
    // 0.25 m margin from the side edges — clear of a side wall's 16"
    // footing band. A room too small even at offset 0 keeps the center.
    const clampOffset = (want: number): number => {
      const margin = 0.25
      const sign = want < 0 ? -1 : 1
      for (let mag = Math.abs(want); mag >= 0; mag = Math.round((mag - 0.05) * 100) / 100) {
        const off = sign * mag
        const px = at[0] + wall.dir[0] * off + nx * DROP_SETBACK
        const pz = at[1] + wall.dir[1] * off + nz * DROP_SETBACK
        const inside =
          pointInPolygon([px, pz], room.polygon) &&
          pointInPolygon([px + wall.dir[0] * margin, pz + wall.dir[1] * margin], room.polygon) &&
          pointInPolygon([px - wall.dir[0] * margin, pz - wall.dir[1] * margin], room.polygon)
        if (inside) return off
      }
      return 0
    }
    plans.push({
      room,
      wall,
      at,
      rotationY: Math.atan2(nx, nz),
      normal: [nx, nz],
      roomAt,
      stubs,
      offsets: stubs.map((s) => clampOffset(s.offset)),
      drainIn,
      branchPlan,
      rise: branchPlan * slopeFor(drainIn),
    })
  }
  // Bury the tree: the highest drop arrival still sits UNDER_FLOOR_CLEAR
  // below the floor plane (same convention as the placed-fixture engine).
  let maxRise = 0
  for (const p of plans) {
    for (const [i, stub] of p.stubs.entries()) {
      maxRise = Math.max(
        maxRise,
        p.rise + Math.abs(p.offsets[i] ?? stub.offset) * slopeFor(stub.drainIn),
      )
    }
  }
  const base = -(maxRise + UNDER_FLOOR_CLEAR)

  // The stack's below-floor connection to the buried building drain: a
  // floor-line jog from the wall to the INBOARD junction (R1 — without it
  // the through-roof stack tied into NOTHING), then a vertical drop
  // sleeved through the slab per P2603.4: concrete is never pierced bare.
  // Above the ground storey there is no slab to sleeve.
  const yJog = leg(
    members,
    {
      side: MAIN_DRAIN,
      material: 'pvc',
      role: 'pipe-run',
      sourceId: 'dwv-stack-base',
      label: '3" stack base — floor-line jog to the buried drop',
    },
    stackAt,
    stackNode,
    MAIN_DRAIN / 2 + 0.04, // bottom face clears the 3/4" deck top over its fall
    true,
    0.01,
  )
  riser(
    members,
    {
      side: MAIN_DRAIN,
      material: 'pvc',
      role: 'pipe-run',
      sourceId: 'dwv-stack-base',
      label: groundLevel
        ? '3" stack base drop — sleeved through slab (P2603.4)'
        : '3" stack base drop — into the floor cavity',
    },
    stackNode,
    yJog,
    base,
  )

  // ---- per wet room: stubs + through-floor drops + buried branch drains ----
  for (const p of plans) {
    const { room, wall } = p
    const dfu = DFU_BY_CATEGORY[room.category] ?? 2
    const yRoom = base + p.rise
    for (const [i, stub] of p.stubs.entries()) {
      const off = p.offsets[i] ?? stub.offset
      const stubAt: Pt = [p.at[0] + wall.dir[0] * off, p.at[1] + wall.dir[1] * off]
      fixtures.push({
        system: 'plumbing',
        kind: stub.kind,
        position: [stubAt[0], stub.y, stubAt[1]],
        rotationY: p.rotationY,
        sourceId: room.id,
        label: stub.label,
      })
      if (!fab) continue
      // Through-floor drop at the fixture class's Table P3005.4.1 size,
      // DROP_SETBACK off the wall, falling to the buried trap-arm height.
      const dropAt: Pt = [p.roomAt[0] + wall.dir[0] * off, p.roomAt[1] + wall.dir[1] * off]
      const yDrop = yRoom + Math.abs(off) * slopeFor(stub.drainIn)
      const dropSpec: PipeSpec = {
        side: pipeSide(stub.drainIn),
        material: 'pvc',
        role: 'pipe-run',
        sourceId: `dwv-trap-${room.id}-${i}`,
        label: stub.dropLabel,
      }
      riser(members, dropSpec, dropAt, stub.dropY, yDrop)
      // Buried trap arm to the room's branch point (P3105.1 — fallback
      // arms are ≤ 0.4 m, far inside every size's limit).
      manhattan(
        members,
        { ...dropSpec, label: `${stub.drainIn}" trap arm → branch (P3105.1)` },
        dropAt,
        p.roomAt,
        yDrop,
        true,
        slopeFor(stub.drainIn),
      )
    }

    // Branch drain to the stack base: Manhattan under the floor, falling at
    // the P3005.3 slope for its size (1/4"/ft < 3", 1/8"/ft allowed 3"+);
    // legs that cross concrete transversally (courtyard stemwalls, R3)
    // carry the per-crossing sleeve note.
    drainManhattan(
      members,
      {
        side: pipeSide(p.drainIn),
        material: 'pvc',
        role: 'pipe-run',
        sourceId: `dwv-branch-${room.id}`,
        label: `${p.drainIn}" branch drain — ${dfu} DFU @ ${p.drainIn >= 3 ? '1/8' : '1/4'}"/ft (P3004.1, P3005.3)`,
      },
      walls,
      spec,
      p.roomAt,
      stackNode,
      yRoom,
      slopeFor(p.drainIn),
      groundLevel,
    )

    // Re-vent (P3104.4): rise from the buried branch to 6" above the flood
    // rim, then run level back to the stack. The stack room IS its vent.
    if (fab && p.branchPlan > 0.3) {
      const ventSpec: PipeSpec = {
        side: VENT_SIDE,
        material: 'pvc',
        role: 'pipe-run',
        sourceId: `dwv-vent-${room.id}`,
        label: '1½" vent — reconnects 6" above flood rim (P3104.4)',
      }
      riser(members, ventSpec, p.roomAt, yRoom, VENT_RECONNECT_Y)
      manhattan(members, ventSpec, p.roomAt, stackAt, VENT_RECONNECT_Y, false)
    }
  }

  // ---- 3" building drain: stack base → sewer exit at an exterior wall
  // (or the sewer-exit service node, verbatim), buried, at 1/4"/ft ----
  const totalDfu = wetRooms.reduce((sum, r) => sum + (DFU_BY_CATEGORY[r.category] ?? 2), 0)
  const exit: Pt =
    overridePlanPoint(walls, overrides?.sewerExit) ?? sewerExitFrom(walls, stackAt, core)
  const undersized = totalDfu > MAIN_CAPACITY_DFU
  // Every main leg that passes through concrete carries its own P2603.4
  // sleeve note (per-crossing, R2); legs shallower than a wall's footing
  // sleeve, deep frost footings are passed under. Above the ground storey
  // there is no foundation and no sewer — the run is a branch main that
  // NEEDS a riser to the storey below; say so (S2).
  drainManhattan(
    members,
    {
      side: MAIN_DRAIN,
      material: 'pvc',
      role: 'pipe-run',
      sourceId: 'dwv-main',
      label: groundLevel
        ? `3" building drain — ${totalDfu} DFU @ 1/4"/ft → sewer/septic (P3005.4)`
        : `3" drain main — ${totalDfu} DFU @ 1/4"/ft → riser to storey below (not modeled)`,
      flag: undersized
        ? `UNDERSIZED: ${totalDfu} DFU exceeds ${MAIN_CAPACITY_DFU} on a 3" building drain (P3005.4.1) — upsize to 4"`
        : undefined,
    },
    walls,
    spec,
    stackNode,
    exit,
    base,
    DRAIN_SLOPE,
    groundLevel,
  )
  fixtures.push({
    system: 'plumbing',
    kind: 'cleanout',
    position: [exit[0], 0.15, exit[1]],
    rotationY: 0,
    sourceId: stackRoom.id,
    label: groundLevel
      ? 'Cleanout @ sewer exit (P3005.2.1)'
      : 'Cleanout @ drain main terminus (P3005.2)',
  })

  // ---- supplies: cold service → WH; hot/cold branches to every stub ----
  const whRoom =
    rooms.find((r) => r.category === 'laundry') ?? rooms.find((r) => r.category === 'garage')
  const whAt: Pt =
    overridePlanPoint(walls, overrides?.waterHeater) ??
    (whRoom ? polygonCentroid(whRoom.polygon) : [stackAt[0] + 0.6, stackAt[1] + 0.6])
  // The fallback WH is a SCHEMATIC placeholder — no tank member, so no
  // T&P/pan/strap members can hang off it. Say so on the fixture AND via
  // meta so computeLevel surfaces a level warning (never-silent doctrine —
  // closing-round attack 6: a bare 'Water heater' fixture shipped with
  // zero hardware and zero warning).
  fixtures.push({
    system: 'plumbing',
    kind: 'water-heater',
    position: [whAt[0], overrides?.waterHeater?.heightAff ?? 0.6, whAt[1]],
    rotationY: 0,
    sourceId: whRoom?.id ?? stackRoom.id,
    label: 'Water heater (schematic — safety hardware not modeled)',
    meta: { schematic: true },
  })

  if (fab) {
    // Cold water service from the water-entry node (else the nearest
    // exterior wall) to the WH.
    const service =
      overridePlanPoint(walls, overrides?.waterEntry) ?? nearestExteriorPoint(walls, whAt)
    if (service) {
      manhattan(
        members,
        {
          side: SUPPLY_MAIN,
          material: 'copper',
          role: 'pipe-run',
          sourceId: whRoom?.id ?? stackRoom.id,
          label: 'Supply cold ¾" — water service',
        },
        service,
        whAt,
        SUPPLY_COLD_Y,
        false,
      )
    }
    // Branches: cold to every stub, hot (the WH loop) to all but toilets —
    // at the SAME clamped along-wall offsets as the drainage stubs (R4a).
    for (const p of plans) {
      const { room, wall, at } = p
      const stubs: { at: Pt; y: number; hot: boolean }[] = p.stubs.map((stub, i) => {
        const off = p.offsets[i] ?? stub.offset
        return {
          at: [at[0] + wall.dir[0] * off, at[1] + wall.dir[1] * off] as Pt,
          y: stub.y,
          hot: stub.hot,
        }
      })
      for (const stub of stubs) {
        const cold: PipeSpec = {
          side: SUPPLY_BRANCH,
          material: 'copper',
          role: 'pipe-run',
          sourceId: room.id,
          label: 'Supply cold ½"',
        }
        manhattan(members, cold, whAt, stub.at, SUPPLY_COLD_Y, false)
        riser(members, cold, stub.at, SUPPLY_COLD_Y, stub.y)
        if (stub.hot) {
          const hot: PipeSpec = {
            side: SUPPLY_BRANCH,
            material: 'copper',
            role: 'pipe-run',
            sourceId: room.id,
            label: 'Supply hot ½" (WH loop)',
          }
          manhattan(members, hot, whAt, stub.at, SUPPLY_HOT_Y, false)
          riser(members, hot, stub.at, SUPPLY_HOT_Y, stub.y)
        }
      }
    }
  }

  return { members, fixtures }
}
