/**
 * Plan document → Pascal nodes. The derived layer: walls from the room
 * rectangles (exterior loop + partitions on the 6" grid, collinear runs
 * merged), doors seated on `door` / `open` attachments, windows by room kind
 * with the bedroom egress windows placed first, zones from the walls (the
 * same detector the editor runs), a slab under the outline, the roof the
 * style or the document asks for, and the building placed on the parcel —
 * square to the street edge, at the front setback.
 *
 * Pure: `(document, options) → node create-ops` in parent-first order, plus
 * the warnings a person can act on. Nothing here touches a store.
 */
import {
  assemblyThickness,
  detectSpacesForLevel,
  generateId,
  getWallAssemblyPreset,
} from '@pascal-app/core'
import { deriveRoof, type RoofIntent, roofNodesFor, type WallInput } from '@pascal-app/plugin-roof'
import {
  type NormalizedDocument,
  type NormalizedRoom,
  normalizeDocument,
  type PlanDocument,
  type PlanEdge,
  type RoomKind,
  validateDocument,
} from './document'
import { applyFinishes, type Finishes, finishesFor } from './finishes'
import { type FoundationChoice, foundationFor, type TerrainUnderFootprint } from './foundation'
import {
  edgePieces,
  GRID_IN_DEFAULT,
  mergeRuns,
  outlineRing,
  pointInRing,
  type Run,
} from './geometry'
import { type CatalogAsset, type FurnishRoom, furnishRooms } from './furnish'
import { type PorchPolicy, type PorchSummary, porchFor } from './porch'
import { FRONT_DOOR_SEGMENTS, type StylePreset, trimOf, styleFor } from './styles'

export const GENERATED_BY = 'pascal:generate'
/** Roofs spanning more than this are trussed (a 2x10 ceiling joist at 16 in o.c. spans 19.8 ft one piece — R802.5.1(2)); site-cut framing needs a bearing line inside that. */
export const TRUSS_SPAN_FT = 24
const IN = 0.0254
const FT = 0.3048
/**
 * A slab-on-grade house stands with its top of slab 8 in above grade
 * (IRC R404.1.6 / R317.1: the foundation and the wood on it clear the ground;
 * PlanCrafters' TERRAIN-DATUM-SPEC: top of foundation ≥ 8 in above the
 * highest grade under the house). The building node carries it, so every
 * level-local number stays as it was and the porch steps have a rise.
 */
export const SLAB_ABOVE_GRADE_M = 8 * IN
/** The house slab's walking surface above the level plane. */
export const SLAB_ELEVATION_M = 0.05
/**
 * A raised floor's platform under the finish floor, as the shell shows it:
 * the 3/4 in subfloor, a 2x10 joist (the common floor joist — Bones sizes
 * its own from the span table, so its stem top can differ by a joist size)
 * and the 2x PT mudsill. Measured from the wall base (level y = 0, 5 cm
 * under the finish floor) down to the top of the stemwall.
 */
export const PLATFORM_RIM_M = Math.round((0.019 + 9.25 * IN + 1.5 * IN - SLAB_ELEVATION_M) * 1e6) / 1e6

export type Pt = [number, number]

/** Where the house goes on the site, computed by the caller from the parcel. */
export type Placement = {
  /** The site node id the building attaches to. */
  siteId: string
  /** Setback envelope ring in SITE metres. */
  envelope: readonly Pt[]
  /** Index of the envelope's street-side edge. */
  frontEdge: number
}

export type BuildOptions = {
  placement?: Placement | null
  /** The site node the building attaches to when there is no placement (no parcel polygon yet). */
  siteId?: string | null
  /**
   * Regenerating: keep these building / level ids so everything that points
   * at them — sheet viewports, section markers, the selection — survives.
   * The caller replaces the level's contents; the building and level ops in
   * the result carry the new position / rotation / height to apply.
   */
  reuse?: { buildingId: string; levelId: string } | null
  /** Recorded on the building so "same again" can find the seed and options. */
  generation?: Record<string, unknown>
  /**
   * The ground: site-local metres (x, z) → grade y above the site plane
   * (the site's USGS heightfield, `heightAt`). Absent / null = flat ground
   * at the plane. Decides the foundation (hillside branches), the
   * building's datum (finish floor above the HIGHEST grade under the
   * footprint), the garage drop and every entrance's rise.
   */
  gradeAt?: ((x: number, z: number) => number) | null
  /**
   * The item catalog to furnish from (the editor's `CATALOG_ITEMS`): the
   * fixtures and furniture placed by room kind (furnish.ts). Absent / empty
   * = an unfurnished house.
   */
  catalog?: readonly CatalogAsset[] | null
  /** A probe's look at the furnishing pass's decisions (never shown to the user). */
  furnishTrace?: (line: string) => void
}

export type NodeOp = { node: Record<string, unknown>; parentId?: string }

export type BuildResult = {
  ok: boolean
  ops: NodeOp[]
  errors: string[]
  warnings: string[]
  stats: {
    rooms: number
    walls: number
    doors: number
    windows: number
    zones: number
    /** One flat ceiling per room (zone). */
    ceilings: number
    /** Conditioned floor area, square feet (garage excluded). */
    livingSqFt: number
    footprintSqFt: number
    /** Fixtures and furniture placed from the catalog (0 without one). */
    items: number
  }
  buildingId: string | null
  levelId: string | null
  /** What the entrance got — PlanCrafters' porch policy, built. */
  porch: PorchSummary | null
  /** The rear entrance at the slider (deck / covered patio / landing), when a rear wall took one. */
  rear: PorchSummary | null
  /** Slab or raised, and how far the finish floor stands above grade. */
  foundation: FoundationChoice | null
  /** The palette applied as one unit (finishes.ts) — siding, roofing, trim, door, windows, wood. */
  finishes: Finishes | null
}

/** What a wall IS in the house (W8): its assembly, its thickness and what Bones does with it follow. */
export type WallRole = 'exterior' | 'partition' | 'garage-separation'

type WallRun = Run & {
  id: string
  role: WallRole
  exterior: boolean
  length: number
  start: Pt
  end: Pt
  thickness: number
}

const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d

const KIND_FLOOR: Record<RoomKind, string> = {
  living: 'LVP',
  kitchen: 'TILE',
  dining: 'LVP',
  bed: 'LVP',
  bath: 'TILE',
  entry: 'TILE',
  hall: 'LVP',
  closet: 'LVP',
  pantry: 'TILE',
  laundry: 'TILE',
  office: 'LVP',
  garage: 'CONC',
  stair: 'LVP',
}

/** Window program by room kind: width × height (in), sill height (in), count, window type. */
const WINDOWS: Partial<
  Record<RoomKind, { w: number; h: number; sill: number; count: number; type: string }>
> = {
  bed: { w: 48, h: 60, sill: 36, count: 1, type: 'double-hung' },
  living: { w: 36, h: 60, sill: 36, count: 2, type: 'double-hung' },
  dining: { w: 36, h: 60, sill: 36, count: 1, type: 'double-hung' },
  kitchen: { w: 48, h: 42, sill: 42, count: 1, type: 'double-hung' },
  office: { w: 36, h: 60, sill: 36, count: 1, type: 'double-hung' },
  bath: { w: 30, h: 30, sill: 60, count: 1, type: 'sliding' },
}

const EXTERIOR_DOOR_W = 36
/** The rear slider: a 6-0 patio door. */
const REAR_DOOR_W = 72
/**
 * A sliding patio door is GLAZED: two glass lites over a low rail — the
 * editor's own 'Sliding' preset (nodes/door panel `frenchDoorSegments`),
 * repeated here so a generated slider never renders as a solid slab.
 */
const SLIDING_DOOR_SEGMENTS = [
  {
    type: 'glass' as const,
    heightRatio: 0.76,
    columnRatios: [1, 1],
    dividerThickness: 0.025,
    panelDepth: 0.01,
    panelInset: 0.04,
  },
  {
    type: 'panel' as const,
    heightRatio: 0.24,
    columnRatios: [1],
    dividerThickness: 0.03,
    panelDepth: 0.012,
    panelInset: 0.035,
  },
]
const GARAGE_DOOR_W = 16 * 12
const GARAGE_DOOR_H = 7 * 12
const DOOR_H = 80

export function buildHouse(input: PlanDocument, options: BuildOptions = {}): BuildResult {
  const validation = validateDocument(input)
  const warnings = [...validation.warnings]
  const empty = (errors: string[]): BuildResult => ({
    ok: false,
    ops: [],
    errors,
    warnings,
    stats: {
      rooms: 0,
      walls: 0,
      doors: 0,
      windows: 0,
      zones: 0,
      ceilings: 0,
      livingSqFt: 0,
      footprintSqFt: 0,
      items: 0,
    },
    porch: null,
    rear: null,
    foundation: null,
    finishes: null,
    buildingId: null,
    levelId: null,
  })
  if (!validation.ok) return empty(validation.errors)
  const doc = normalizeDocument(input)
  const style = styleFor(doc.style)
  // The finish palette — PlanCrafters' curated theme, one unit per roll (finishes.ts).
  const finishes = finishesFor(style, doc.finishes.palette)
  const rooms = doc.rooms
  const grid = GRID_IN_DEFAULT

  const ring = outlineRing(rooms, grid)
  if (!ring)
    return empty([
      'the rooms do not form one closed outline — a room is detached or the plan has a hole.',
    ])

  // Local frame: u along the front (→ x), v into the lot (→ z); the plan is
  // centred on its footprint so the building node's position is its middle.
  const u0 = Math.min(...rooms.map((r) => r.u0))
  const u1 = Math.max(...rooms.map((r) => r.u1))
  const v0 = Math.min(...rooms.map((r) => r.v0))
  const v1 = Math.max(...rooms.map((r) => r.v1))
  const W = u1 - u0
  const D = v1 - v0
  const toLocal = (p: Pt): Pt => [round((p[0] - u0 - W / 2) * IN), round((p[1] - v0 - D / 2) * IN)]

  const ops: NodeOp[] = []
  const errors: string[] = []
  const siteId = options.placement?.siteId ?? options.siteId ?? null
  const buildingId = options.reuse?.buildingId ?? generateId('building')
  const levelId = options.reuse?.levelId ?? generateId('level')
  const ceilingM = round(doc.ceiling * IN)

  // ── walls ────────────────────────────────────────────────────────────
  const zonePairs = new Set(
    doc.edges
      .filter((e) => e.kind === 'zone')
      .map((e) => pairKey(indexOf(rooms, e.a), indexOf(rooms, e.b))),
  )
  // The garage stands on its own pad (below): its exterior runs never merge
  // into the house's collinear ones, so each garage wall can drop to the pad
  // whole (W11b — a merged front wall left the garage half floating).
  const garageRoomIndex = new Set(
    rooms.map((r, i) => (r.kind === 'garage' ? i : -1)).filter((i) => i >= 0),
  )
  const runs = mergeRuns(
    edgePieces(rooms, grid).filter(
      (p) => !(p.left !== -1 && p.right !== -1 && zonePairs.has(pairKey(p.left, p.right))),
    ),
    (p) => {
      const inside = [p.left, p.right].filter((i) => i !== -1)
      return inside.length > 0 && inside.every((i) => garageRoomIndex.has(i)) ? 'garage' : 'house'
    },
  )
  const exteriorPreset = getWallAssemblyPreset(style.exteriorAssembly)
  const interiorPreset = getWallAssemblyPreset('interior-2x4-drywall')
  const plumbingPreset = getWallAssemblyPreset('interior-2x6-plumbing')
  if (!exteriorPreset || !interiorPreset || !plumbingPreset)
    return empty(['wall assembly presets are missing from core.'])
  const exteriorT = assemblyThickness(exteriorPreset.assembly)
  const interiorT = assemblyThickness(interiorPreset.assembly)
  const plumbingT = assemblyThickness(plumbingPreset.assembly)
  // ── wall ROLES (W8 — PlanCrafters WALL_TYPES + applyGarageProtection) ──
  // exterior by style; the walls between the garage and the house are the
  // R302.6 separation (Bones puts the 1/2 in gypsum on the garage side and
  // says so), framed 2x6 like the exterior wall whose line they carry on;
  // every other partition is 2x4. (A per-run 2x6 "plumbing wall" behind
  // the baths jogged every wall line it touched — Steve, 2026-09-06: the
  // stack finds its wall on site; the plan reads clean.)
  const kindsBeside = (run: Run): RoomKind[] =>
    [run.left, run.right].filter((i) => i !== -1).map((i) => (rooms[i] as NormalizedRoom).kind)
  const roleOf = (run: Run, exterior: boolean): WallRole => {
    if (exterior) return 'exterior'
    const kinds = kindsBeside(run)
    const garage = kinds.filter((k) => k === 'garage').length
    if (garage === 1 && kinds.length === 2) return 'garage-separation'
    return 'partition'
  }

  const walls: WallRun[] = runs.map((run) => {
    const exterior = run.left === -1 || run.right === -1
    const start = toLocal(run.a)
    const end = toLocal(run.b)
    const length = run.horizontal ? run.b[0] - run.a[0] : run.b[1] - run.a[1]
    return {
      ...run,
      id: generateId('wall'),
      exterior,
      length,
      start,
      end,
      thickness: exterior
        ? exteriorT
        : roleOf(run, false) === 'garage-separation'
          ? plumbingT
          : interiorT,
      role: roleOf(run, exterior),
    }
  })
  const roomNames = (run: Run): string[] =>
    (run.rooms ?? [run.left, run.right].filter((i) => i !== -1)).map((i) => rooms[i]?.name ?? '')
  for (const wall of walls) {
    // Which side of the wall the house is on. The wall's own normal is
    // (−dz, dx) for direction (dx, dz); "front" is the +normal side.
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const len = Math.hypot(dx, dz) || 1
    const nx = -dz / len
    const nz = dx / len
    const mid: Pt = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
    const probe = (sign: number): boolean =>
      pointInRing(ring.map(toLocal), mid[0] + nx * sign * 0.2, mid[1] + nz * sign * 0.2)
    const frontInside = probe(1)
    const backInside = probe(-1)
    ops.push({
      node: {
        id: wall.id,
        type: 'wall',
        name: wall.exterior ? 'Exterior wall' : roomNames(wall).join(' + '),
        parentId: levelId,
        start: wall.start,
        end: wall.end,
        thickness: round(wall.thickness, 6),
        assembly:
          wall.role === 'exterior'
            ? exteriorPreset.assembly
            : wall.role === 'garage-separation'
              ? plumbingPreset.assembly
              : interiorPreset.assembly,
        frontSide: wall.exterior ? (frontInside ? 'interior' : 'exterior') : 'unknown',
        backSide: wall.exterior ? (backInside ? 'interior' : 'exterior') : 'unknown',
        metadata: {
          generatedBy: GENERATED_BY,
          wallType: wall.exterior
            ? 'ext2x6'
            : wall.role === 'garage-separation'
              ? 'int2x6'
              : 'int2x4',
          role: wall.role,
          rooms: roomNames(wall),
          // the dwelling–garage separation: 1/2 in gypsum on the garage side
          // (IRC Table R302.6 'from the residence and attics'); Type X only on
          // a ceiling below habitable rooms — none on a one-storey house
          ...(wall.role === 'garage-separation' ? { fireSeparation: 'IRC Table R302.6' } : {}),
        },
      },
      parentId: levelId,
    })
  }

  // ── doors on attachments ──────────────────────────────────────────────
  let doors = 0
  const spansOf = (wall: WallRun, room: NormalizedRoom): [number, number] | null => {
    // The part of `wall` (inches from its start) that bounds `room`.
    if (wall.horizontal) {
      if (wall.a[1] !== room.v0 && wall.a[1] !== room.v1) return null
      const s0 = Math.max(wall.a[0], room.u0)
      const s1 = Math.min(wall.b[0], room.u1)
      return s1 - s0 > 0 ? [s0 - wall.a[0], s1 - wall.a[0]] : null
    }
    if (wall.a[0] !== room.u0 && wall.a[0] !== room.u1) return null
    const s0 = Math.max(wall.a[1], room.v0)
    const s1 = Math.min(wall.b[1], room.v1)
    return s1 - s0 > 0 ? [s0 - wall.a[1], s1 - wall.a[1]] : null
  }
  /** Reserved intervals per wall (inches from the wall start) — nothing overlaps an opening. */
  const reserved = new Map<string, [number, number][]>()
  const reserve = (wallId: string, at: number, width: number) => {
    const list = reserved.get(wallId) ?? []
    list.push([at - width / 2, at + width / 2])
    reserved.set(wallId, list)
  }
  /** Every opening seated, for the furnishing pass (its clear zones, the windows). */
  const placedOpenings: {
    wallId: string
    at: number
    width: number
    kind: 'door' | 'open' | 'window'
    sillIn?: number
  }[] = []
  const clear = (wallId: string, at: number, width: number): boolean =>
    !(reserved.get(wallId) ?? []).some(([a, b]) => at - width / 2 < b + 6 && at + width / 2 > a - 6)
  /** Best centre for an opening of `width` inside [s0, s1], keeping `clearance` from the ends and clear of other openings. */
  const seat = (
    wallId: string,
    span: [number, number],
    width: number,
    prefer = 0.5,
    clearance = 6,
  ): number | null => {
    const lo = span[0] + clearance + width / 2
    const hi = span[1] - clearance - width / 2
    if (hi < lo) return null
    const want = lo + (hi - lo) * prefer
    const candidates = [want]
    for (let step = grid; step <= hi - lo; step += grid) candidates.push(want + step, want - step)
    // On the grid when the span allows it; a tight span (a closet, a hall
    // opening) takes the exact centre — an opening need not sit on 6".
    for (const c of candidates) {
      const at = Math.round(c / grid) * grid
      if (at >= lo - 1e-9 && at <= hi + 1e-9 && clear(wallId, at, width)) return at
    }
    for (const c of candidates) {
      const at = Math.round(c * 2) / 2
      if (at >= lo - 1e-9 && at <= hi + 1e-9 && clear(wallId, at, width)) return at
    }
    return null
  }
  /**
   * Which side of `wall` a plan point lies on: +1 on the wall's +normal
   * ("front") side, -1 behind it. The door kinds draw their leaf / track
   * from `swingDirection`, and 'inward' means the +normal side, so the
   * swing is chosen per wall from where the room being entered actually is.
   */
  const sideOf = (wall: WallRun, u: number, v: number): 1 | -1 => {
    const p = toLocal([u, v])
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const nx = -dz
    const nz = dx
    return (p[0] - wall.start[0]) * nx + (p[1] - wall.start[1]) * nz >= 0 ? 1 : -1
  }
  const doorNode = (
    wall: WallRun,
    at: number,
    widthIn: number,
    kind: 'door' | 'open' | 'exterior' | 'garage',
    name: string,
    /** +1: the door swings (or the overhead track runs) to the wall's +normal side. */
    swingSide: 1 | -1,
    doorType: 'hinged' | 'sliding' = 'hinged',
    extraMeta?: Record<string, unknown>,
  ) => {
    const isGarage = kind === 'garage'
    const heightIn = isGarage ? GARAGE_DOOR_H : DOOR_H
    // A hinged leaf swings to the +normal side on 'inward'; the garage
    // builders put their mechanism on the OPPOSITE side of 'inward'.
    const swingDirection = (isGarage ? swingSide === -1 : swingSide === 1) ? 'inward' : 'outward'
    reserve(wall.id, at, widthIn)
    placedOpenings.push({ wallId: wall.id, at, width: widthIn, kind: kind === 'open' ? 'open' : 'door' })
    doors += 1
    ops.push({
      node: {
        id: generateId('door'),
        type: 'door',
        name,
        parentId: wall.id,
        position: [round(at * IN), round((heightIn / 2) * IN), 0],
        // An overhead door's tracks run to the door's BACK (its local −Z).
        // The door faces the wall's +normal side by default; when the garage
        // lies on that side the door is turned to face the street so the
        // tracks run inside (Steve, 2026-09-06: "the garage door rails go out").
        ...(isGarage && swingSide === 1 ? { rotation: [0, Math.PI, 0], side: 'back' } : {}),
        width: round(widthIn * IN),
        height: round(heightIn * IN),
        doorType: isGarage ? 'garage-sectional' : doorType,
        ...(doorType === 'sliding' && !isGarage ? { segments: SLIDING_DOOR_SEGMENTS } : {}),
        openingKind: kind === 'open' ? 'opening' : 'door',
        swingDirection,
        metadata: { generatedBy: GENERATED_BY, attach: kind, ...(extraMeta ?? {}) },
      },
      parentId: wall.id,
    })
  }
  const sharedWalls = (ia: number, ib: number): WallRun[] =>
    walls.filter(
      (w) =>
        !w.exterior && ((w.left === ia && w.right === ib) || (w.left === ib && w.right === ia)),
    )
  for (const edge of doc.edges) {
    if (edge.kind === 'zone') continue
    const ia = indexOf(rooms, edge.a)
    const ib = indexOf(rooms, edge.b)
    const A = rooms[ia] as NormalizedRoom
    const B = rooms[ib] as NormalizedRoom
    const candidates = sharedWalls(ia, ib)
    if (candidates.length === 0) {
      warnings.push(`"${edge.a}"–"${edge.b}": no partition between them to seat a door in.`)
      continue
    }
    // The longest shared span wins.
    let best: { wall: WallRun; span: [number, number] } | null = null
    for (const wall of candidates) {
      const sa = spansOf(wall, A)
      const sb = spansOf(wall, B)
      if (!sa || !sb) continue
      const span: [number, number] = [Math.max(sa[0], sb[0]), Math.min(sa[1], sb[1])]
      if (span[1] - span[0] <= 0) continue
      if (!best || span[1] - span[0] > best.span[1] - best.span[0]) best = { wall, span }
    }
    if (!best) {
      warnings.push(`"${edge.a}"–"${edge.b}": the shared wall is too short for a door.`)
      continue
    }
    // Door widths: 32" to a room, 30" to a bath, a closet door fills its
    // closet less a jamb each side; a cased opening takes the span less a
    // jamb. A door keeps 6" from a corner (PlanCrafters' seating rule), a
    // closet or cased opening 3".
    const closet = [A.kind, B.kind].some((k) => k === 'closet' || k === 'laundry' || k === 'pantry')
    const bath = [A.kind, B.kind].some((k) => k === 'bath')
    const spanW = best.span[1] - best.span[0]
    const clearance = edge.kind === 'open' || closet ? 3 : 6
    const preferred = edge.kind === 'open' ? 72 : closet ? 30 : bath ? 30 : 32
    const width = Math.min(preferred, Math.floor((spanW - 2 * clearance) / 2) * 2)
    if (width < 24) {
      warnings.push(
        `"${edge.a}"–"${edge.b}": their shared wall is ${spanW}" — too short for a ${edge.kind}.`,
      )
      continue
    }
    const at = seat(best.wall.id, best.span, width, 0.5, clearance)
    if (at === null) {
      warnings.push(
        `"${edge.a}"–"${edge.b}": no clear spot for a ${width}" ${edge.kind} on their shared wall.`,
      )
      continue
    }
    const into = sideOf(best.wall, (B.u0 + B.u1) / 2, (B.v0 + B.v1) / 2)
    // the door from the garage into the house is a 20-minute rated,
    // self-closing, self-latching solid door (IRC R302.5.1) — never an
    // opening, never into a sleeping room (the roll never draws one)
    const garageDoor = edge.kind !== 'open' && [A.kind, B.kind].includes('garage')
    doorNode(
      best.wall,
      at,
      width,
      edge.kind === 'open' ? 'open' : 'door',
      `${edge.a} + ${edge.b} ${edge.kind === 'open' ? 'opening' : garageDoor ? 'door (20-min rated, self-closing)' : 'door'}`,
      into,
      'hinged',
      garageDoor
        ? { fireRated: 'IRC R302.5.1 — 20-minute rated, solid core, self-closing self-latching' }
        : undefined,
    )
  }

  // ── the front door ────────────────────────────────────────────────────
  const frontRoom =
    (doc.frontDoorRoom && rooms[indexOf(rooms, doc.frontDoorRoom)]) ||
    rooms.find((r) => (r.kind === 'entry' || r.kind === 'living') && r.v0 === v0) ||
    rooms.find((r) => r.kind === 'entry' || r.kind === 'living') ||
    (rooms[0] as NormalizedRoom)
  const exteriorWallsOf = (
    room: NormalizedRoom,
  ): { wall: WallRun; span: [number, number]; edge: PlanEdge }[] => {
    const out: { wall: WallRun; span: [number, number]; edge: PlanEdge }[] = []
    for (const wall of walls) {
      if (!wall.exterior) continue
      const span = spansOf(wall, room)
      if (!span) continue
      const edge: PlanEdge = wall.horizontal
        ? wall.a[1] === room.v0
          ? 'front'
          : 'back'
        : wall.a[0] === room.u0
          ? 'left'
          : 'right'
      out.push({ wall, span, edge })
    }
    return out
  }
  const ext = exteriorWallsOf(frontRoom)
  const frontChoice =
    ext.find((e) => e.edge === 'front') ??
    ext.find((e) => e.edge === 'left' || e.edge === 'right') ??
    ext[0]
  // The placed front door — the porch centres on it (PlanCrafters' centering invariant).
  let frontDoor: { wall: WallRun; at: number } | null = null
  if (!frontChoice) errors.push(`the front-door room "${frontRoom.name}" has no exterior wall.`)
  else {
    const at = seat(frontChoice.wall.id, frontChoice.span, EXTERIOR_DOOR_W, 0.5)
    if (at === null) errors.push(`no room for the front door on "${frontRoom.name}".`)
    else {
      doorNode(
        frontChoice.wall,
        at,
        EXTERIOR_DOOR_W,
        'exterior',
        'Front door',
        sideOf(
          frontChoice.wall,
          (frontRoom.u0 + frontRoom.u1) / 2,
          (frontRoom.v0 + frontRoom.v1) / 2,
        ),
      )
      // the front door wears the style's leaf (Steve: "style more front
      // door options"): its panel / glass segments, the cottage's arch
      const front = ops[ops.length - 1]?.node
      if (front && front.type === 'door') {
        const trim = trimOf(style)
        front.segments = FRONT_DOOR_SEGMENTS[trim.frontDoor]
        if (trim.frontDoor === 'cottage-arch') front.openingShape = 'arch'
        front.metadata = { ...((front.metadata as Record<string, unknown>) ?? {}), doorStyle: trim.frontDoor }
      }
      frontDoor = { wall: frontChoice.wall, at }
    }
  }

  // ── the rear door: a 72 in slider from the biggest open living / dining
  // room onto the yard (PlanCrafters: "exterior rear = slider to yard") ──
  // Preference: a slider from a living / dining / kitchen room on the BACK
  // wall; else one on a side wall of those rooms (the roll's parti puts the
  // primary suite and the laundry across the back); else a 3-0 door from
  // the laundry / mud room or a hall on the back wall.
  let rearDoor: { wall: WallRun; at: number; room: NormalizedRoom; width: number } | null = null
  {
    type Face = {
      room: NormalizedRoom
      face: { wall: WallRun; span: [number, number]; edge: PlanEdge }
      width: number
      name: string
      doorType: 'sliding' | 'hinged'
    }
    const faces: Face[] = []
    const social = rooms.filter(
      (r) => r.kind === 'living' || r.kind === 'dining' || r.kind === 'kitchen',
    )
    for (const room of social) {
      for (const face of exteriorWallsOf(room)) {
        if (face.edge === 'back')
          faces.push({ room, face, width: REAR_DOOR_W, name: 'Rear slider', doorType: 'sliding' })
      }
    }
    for (const room of social) {
      for (const face of exteriorWallsOf(room)) {
        if (face.edge === 'left' || face.edge === 'right')
          faces.push({ room, face, width: REAR_DOOR_W, name: 'Side slider', doorType: 'sliding' })
      }
    }
    for (const room of rooms.filter((r) => r.kind === 'laundry' || r.kind === 'hall')) {
      for (const face of exteriorWallsOf(room)) {
        if (face.edge === 'back')
          faces.push({ room, face, width: EXTERIOR_DOOR_W, name: 'Rear door', doorType: 'hinged' })
      }
    }
    for (const c of faces) {
      if (c.face.span[1] - c.face.span[0] < c.width + 12) continue
      const at = seat(c.face.wall.id, c.face.span, c.width, 0.5)
      if (at === null) continue
      doorNode(
        c.face.wall,
        at,
        c.width,
        'exterior',
        c.name,
        sideOf(c.face.wall, (c.room.u0 + c.room.u1) / 2, (c.room.v0 + c.room.v1) / 2),
        c.doorType,
      )
      rearDoor = { wall: c.face.wall, at, room: c.room, width: c.width }
      break
    }
  }

  // ── garage doors ──────────────────────────────────────────────────────
  for (const room of rooms) {
    if (room.kind !== 'garage') continue
    const faces = exteriorWallsOf(room)
    const bay = faces.find((f) => f.edge === 'front') ?? faces[0]
    if (!bay) {
      warnings.push(`garage "${room.name}" has no exterior wall for its overhead door.`)
      continue
    }
    const width = bay.span[1] - bay.span[0] >= GARAGE_DOOR_W + 24 ? GARAGE_DOOR_W : 9 * 12
    const at = seat(bay.wall.id, bay.span, width)
    if (at === null) warnings.push(`no room for an overhead door on "${room.name}".`)
    else
      doorNode(
        bay.wall,
        at,
        width,
        'garage',
        `${room.name} overhead door`,
        sideOf(bay.wall, (room.u0 + room.u1) / 2, (room.v0 + room.v1) / 2),
      )
  }

  // ── windows: bedrooms first (egress), then by kind ────────────────────
  let windows = 0
  const windowNode = (
    wall: WallRun,
    at: number,
    spec: { w: number; h: number; sill: number; type: string },
    name: string,
  ) => {
    reserve(wall.id, at, spec.w)
    placedOpenings.push({ wallId: wall.id, at, width: spec.w, kind: 'window', sillIn: spec.sill })
    windows += 1
    ops.push({
      node: {
        id: generateId('window'),
        type: 'window',
        name,
        parentId: wall.id,
        position: [round(at * IN), round((spec.sill + spec.h / 2) * IN), 0],
        width: round(spec.w * IN),
        height: round(spec.h * IN),
        windowType: spec.type,
        metadata: { generatedBy: GENERATED_BY },
      },
      parentId: wall.id,
    })
  }
  const orderedRooms = [...rooms].sort(
    (a, b) => (a.kind === 'bed' ? 0 : 1) - (b.kind === 'bed' ? 0 : 1),
  )
  for (const room of orderedRooms) {
    const spec = WINDOWS[room.kind]
    if (!spec) continue
    const faces = exteriorWallsOf(room)
    if (faces.length === 0) {
      if (room.kind === 'bed')
        errors.push(`bedroom "${room.name}" has no exterior wall for an egress window.`)
      continue
    }
    // Widest face first; bedrooms prefer a side or back face (the front
    // face carries the entry and the porch), living rooms the front.
    const preference = (edge: PlanEdge): number =>
      room.kind === 'living'
        ? edge === 'front'
          ? 0
          : 1
        : room.kind === 'bed'
          ? edge === 'front'
            ? 1
            : 0
          : 0
    faces.sort(
      (p, q) =>
        preference(p.edge) - preference(q.edge) || q.span[1] - q.span[0] - (p.span[1] - p.span[0]),
    )
    let placed = 0
    for (const face of faces) {
      const want = spec.count - placed
      if (want <= 0) break
      const fractions = want >= 2 ? [1 / 3, 2 / 3] : [0.5]
      for (const f of fractions) {
        if (placed >= spec.count) break
        const at = seat(face.wall.id, [face.span[0] + 18, face.span[1] - 18], spec.w, f)
        if (at === null) continue
        windowNode(face.wall, at, spec, `${room.name} window`)
        placed += 1
      }
    }
    if (placed === 0 && room.kind === 'bed') {
      errors.push(`bedroom "${room.name}": its exterior wall has no clear 4' for an egress window.`)
    }
  }

  // ── zones from the walls, named from the rooms ────────────────────────
  const wallNodes = ops.filter((op) => op.node.type === 'wall').map((op) => op.node)
  let zones = 0
  let ceilings = 0
  const zoneOps: NodeOp[] = []
  const ceilingByRoom = (room: NormalizedRoom): number => round((room.ceil ?? doc.ceiling) * IN)
  try {
    const detected = detectSpacesForLevel(levelId, wallNodes as never) as {
      spaces: { polygon: Pt[]; wallIds: string[]; isExterior?: boolean }[]
    }
    const used = new Set<number>()
    let number = 101
    for (const space of detected.spaces) {
      if (space.isExterior) continue
      const members = rooms
        .map((room, i) => ({ room, i }))
        .filter(({ room, i }) => {
          if (used.has(i)) return false
          const c = toLocal([(room.u0 + room.u1) / 2, (room.v0 + room.v1) / 2])
          return pointInRing(space.polygon, c[0], c[1])
        })
      if (members.length === 0) continue
      for (const m of members) used.add(m.i)
      const lead = [...members].sort((p, q) => area(q.room) - area(p.room))[0]
        ?.room as NormalizedRoom
      const roomCeiling = ceilingByRoom(lead)
      // the room's ceiling: a flat GWB lid on the zone's polygon, following
      // the level top (a room pinned lower than the storey keeps its own)
      zoneOps.push({
        node: {
          id: generateId('ceiling'),
          type: 'ceiling',
          name: `${zoneName(members.map((m) => m.room.name))} ceiling`,
          parentId: levelId,
          polygon: space.polygon.map((p) => [round(p[0]), round(p[1])]),
          holes: [],
          ...(roomCeiling < ceilingM - 1e-6 ? { height: roomCeiling } : {}),
          metadata: {
            generatedBy: GENERATED_BY,
            rooms: members.map((m) => m.room.name),
            kind: lead.kind,
          },
        },
        parentId: levelId,
      })
      ceilings += 1
      zoneOps.push({
        node: {
          id: generateId('zone'),
          type: 'zone',
          name: zoneName(members.map((m) => m.room.name)),
          parentId: levelId,
          polygon: space.polygon.map((p) => [round(p[0]), round(p[1])]),
          autoFromWalls: true,
          boundaryWallIds: space.wallIds,
          spaceRole: 'room',
          roomNumber: String(number++),
          floorFinish: lead.floor ?? KIND_FLOOR[lead.kind],
          wallFinish: lead.kind === 'garage' ? 'GWB' : 'GWB, PAINT',
          ceilingFinish: 'GWB, PAINT',
          ceilingHeight: roomCeiling,
          enclosureStatus: 'auto',
          color: lead.kind === 'bed' ? '#8b5cf6' : lead.kind === 'bath' ? '#06b6d4' : '#0ea5e9',
          metadata: {
            generatedBy: GENERATED_BY,
            rooms: members.map((m) => m.room.name),
            kind: lead.kind,
          },
        },
        parentId: levelId,
      })
      zones += 1
    }
    for (const [i, room] of rooms.entries()) {
      if (!used.has(i))
        warnings.push(
          `room "${room.name}" was not found as an enclosed space — no zone was made for it.`,
        )
    }
  } catch (error) {
    warnings.push(`zone detection failed (${(error as Error).message}) — no zones were made.`)
  }

  // ── where the building stands on the parcel (x, z, yaw) ──────────────
  // Decided before the foundation: the grade under the placed footprint
  // picks the foundation and the datum.
  let planX = 0
  let planZ = 0
  let yaw = 0
  const placement = options.placement
  if (placement && placement.envelope.length >= 3) {
    const env = placement.envelope
    const i = ((placement.frontEdge % env.length) + env.length) % env.length
    const p = env[i] as Pt
    const q = env[(i + 1) % env.length] as Pt
    const cx = env.reduce((s, e) => s + e[0], 0) / env.length
    const cz = env.reduce((s, e) => s + e[1], 0) / env.length
    const ex = q[0] - p[0]
    const ez = q[1] - p[1]
    const el = Math.hypot(ex, ez) || 1
    let nx = -ez / el
    let nz = ex / el
    const mx = (p[0] + q[0]) / 2
    const mz = (p[1] + q[1]) / 2
    // The outward normal points away from the envelope's centre.
    if ((mx - cx) * nx + (mz - cz) * nz < 0) {
      nx = -nx
      nz = -nz
    }
    // Level-local −z is the house front; world = R(yaw)·local: (0,−1) → (−sin, −cos).
    yaw = Math.atan2(-nx, -nz)
    const halfD = (D * IN) / 2 + exteriorT / 2
    planX = round(mx - nx * halfD)
    planZ = round(mz - nz * halfD)
    if (W * IN > el)
      warnings.push(
        `the house is ${(W / 12).toFixed(0)}' wide but the buildable frontage is ${(el / FT).toFixed(0)}' — check the side setbacks.`,
      )
  }
  /** Level-local plan (x, z) → site-local plan: world = position + R(yaw)·local (three.js yaw: +x → (cos, −sin)). */
  const toSite = (x: number, z: number): Pt => [
    planX + x * Math.cos(yaw) + z * Math.sin(yaw),
    planZ - x * Math.sin(yaw) + z * Math.cos(yaw),
  ]
  const gradeAt = options.gradeAt ?? null
  /** Site grade under a level-local plan point (0 on flat ground). */
  const siteGrade = (x: number, z: number): number => {
    if (!gradeAt) return 0
    const [sx, sz] = toSite(x, z)
    const g = gradeAt(sx, sz)
    return Number.isFinite(g) ? g : 0
  }

  // ── the ground under the footprint (TERRAIN-DATUM-SPEC) ──────────────
  // Sampled at the outline's corners, along its edges and at its centre:
  // the HIGHEST grade is the datum the house stands on, the fall picks the
  // foundation.
  let terrain: TerrainUnderFootprint | null = null
  if (gradeAt) {
    const outline = ring.map(toLocal)
    const stations: Pt[] = []
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i] as Pt
      const b = outline[(i + 1) % outline.length] as Pt
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2))
      for (let k = 0; k < n; k++)
        stations.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
    }
    stations.push([
      outline.reduce((s, p) => s + p[0], 0) / outline.length,
      outline.reduce((s, p) => s + p[1], 0) / outline.length,
    ])
    const heights = stations.map((p) => siteGrade(p[0], p[1]))
    const highestM = Math.max(...heights)
    const lowestM = Math.min(...heights)
    terrain = {
      reliefIn: round((highestM - lowestM) / IN, 1),
      highestM,
      lowestM,
      samples: stations.length,
    }
  }

  // ── the foundation: slab on grade or a raised floor (foundation.ts) ───
  const foundation = foundationFor(style, input.mode === 'adu' ? 'adu' : '1story', W / 12, terrain)
  const ffAboveGradeM = round(foundation.ffAboveGradeIn * IN)
  const raisedFloor = foundation.type === 'raised'
  /** The building's datum: the finish floor stands `ffAboveGrade` above the HIGHEST grade under the footprint. */
  const buildingY = round((terrain?.highestM ?? 0) + ffAboveGradeM)
  /** Level-local grade under a level-local plan point (−ff on flat ground). */
  const localGrade = (x: number, z: number): number => round(siteGrade(x, z) - buildingY)
  if (terrain && terrain.reliefIn >= 12) {
    warnings.push(
      `hillside: ${Math.round(terrain.reliefIn)}" of fall under the footprint — the finish floor stands ${foundation.ffAboveGradeIn}" above the high side; Bones steps the footings down the hill.`,
    )
  }

  // ── the floor under the house, the garage slab at grade ───────────────
  // A slab house pours one slab; a raised house carries a framed platform
  // (the slab node is its 3/4 in subfloor — Bones hangs the joists under
  // it). Either way the GARAGE gets its own slab with its top at grade,
  // PlanCrafters' garageDefaultDrop on flat ground (the garage never sits on
  // the raised floor), and the garage's exterior walls stand on that slab.
  const slabId = generateId('slab')
  const garageRooms = rooms.filter((r) => r.kind === 'garage')
  const houseRooms = rooms.filter((r) => r.kind !== 'garage')
  const houseRing = garageRooms.length > 0 ? (outlineRing(houseRooms, grid) ?? ring) : ring
  const slabOp: NodeOp = {
    node: {
      id: slabId,
      type: 'slab',
      name: raisedFloor ? 'Floor platform' : 'Slab on grade',
      parentId: levelId,
      polygon: houseRing.map(toLocal),
      holes: [],
      elevation: SLAB_ELEVATION_M,
      // 3/4 in subfloor over joists, or the 4 in slab
      thickness: raisedFloor ? 0.019 : 0.1016,
      metadata: { generatedBy: GENERATED_BY, floor: raisedFloor ? 'platform' : 'slab-on-grade' },
    },
    parentId: levelId,
  }
  const garageSlabOps: NodeOp[] = []
  const garageRing = garageRooms.length > 0 ? outlineRing(garageRooms, grid) : null
  if (garageRing) {
    const garageSlabId = generateId('slab')
    const gc = garageRing.map(toLocal)
    const gcx = gc.reduce((s, p) => s + p[0], 0) / gc.length
    const gcz = gc.reduce((s, p) => s + p[1], 0) / gc.length
    const garageDropM = Math.min(48 * IN, Math.max(2 * IN, -localGrade(gcx, gcz)))
    garageSlabOps.push({
      node: {
        id: garageSlabId,
        type: 'slab',
        name: 'Garage slab',
        parentId: levelId,
        polygon: garageRing.map(toLocal),
        holes: [],
        // PlanCrafters garageDefaultDrop: the pad's top at the garage's OWN
        // natural grade — the stem height less the local rise, kept between
        // 2 in and 48 in below the finish floor.
        elevation: round(SLAB_ELEVATION_M - garageDropM),
        thickness: 0.1016,
        materialPreset: 'concrete-raw',
        metadata: {
          generatedBy: GENERATED_BY,
          floor: 'garage-slab-at-grade',
          dropIn: round(garageDropM / IN, 1),
        },
      },
      parentId: levelId,
    })
    // The garage's exterior walls stand on the garage slab (their base drops
    // to it; the separation wall stays on the house floor).
    const garageIndex = new Set(
      rooms.map((r, i) => (r.kind === 'garage' ? i : -1)).filter((i) => i >= 0),
    )
    for (const wall of walls) {
      if (!wall.exterior) continue
      const beside = (wall.rooms ?? [wall.left, wall.right]).filter((i) => i !== -1)
      if (beside.length === 0 || !beside.every((i) => garageIndex.has(i))) continue
      const op = ops.find((o) => o.node.id === wall.id)
      if (op) op.node.supportSlabId = garageSlabId
    }
  }

  // ── the underpinning: siding down over the rim, the stemwall to grade ──
  // Every exterior wall standing on the house floor carries what is under
  // it (Steve, 2026-09-06: "the siding go down to grade and the raised
  // floor … should be standard stemwall"): a raised house its finish down
  // over the platform's rim then the concrete stem to the ground, a slab
  // house the slab edge and stem in concrete from the wall base down; on a
  // hill the stem follows the terrain (`fillToTerrain`). The garage's walls
  // stand on the pad at grade and carry nothing.
  for (const wall of walls) {
    if (!wall.exterior) continue
    const op = ops.find((o) => o.node.id === wall.id)
    if (!op || op.node.supportSlabId !== undefined) continue
    const mx = (wall.start[0] + wall.end[0]) / 2
    const mz = (wall.start[1] + wall.end[1]) / 2
    const rim = raisedFloor ? PLATFORM_RIM_M : 0
    const stem = Math.max(0, round(-rim - localGrade(mx, mz)))
    op.node.fillToTerrain = true
    op.node.underpinning = { rim, stem }
  }

  // ── furnishing: fixtures and furniture from the catalog (furnish.ts) ──
  // Each room hands the pass its four edges — the wall's half thickness,
  // whether it is exterior, and the openings seated in it (plan inches along
  // the edge) — and gets its fixtures back as item nodes on the level.
  const furnishRoomOf = (room: NormalizedRoom): FurnishRoom => {
    const edgeOf = (edge: PlanEdge) => {
      const onEdge = walls.filter((wall) => {
        if (wall.horizontal) {
          const line = edge === 'front' ? room.v0 : edge === 'back' ? room.v1 : null
          if (line === null || wall.a[1] !== line) return false
          return Math.min(wall.b[0], room.u1) - Math.max(wall.a[0], room.u0) > 0
        }
        const line = edge === 'left' ? room.u0 : edge === 'right' ? room.u1 : null
        if (line === null || wall.a[0] !== line) return false
        return Math.min(wall.b[1], room.v1) - Math.max(wall.a[1], room.v0) > 0
      })
      const along = edge === 'front' || edge === 'back' ? ([room.u0, room.u1] as const) : ([room.v0, room.v1] as const)
      const openings = onEdge.flatMap((wall) =>
        placedOpenings
          .filter((o) => o.wallId === wall.id)
          .map((o) => {
            const centre = (wall.horizontal ? wall.a[0] : wall.a[1]) + o.at
            return { a: centre - o.width / 2, b: centre + o.width / 2, kind: o.kind, sillIn: o.sillIn }
          })
          .filter((o) => o.b > along[0] && o.a < along[1]),
      )
      return {
        exterior: onEdge.some((wall) => wall.exterior),
        halfIn: onEdge.length > 0 ? Math.max(...onEdge.map((wall) => wall.thickness / IN / 2)) : 0,
        openings,
      }
    }
    return {
      name: room.name,
      kind: room.kind,
      u0: room.u0,
      v0: room.v0,
      u1: room.u1,
      v1: room.v1,
      edges: { front: edgeOf('front'), back: edgeOf('back'), left: edgeOf('left'), right: edgeOf('right') },
    }
  }
  const furnished =
    options.catalog && options.catalog.length > 0
      ? furnishRooms({
          rooms: rooms.map(furnishRoomOf),
          catalog: options.catalog,
          levelId,
          ids: () => generateId('item'),
          toLocal,
          generatedBy: GENERATED_BY,
          trace: options.furnishTrace,
        })
      : { ops: [], warnings: [], placed: 0 }
  warnings.push(...furnished.warnings)
  const furnishOps: NodeOp[] = furnished.ops

  // ── roof: derived from the walls by the auto roof engine ─────────────
  const roofOps = roofFor(doc, style, ops, ceilingM, levelId, warnings)

  // ── the entrances, built PlanCrafters' way (porch.ts): the front porch on
  // the front door, the rear patio / landing / deck on the slider ────────
  let porchSummary: PorchSummary | null = null
  let rearSummary: PorchSummary | null = null
  const porchOps: NodeOp[] = []
  const entranceFor = (
    door: { wall: WallRun; at: number },
    policy: PorchPolicy,
    entrance: 'front' | 'rear',
    bayWidth: number,
    doorWidth: number,
  ): PorchSummary | null => {
    const w = door.wall
    const dxw = w.end[0] - w.start[0]
    const dzw = w.end[1] - w.start[1]
    const lw = Math.hypot(dxw, dzw) || 1
    const nxw = -dzw / lw
    const nzw = dxw / lw
    const midw: Pt = [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2]
    const houseOnFront = pointInRing(ring.map(toLocal), midw[0] + nxw * 0.2, midw[1] + nzw * 0.2)
    const outward: Pt = houseOnFront ? [-nxw, -nzw] : [nxw, nzw]
    // The flight lands on the ground out past the landing — on a hill the
    // rise there is the real one (PlanCrafters garageStepFlight: "however
    // big it computes").
    const flightGrade = localGrade(midw[0] + outward[0] * 2.5, midw[1] + outward[1] * 2.5)
    const porchPitch = Math.min(style.pitch, 6)
    const built = porchFor(
      {
        policy,
        style,
        levelId,
        entrance,
        // a raised house gets wood decks, a slab house concrete (PlanCrafters
        // uses wood on hills; a raised platform is the same call on flat ground)
        landing: raisedFloor ? 'wood' : 'concrete',
        wall: { start: w.start, end: w.end, thickness: w.thickness },
        doorAt: door.at * IN,
        doorWidth: doorWidth * IN,
        outward,
        bayWidth,
        floorElevation: SLAB_ELEVATION_M,
        gradeY: flightGrade,
        gradeAt: localGrade,
        terrain: terrain !== null,
        overhang: (style.overhangIn * IN) / Math.cos(Math.atan(porchPitch / 12)),
        // the cover is sized against the house roof it dies into (W19b)
        housePlateY: ceilingM,
        housePitch: doc.roof.pitch ?? style.pitch,
        wallRole: (
          ops.find((op) => op.node.id === w.id)?.node.metadata as
            | { roof?: { role?: string } }
            | undefined
        )?.roof?.role,
      },
      {
        slab: generateId('slab'),
        roof: generateId('roof'),
        segment: generateId('rseg'),
        beam: generateId('slab'),
        ceiling: generateId('ceiling'),
        stair: generateId('stair'),
        stairSegment: generateId('sseg'),
        column: () => generateId('column'),
        fence: () => generateId('fence'),
      },
    )
    porchOps.push(...built.ops)
    warnings.push(...built.warnings)
    return built.summary
  }
  if (frontDoor) {
    const bayWidth =
      rooms
        .filter((r) => r.kind === 'living' || r.kind === 'entry')
        .reduce((s, r) => s + (r.u1 - r.u0), 0) * IN
    porchSummary = entranceFor(frontDoor, style.porch, 'front', bayWidth, EXTERIOR_DOOR_W)
  }
  if (rearDoor) {
    // PlanCrafters applyPorch, rear: a raised house → a deck; a slab house →
    // a covered patio for the porch styles, a plain landing otherwise.
    const policy: PorchPolicy = raisedFloor ? 'deck' : style.porch !== 'none' ? 'patio' : 'landing'
    rearSummary = entranceFor(
      rearDoor,
      policy,
      'rear',
      (rearDoor.room.u1 - rearDoor.room.u0) * IN,
      rearDoor.width,
    )
  }

  const spanFt = Math.min(W, D) / 12
  const structure: { roofSystem: 'stick' | 'truss'; reason: string } =
    spanFt > TRUSS_SPAN_FT
      ? {
          roofSystem: 'truss',
          reason: `${spanFt.toFixed(0)} ft roof span — past the site-cut rafter / ceiling-joist tables without an interior bearing line; pre-engineered trusses, design deferred (R802.10.1)`,
        }
      : { roofSystem: 'stick', reason: `${spanFt.toFixed(0)} ft roof span — site-cut rafters and ceiling joists` }
  if (structure.roofSystem === 'truss') warnings.push(`Roof framing: ${structure.reason}.`)
  // ── building on the parcel: placed above, standing on its datum ───────
  const position: [number, number, number] = [planX, buildingY, planZ]

  const buildingOp: NodeOp = {
    node: {
      id: buildingId,
      type: 'building',
      name: doc.name,
      parentId: siteId,
      position,
      rotation: [0, round(yaw, 6), 0],
      metadata: {
        generatedBy: GENERATED_BY,
        generation: options.generation ?? {},
        style: style.key,
        document: input,
        // PlanCrafters' foundation record — Bones reads it (foundationOf)
        foundation: {
          type: foundation.type,
          ffAboveGradeIn: foundation.ffAboveGradeIn,
          source: foundation.source,
        },
        // The roof system Bones frames and the sheets draw (structureOf):
        // site-cut rafters and ceiling joists lap over an interior bearing
        // partition, and a deep open plan has none where the joists need it
        // — past 24 ft the roof is pre-engineered trusses, the way a Florida
        // or PlanCrafters house is built (truss design a deferred submittal,
        // R802.10.1); interior partitions are then non-bearing.
        structure,
        // the finish schedule — the palette applied below (finishes.ts)
        finishes,
      },
    },
    parentId: siteId ?? undefined,
  }
  const levelOp: NodeOp = {
    node: {
      id: levelId,
      type: 'level',
      name: 'Ground floor',
      parentId: buildingId,
      level: 0,
      baseElevation: 0,
      height: ceilingM,
      metadata: { generatedBy: GENERATED_BY },
    },
    parentId: buildingId,
  }

  const livingSqFt = rooms.filter((r) => r.kind !== 'garage').reduce((s, r) => s + area(r), 0) / 144
  const footprintSqFt = (W * D) / 144
  const ordered: NodeOp[] = [
    buildingOp,
    levelOp,
    slabOp,
    ...garageSlabOps,
    ...ops,
    ...zoneOps,
    ...furnishOps,
    ...roofOps,
    ...porchOps,
  ]
  // ── finishes: the palette on every exterior surface, as one unit ──────
  applyFinishes(ordered, finishes)
  if (errors.length > 0) return { ...empty(errors), warnings }
  return {
    ok: true,
    ops: ordered,
    errors,
    warnings,
    stats: {
      rooms: rooms.length,
      walls: walls.length,
      doors,
      windows,
      zones,
      ceilings,
      livingSqFt: Math.round(livingSqFt),
      footprintSqFt: Math.round(footprintSqFt),
      items: furnished.placed,
    },
    porch: porchSummary,
    rear: rearSummary,
    foundation,
    finishes,
    buildingId,
    levelId,
  }
}

/**
 * The roof comes from the walls, through the auto roof engine (plugin-roof):
 * the exterior loop becomes masses, each mass a segment seated on the plate,
 * gable or hip by the style's vocabulary and the massing, a shed rising away
 * from the street. The plan document's intent (form, pitch, overhang, the
 * gable edges) is the engine's intent; the house faces its own −Z. Every
 * exterior wall op is stamped with the role it carries under that roof.
 */
function roofFor(
  doc: NormalizedDocument,
  style: StylePreset,
  ops: NodeOp[],
  ceilingM: number,
  levelId: string,
  warnings: string[],
): NodeOp[] {
  const form = doc.roof.form === 'auto' ? style.roofForm : doc.roof.form
  const pitchTwelfths = doc.roof.pitch ?? style.pitch
  const overhangIn = doc.roof.overhang ?? style.overhangIn
  const walls: WallInput[] = ops
    .filter((op) => op.node.type === 'wall')
    .map((op) => ({
      id: op.node.id as string,
      start: op.node.start as [number, number],
      end: op.node.end as [number, number],
      thickness: op.node.thickness as number,
      frontSide: op.node.frontSide as string,
      backSide: op.node.backSide as string,
    }))
  const edgeNormal: Record<PlanEdge, [number, number]> = {
    front: [0, -1],
    back: [0, 1],
    left: [-1, 0],
    right: [1, 0],
  }
  const intent: RoofIntent = {
    form: form === 'flat' ? 'flat' : form === 'shed' ? 'shed' : form === 'hip' ? 'hip' : 'gable',
    pitchTwelfths,
    overhang: overhangIn * IN,
    style: style.key,
    gables: doc.roof.gables.map((g) => edgeNormal[g]),
    frontDir: [0, -1],
  }
  const result = deriveRoof(walls, ceilingM, intent)
  warnings.push(...result.warnings)
  if (form === 'flat')
    warnings.push('flat roof: drawn as a flat roof segment; the roof plan shows no pitch arrows.')
  for (const op of ops) {
    const role = result.roles[op.node.id as string]
    if (!role) continue
    op.node.metadata = {
      ...((op.node.metadata as Record<string, unknown> | undefined) ?? {}),
      roof: { role },
    }
  }
  const roofOps = roofNodesFor(
    result,
    levelId,
    { roofId: generateId('roof'), segmentId: () => generateId('rseg') },
    {
      source: GENERATED_BY,
      intent: { form, pitchInTwelfths: pitchTwelfths, overhangIn, gables: doc.roof.gables },
    },
  )
  // The gingerbread in the house gables: a king post with two braces under
  // the rakes on every gable-end wall, standing on the plate just outside
  // the wall face (Steve: "gingerbread into the gables on the houses").
  if (trimOf(style).gableOrnament === 'king-post') {
    const main = result.segments[0]
    if (main && form === 'gable') {
      const rise = (main.depth / 2) * Math.tan((main.pitch * Math.PI) / 180)
      for (const op of ops) {
        if (op.node.type !== 'wall' || result.roles[op.node.id as string] !== 'gable-end') continue
        const start = op.node.start as [number, number]
        const end = op.node.end as [number, number]
        const len = Math.hypot(end[0] - start[0], end[1] - start[1])
        if (len < 1e-6) continue
        const dir: [number, number] = [(end[0] - start[0]) / len, (end[1] - start[1]) / len]
        const normal: [number, number] = [-dir[1], dir[0]]
        const sign = op.node.frontSide === 'exterior' ? 1 : -1
        const off = ((op.node.thickness as number) ?? 0.15) / 2 + 2 * IN
        const mid: [number, number] = [
          (start[0] + end[0]) / 2 + normal[0] * sign * off,
          (start[1] + end[1]) / 2 + normal[1] * sign * off,
        ]
        roofOps.push({
          node: {
            id: generateId('column'),
            type: 'column',
            name: 'Gable king post',
            parentId: levelId,
            position: [round(mid[0]), round(ceilingM), round(mid[1])],
            rotation: round(Math.atan2(-dir[1], dir[0])),
            height: round(Math.max(12 * IN, rise - 10 * IN)),
            style: 'plain',
            crossSection: 'square',
            width: 3.5 * IN,
            depth: 3.5 * IN,
            supportStyle: 'y-frame',
            braceWidth: 3.5 * IN,
            braceDepth: 1.5 * IN,
            braceTopSpread: round(Math.min(len * 0.5, 3)),
            bracePlateEnabled: false,
            shaftProfile: 'straight',
            shaftSegmentCount: 1,
            shaftCornerRadius: 0,
            baseStyle: 'none',
            capitalStyle: 'none',
            edgeSoftness: 0,
            metadata: { generatedBy: GENERATED_BY, ornament: 'gable', wallId: op.node.id },
          },
          parentId: levelId,
        })
      }
    }
  }
  return roofOps
}

/** "HALL / HALL 2" reads as "HALL": a numbered twin of a member is the same room continued. */
function zoneName(names: readonly string[]): string {
  const bases = new Set(names)
  return names.filter((n) => !(/\s\d+$/.test(n) && bases.has(n.replace(/\s\d+$/, '')))).join(' / ')
}

function indexOf(rooms: readonly NormalizedRoom[], name: string): number {
  return rooms.findIndex((r) => r.name === name)
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function area(r: NormalizedRoom): number {
  return (r.u1 - r.u0) * (r.v1 - r.v0)
}
