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
import {
  type NormalizedDocument,
  type NormalizedRoom,
  normalizeDocument,
  type PlanDocument,
  type PlanEdge,
  type RoomKind,
  validateDocument,
} from './document'
import { edgePieces, GRID_IN_DEFAULT, mergeRuns, outlineRing, pointInRing, type Run } from './geometry'
import { type StylePreset, styleFor } from './styles'

export const GENERATED_BY = 'pascal:generate'
const IN = 0.0254
const FT = 0.3048

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
  /** Recorded on the building so "same again" can find the seed and options. */
  generation?: Record<string, unknown>
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
    /** Conditioned floor area, square feet (garage excluded). */
    livingSqFt: number
    footprintSqFt: number
  }
  buildingId: string | null
  levelId: string | null
}

type WallRun = Run & { id: string; exterior: boolean; length: number; start: Pt; end: Pt; thickness: number }

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
const WINDOWS: Partial<Record<RoomKind, { w: number; h: number; sill: number; count: number; type: string }>> = {
  bed: { w: 48, h: 60, sill: 36, count: 1, type: 'double-hung' },
  living: { w: 36, h: 60, sill: 36, count: 2, type: 'double-hung' },
  dining: { w: 36, h: 60, sill: 36, count: 1, type: 'double-hung' },
  kitchen: { w: 48, h: 42, sill: 42, count: 1, type: 'double-hung' },
  office: { w: 36, h: 60, sill: 36, count: 1, type: 'double-hung' },
  bath: { w: 30, h: 30, sill: 60, count: 1, type: 'sliding' },
}

const EXTERIOR_DOOR_W = 36
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
    stats: { rooms: 0, walls: 0, doors: 0, windows: 0, zones: 0, livingSqFt: 0, footprintSqFt: 0 },
    buildingId: null,
    levelId: null,
  })
  if (!validation.ok) return empty(validation.errors)
  const doc = normalizeDocument(input)
  const style = styleFor(doc.style)
  const rooms = doc.rooms
  const grid = GRID_IN_DEFAULT

  const ring = outlineRing(rooms, grid)
  if (!ring) return empty(['the rooms do not form one closed outline — a room is detached or the plan has a hole.'])

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
  const siteId = options.placement?.siteId ?? null
  const buildingId = generateId('building')
  const levelId = generateId('level')
  const ceilingM = round(doc.ceiling * IN)

  // ── walls ────────────────────────────────────────────────────────────
  const zonePairs = new Set(
    doc.edges.filter((e) => e.kind === 'zone').map((e) => pairKey(indexOf(rooms, e.a), indexOf(rooms, e.b))),
  )
  const runs = mergeRuns(
    edgePieces(rooms, grid).filter((p) => !(p.left !== -1 && p.right !== -1 && zonePairs.has(pairKey(p.left, p.right)))),
  )
  const exteriorPreset = getWallAssemblyPreset(style.exteriorAssembly)
  const interiorPreset = getWallAssemblyPreset('interior-2x4-drywall')
  if (!exteriorPreset || !interiorPreset) return empty(['wall assembly presets are missing from core.'])
  const exteriorT = assemblyThickness(exteriorPreset.assembly)
  const interiorT = assemblyThickness(interiorPreset.assembly)

  const walls: WallRun[] = runs.map((run) => {
    const exterior = run.left === -1 || run.right === -1
    const start = toLocal(run.a)
    const end = toLocal(run.b)
    const length = run.horizontal ? run.b[0] - run.a[0] : run.b[1] - run.a[1]
    return { ...run, id: generateId('wall'), exterior, length, start, end, thickness: exterior ? exteriorT : interiorT }
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
      pointInRing(
        ring.map(toLocal),
        mid[0] + nx * sign * 0.2,
        mid[1] + nz * sign * 0.2,
      )
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
        assembly: wall.exterior ? exteriorPreset.assembly : interiorPreset.assembly,
        frontSide: wall.exterior ? (frontInside ? 'interior' : 'exterior') : 'unknown',
        backSide: wall.exterior ? (backInside ? 'interior' : 'exterior') : 'unknown',
        metadata: { generatedBy: GENERATED_BY, wallType: wall.exterior ? 'ext2x6' : 'int2x4', rooms: roomNames(wall) },
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
  const clear = (wallId: string, at: number, width: number): boolean =>
    !(reserved.get(wallId) ?? []).some(([a, b]) => at - width / 2 < b + 6 && at + width / 2 > a - 6)
  /** Best centre for an opening of `width` inside [s0, s1], keeping `clearance` from the ends and clear of other openings. */
  const seat = (wallId: string, span: [number, number], width: number, prefer = 0.5, clearance = 6): number | null => {
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
  ) => {
    const isGarage = kind === 'garage'
    const heightIn = isGarage ? GARAGE_DOOR_H : DOOR_H
    // A hinged leaf swings to the +normal side on 'inward'; the garage
    // builders put their mechanism on the OPPOSITE side of 'inward'.
    const swingDirection = (isGarage ? swingSide === -1 : swingSide === 1) ? 'inward' : 'outward'
    reserve(wall.id, at, widthIn)
    doors += 1
    ops.push({
      node: {
        id: generateId('door'),
        type: 'door',
        name,
        parentId: wall.id,
        position: [round(at * IN), round((heightIn / 2) * IN), 0],
        width: round(widthIn * IN),
        height: round(heightIn * IN),
        doorType: isGarage ? 'garage-sectional' : 'hinged',
        openingKind: kind === 'open' ? 'opening' : 'door',
        swingDirection,
        metadata: { generatedBy: GENERATED_BY, attach: kind },
      },
      parentId: wall.id,
    })
  }
  const sharedWalls = (ia: number, ib: number): WallRun[] =>
    walls.filter((w) => !w.exterior && ((w.left === ia && w.right === ib) || (w.left === ib && w.right === ia)))
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
      warnings.push(`"${edge.a}"–"${edge.b}": their shared wall is ${spanW}" — too short for a ${edge.kind}.`)
      continue
    }
    const at = seat(best.wall.id, best.span, width, 0.5, clearance)
    if (at === null) {
      warnings.push(`"${edge.a}"–"${edge.b}": no clear spot for a ${width}" ${edge.kind} on their shared wall.`)
      continue
    }
    const into = sideOf(best.wall, (B.u0 + B.u1) / 2, (B.v0 + B.v1) / 2)
    doorNode(best.wall, at, width, edge.kind === 'open' ? 'open' : 'door', `${edge.a} + ${edge.b} ${edge.kind === 'open' ? 'opening' : 'door'}`, into)
  }

  // ── the front door ────────────────────────────────────────────────────
  const frontRoom =
    (doc.frontDoorRoom && rooms[indexOf(rooms, doc.frontDoorRoom)]) ||
    rooms.find((r) => (r.kind === 'entry' || r.kind === 'living') && r.v0 === v0) ||
    rooms.find((r) => r.kind === 'entry' || r.kind === 'living') ||
    (rooms[0] as NormalizedRoom)
  const exteriorWallsOf = (room: NormalizedRoom): { wall: WallRun; span: [number, number]; edge: PlanEdge }[] => {
    const out: { wall: WallRun; span: [number, number]; edge: PlanEdge }[] = []
    for (const wall of walls) {
      if (!wall.exterior) continue
      const span = spansOf(wall, room)
      if (!span) continue
      const edge: PlanEdge = wall.horizontal ? (wall.a[1] === room.v0 ? 'front' : 'back') : wall.a[0] === room.u0 ? 'left' : 'right'
      out.push({ wall, span, edge })
    }
    return out
  }
  const ext = exteriorWallsOf(frontRoom)
  const frontChoice =
    ext.find((e) => e.edge === 'front') ?? ext.find((e) => e.edge === 'left' || e.edge === 'right') ?? ext[0]
  if (!frontChoice) errors.push(`the front-door room "${frontRoom.name}" has no exterior wall.`)
  else {
    const at = seat(frontChoice.wall.id, frontChoice.span, EXTERIOR_DOOR_W, 0.5)
    if (at === null) errors.push(`no room for the front door on "${frontRoom.name}".`)
    else {
      doorNode(frontChoice.wall, at, EXTERIOR_DOOR_W, 'exterior', 'Front door', sideOf(frontChoice.wall, (frontRoom.u0 + frontRoom.u1) / 2, (frontRoom.v0 + frontRoom.v1) / 2))
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
    else doorNode(bay.wall, at, width, 'garage', `${room.name} overhead door`, sideOf(bay.wall, (room.u0 + room.u1) / 2, (room.v0 + room.v1) / 2))
  }

  // ── windows: bedrooms first (egress), then by kind ────────────────────
  let windows = 0
  const windowNode = (wall: WallRun, at: number, spec: { w: number; h: number; sill: number; type: string }, name: string) => {
    reserve(wall.id, at, spec.w)
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
  const orderedRooms = [...rooms].sort((a, b) => (a.kind === 'bed' ? 0 : 1) - (b.kind === 'bed' ? 0 : 1))
  for (const room of orderedRooms) {
    const spec = WINDOWS[room.kind]
    if (!spec) continue
    const faces = exteriorWallsOf(room)
    if (faces.length === 0) {
      if (room.kind === 'bed') errors.push(`bedroom "${room.name}" has no exterior wall for an egress window.`)
      continue
    }
    // Widest face first; bedrooms prefer a side or back face (the front
    // face carries the entry and the porch), living rooms the front.
    const preference = (edge: PlanEdge): number =>
      room.kind === 'living' ? (edge === 'front' ? 0 : 1) : room.kind === 'bed' ? (edge === 'front' ? 1 : 0) : 0
    faces.sort((p, q) => preference(p.edge) - preference(q.edge) || q.span[1] - q.span[0] - (p.span[1] - p.span[0]))
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
      const lead = [...members].sort((p, q) => area(q.room) - area(p.room))[0]?.room as NormalizedRoom
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
          ceilingHeight: ceilingByRoom(lead),
          enclosureStatus: 'auto',
          color: lead.kind === 'bed' ? '#8b5cf6' : lead.kind === 'bath' ? '#06b6d4' : '#0ea5e9',
          metadata: { generatedBy: GENERATED_BY, rooms: members.map((m) => m.room.name), kind: lead.kind },
        },
        parentId: levelId,
      })
      zones += 1
    }
    for (const [i, room] of rooms.entries()) {
      if (!used.has(i)) warnings.push(`room "${room.name}" was not found as an enclosed space — no zone was made for it.`)
    }
  } catch (error) {
    warnings.push(`zone detection failed (${(error as Error).message}) — no zones were made.`)
  }

  // ── slab under the outline ────────────────────────────────────────────
  const slabId = generateId('slab')
  const outlineLocal = ring.map(toLocal)
  const slabOp: NodeOp = {
    node: {
      id: slabId,
      type: 'slab',
      name: 'Slab on grade',
      parentId: levelId,
      polygon: outlineLocal,
      holes: [],
      elevation: 0.05,
      thickness: 0.1016,
      metadata: { generatedBy: GENERATED_BY },
    },
    parentId: levelId,
  }

  // ── roof ──────────────────────────────────────────────────────────────
  const roofOps = roofFor(doc, style, rooms, toLocal, exteriorT, ceilingM, levelId, warnings)

  // ── building on the parcel ────────────────────────────────────────────
  let position: [number, number, number] = [0, 0, 0]
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
    position = [round(mx - nx * halfD), 0, round(mz - nz * halfD)]
    if (W * IN > el) warnings.push(`the house is ${(W / 12).toFixed(0)}' wide but the buildable frontage is ${(el / FT).toFixed(0)}' — check the side setbacks.`)
  }

  const buildingOp: NodeOp = {
    node: {
      id: buildingId,
      type: 'building',
      name: doc.name,
      parentId: siteId,
      position,
      rotation: [0, round(yaw, 6), 0],
      metadata: { generatedBy: GENERATED_BY, generation: options.generation ?? {}, style: style.key, document: input },
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
  const ordered: NodeOp[] = [buildingOp, levelOp, slabOp, ...ops, ...zoneOps, ...roofOps]
  if (errors.length > 0) return { ...empty(errors), warnings }
  return {
    ok: true,
    ops: ordered,
    errors,
    warnings,
    stats: { rooms: rooms.length, walls: walls.length, doors, windows, zones, livingSqFt: Math.round(livingSqFt), footprintSqFt: Math.round(footprintSqFt) },
    buildingId,
    levelId,
  }
}

/**
 * One roof segment over the house's own rectangle and one over each garage
 * wing, so an L-shaped footprint does not get a single box roof hanging over
 * the notch. Wings ride under a ridge that runs front-to-back (the gable
 * faces the street, the way an attached garage is roofed) and Pascal's roof
 * system merges the segments where they meet.
 */
function roofFor(
  doc: NormalizedDocument,
  style: StylePreset,
  rooms: readonly NormalizedRoom[],
  toLocal: (p: Pt) => Pt,
  exteriorT: number,
  ceilingM: number,
  levelId: string,
  warnings: string[],
): NodeOp[] {
  const form = doc.roof.form === 'auto' ? style.roofForm : doc.roof.form
  const pitchTwelfths = doc.roof.pitch ?? style.pitch
  const overhangIn = doc.roof.overhang ?? style.overhangIn
  const roofId = generateId('roof')
  const gables = doc.roof.gables
  const roofType = form === 'flat' ? 'flat' : form === 'shed' ? 'shed' : form === 'hip' ? 'hip' : 'gable'
  if (form === 'flat') warnings.push('flat roof: drawn as a flat roof segment; the roof plan shows no pitch arrows.')
  const pitchDeg = round((Math.atan(pitchTwelfths / 12) * 180) / Math.PI, 3)
  const ops: NodeOp[] = [
    {
      node: {
        id: roofId,
        type: 'roof',
        name: 'Roof',
        parentId: levelId,
        position: [0, round(ceilingM - 0.5), 0],
        rotation: 0,
        metadata: { generatedBy: GENERATED_BY, intent: { form, pitchInTwelfths: pitchTwelfths, overhangIn, gables } },
      },
      parentId: levelId,
    },
  ]
  const segment = (name: string, rect: { u0: number; v0: number; u1: number; v1: number }, ridgeAlongDepth: boolean) => {
    const w = rect.u1 - rect.u0
    const d = rect.v1 - rect.v0
    const centre = toLocal([(rect.u0 + rect.u1) / 2, (rect.v0 + rect.v1) / 2])
    ops.push({
      node: {
        id: generateId('rseg'),
        type: 'roof-segment',
        name,
        parentId: roofId,
        position: [centre[0], 0, centre[1]],
        rotation: ridgeAlongDepth ? -Math.PI / 2 : 0,
        roofType,
        width: round((ridgeAlongDepth ? d : w) * IN + exteriorT),
        depth: round((ridgeAlongDepth ? w : d) * IN + exteriorT),
        wallHeight: 0.5,
        pitch: pitchDeg,
        overhang: round(overhangIn * IN),
        metadata: { generatedBy: GENERATED_BY },
      },
      parentId: roofId,
    })
  }
  const house = rooms.filter((r) => r.kind !== 'garage')
  const wings = rooms.filter((r) => r.kind === 'garage')
  const main = {
    u0: Math.min(...house.map((r) => r.u0)),
    v0: Math.min(...house.map((r) => r.v0)),
    u1: Math.max(...house.map((r) => r.u1)),
    v1: Math.max(...house.map((r) => r.v1)),
  }
  const W = main.u1 - main.u0
  const D = main.v1 - main.v0
  // Ridge direction: gable ends on front/back put the ridge along the depth;
  // otherwise along the width (the long way for a hip).
  const ridgeAlongDepth =
    gables.includes('front') || gables.includes('back') || (form !== 'gable' && D > W && !gables.length)
  segment('Main roof', main, ridgeAlongDepth)
  for (const wing of wings) segment(`${wing.name} roof`, wing, true)
  return ops
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

