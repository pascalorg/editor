import type { AnyNode, AnyNodeId, BuildingNode, LevelNode, WallNode } from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import { levelFloorWorldY, levelPlaneWorldY, levelPlateUndersideWorldY } from '../services/storey'
import { getWallFaceOffsets } from '../systems/wall/wall-frame'
import {
  type BuildingFoundation,
  FOUNDATION_SILL_IN,
  inches,
  slabEdgeTaper,
} from './building-foundation'
import { exteriorWallLoops } from './exterior-wall-loops'
import type { GradingPad } from './foundation-grading'
import type { FoundationMember } from './generic-foundation'
import { containsPoint, difference, intersection, type Ring, union } from './polygon-boolean'
import { isSiteFlatwork } from './site-flatwork'
import { levelLocalToWorldXZ } from './terrain-support-query'

type Nodes = Record<AnyNodeId, AnyNode>
type P = [number, number]

/** One side of a foundation outline, level-local, the building on its left. */
type OutlineEdge = { a: P; b: P; wallId: string | null }

/**
 * The outside of the walls of one closed loop, level-local and counter-clockwise (the building on
 * the left of every edge): each wall's exterior face, the corners where those faces meet, a jog
 * where two walls in line differ in thickness.
 */
export type FoundationOutline = {
  edges: OutlineEdge[]
  /** Per vertex (the start of `edges[i]`): the outline turns outward there (a corner of the house, not an inside corner). */
  convex: boolean[]
}

/** What the designed foundation measured and how it stands against its own rules. */
export type DesignedFoundationReport = {
  buildingId: string
  levelId: string
  foundation: BuildingFoundation
  floorTopY: number
  highestGradeY: number
  lowestGradeY: number
  /** The stem wall's (a raised grade beam's, a basement's walls') top; `null` for a slab. */
  stemTopY: number | null
  /** The deepest the perimeter goes, the bottom of its lowest step. */
  bottomY: number
  /** The most steps along one side. */
  steps: number
  /** The tallest of those steps, metres (a short run joined to its deeper neighbour can drop more than one step height). */
  tallestStep: number
  piles: number
  /** A raised floor's cripple walls: how many runs, and the tallest, metres (stem top up to the floor framing). */
  cripples: number
  tallestCripple: number
  /** A raised floor's crawl space: the dirt under it, dug out to this, world Y; `null` for a slab. */
  crawlY: number | null
  /** The house stands on a basement (`designedBasement`); absent for a slab or a raised floor. */
  basement?: BasementReport
}

/**
 * How a house over a basement stands: the report's `levelId` and `floorTopY` are the basement's,
 * its `stemTopY` the basement walls' top, its grades read along their outside faces.
 */
export type BasementReport = {
  /** The ground floor over it, whose floor framing bears on the walls' top. */
  groundLevelId: string
  /** The level whose walls the outline runs along: the basement's own, or the ground floor's. */
  outlineLevelId: string
  /** The basement's walls are its own (drawn on its level), not poured under the house's outline. */
  ownWalls: boolean
  /** Where the floor over it bears on the walls: their top, under its sill, world Y. */
  wallTopY: number
  /** That floor's top, world Y: its framing and the sill stand between it and `wallTopY`. */
  groundFloorTopY: number
  /** The ground dug out inside the walls' outside faces down to this, world Y. */
  excavationY: number
}

/** Grade is read along the outline this often, metres. */
const GRADE_STEP = 0.15
/** The sill a raised floor's joists bear on, over the stem's top: the joists' underside stands this far over it. */
const SILL = inches(FOUNDATION_SILL_IN)
/** The concrete's outer face stands this far outside the wall's face, so the two never share a plane. */
const FACE_CLEARANCE = 0.001

/**
 * Where a wall's exterior face lies against a centreline edge of the loop: the distance from the
 * edge, out of the building. A justified wall's body is off its line; this follows the body.
 */
function exteriorFaceDistance(wall: WallNode | undefined, edgeDir: P, outward: P): number {
  if (!wall) return 0
  const { a, b } = getWallFaceOffsets(wall)
  const chord: P = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
  const along = edgeDir[0] * chord[0] + edgeDir[1] * chord[1] >= 0 ? 1 : -1
  // The wall's own left, at this edge.
  const left: P = [-edgeDir[1] * along, edgeDir[0] * along]
  const side = left[0] * outward[0] + left[1] * outward[1] >= 0 ? 1 : -1
  return Math.max(a * side, b * side)
}

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]]
const scale = (a: P, k: number): P => [a[0] * k, a[1] * k]
const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0]
const len = (a: P) => Math.hypot(a[0], a[1])
const unit = (a: P): P => {
  const l = len(a)
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l]
}

function signedArea(points: readonly P[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const q = points[(i + 1) % points.length]!
    sum += p[0] * q[1] - q[0] * p[1]
  }
  return sum / 2
}

/** The point where the lines through `p` along `u` and through `q` along `v` cross; `null` when they run in line. */
function intersect(p: P, u: P, q: P, v: P): P | null {
  const d = cross(u, v)
  if (Math.abs(d) < 1e-6) return null
  const t = cross(sub(q, p), v) / d
  return add(p, scale(u, t))
}

/**
 * The exterior faces of each closed loop of `walls`, as one outline per loop. Walls in line merge
 * into one side (a partition meeting the outside wall splits it in the wall graph, not here).
 */
export function foundationOutlines(walls: WallNode[]): FoundationOutline[] {
  const byId = new Map(walls.map((wall) => [wall.id as string, wall]))
  const outlines: FoundationOutline[] = []
  for (const loop of exteriorWallLoops(walls)) {
    const centre: OutlineEdge[] = []
    for (const face of loop)
      for (let i = 0; i + 1 < face.points.length; i++) {
        const a = face.points[i] as P
        const b = face.points[i + 1] as P
        if (len(sub(b, a)) > 1e-6) centre.push({ a, b, wallId: face.wallId })
      }
    if (centre.length < 3) continue
    const ccw = signedArea(centre.map((edge) => edge.a)) > 0
    // Each centreline edge moved out to its wall's exterior face.
    const faces = centre.map((edge) => {
      const u = unit(sub(edge.b, edge.a))
      const outward: P = ccw ? [u[1], -u[0]] : [-u[1], u[0]]
      const wall = edge.wallId ? byId.get(edge.wallId) : undefined
      const d = exteriorFaceDistance(wall, u, outward) + FACE_CLEARANCE
      return {
        a: add(edge.a, scale(outward, d)),
        b: add(edge.b, scale(outward, d)),
        u,
        wallId: edge.wallId as string | null,
      }
    })
    // Sides in line become one.
    const merged: typeof faces = []
    for (const face of faces) {
      const last = merged[merged.length - 1]
      if (
        last &&
        Math.abs(cross(last.u, face.u)) < 1e-6 &&
        last.u[0] * face.u[0] + last.u[1] * face.u[1] > 0 &&
        Math.abs(cross(last.u, sub(face.a, last.a))) < 1e-4
      ) {
        last.b = face.b
        continue
      }
      merged.push({ ...face })
    }
    if (merged.length > 2) {
      const first = merged[0]!
      const last = merged[merged.length - 1]!
      if (
        Math.abs(cross(last.u, first.u)) < 1e-6 &&
        last.u[0] * first.u[0] + last.u[1] * first.u[1] > 0 &&
        Math.abs(cross(last.u, sub(first.a, last.a))) < 1e-4
      ) {
        first.a = last.a
        merged.pop()
      }
    }
    if (merged.length < 3) continue
    // Corners: neighbouring faces meet where their lines cross; faces in line (two thicknesses) jog.
    const points: { at: P; wallId: string | null }[] = []
    for (let i = 0; i < merged.length; i++) {
      const prev = merged[(i - 1 + merged.length) % merged.length]!
      const face = merged[i]!
      const corner = intersect(prev.a, prev.u, face.a, face.u)
      if (corner && len(sub(corner, face.a)) < 2 && len(sub(corner, prev.b)) < 2) {
        points.push({ at: corner, wallId: face.wallId })
      } else {
        points.push({ at: prev.b, wallId: null })
        points.push({ at: face.a, wallId: face.wallId })
      }
    }
    let edges: OutlineEdge[] = points
      .map((point, i) => ({
        a: point.at,
        b: points[(i + 1) % points.length]!.at,
        wallId: point.wallId,
      }))
      .filter((edge) => len(sub(edge.b, edge.a)) > 1e-6)
    if (!ccw) edges = edges.reverse().map((edge) => ({ a: edge.b, b: edge.a, wallId: edge.wallId }))
    if (edges.length < 3) continue
    const convex = edges.map((edge, i) => {
      const prev = edges[(i - 1 + edges.length) % edges.length]!
      return cross(unit(sub(prev.b, prev.a)), unit(sub(edge.b, edge.a))) >= -1e-9
    })
    outlines.push({ edges, convex })
  }
  return outlines
}

/**
 * A drawn outline (a `foundation` node's polygon) as the designed foundation reads one: wound
 * counter-clockwise, repeated corners and corners in line dropped. `null` for fewer than three
 * corners or no area.
 */
export function outlineOfPolygon(
  polygon: ReadonlyArray<readonly [number, number]>,
): FoundationOutline | null {
  let points: P[] = []
  for (const [x, z] of polygon) {
    const last = points[points.length - 1]
    if (!last || len(sub([x, z], last)) > 1e-6) points.push([x, z])
  }
  while (points.length > 1 && len(sub(points[0]!, points[points.length - 1]!)) <= 1e-6) points.pop()
  // A corner in line with its neighbours is no corner.
  points = points.filter((point, i) => {
    const prev = points[(i - 1 + points.length) % points.length]!
    const next = points[(i + 1) % points.length]!
    return Math.abs(cross(unit(sub(point, prev)), unit(sub(next, point)))) > 1e-6
  })
  if (points.length < 3 || Math.abs(signedArea(points)) < 1e-6) return null
  if (signedArea(points) < 0) points.reverse()
  const edges: OutlineEdge[] = points.map((a, i) => ({
    a,
    b: points[(i + 1) % points.length]!,
    wallId: null,
  }))
  const convex = edges.map((edge, i) => {
    const prev = edges[(i - 1 + edges.length) % edges.length]!
    return cross(unit(sub(prev.b, prev.a)), unit(sub(edge.b, edge.a))) >= -1e-9
  })
  return { edges, convex }
}

/** A ring as the clipper returns it, closed by repeating its first point: open it again. */
function openRing(ring: Ring): P[] {
  const points = ring.map(([x, z]) => [x, z] as P)
  const first = points[0]
  const last = points[points.length - 1]
  if (first && last && points.length > 1 && first[0] === last[0] && first[1] === last[1])
    points.pop()
  return points
}

/** An outline moved `inset` metres into the building, its corners re-met. */
function insetOutline(outline: FoundationOutline, inset: number): FoundationOutline {
  if (Math.abs(inset) < 1e-9) return outline
  const moved = outline.edges.map((edge) => {
    const u = unit(sub(edge.b, edge.a))
    const inward: P = [-u[1], u[0]]
    return { a: add(edge.a, scale(inward, inset)), u, wallId: edge.wallId }
  })
  const corners = moved.map((edge, i) => {
    const prev = moved[(i - 1 + moved.length) % moved.length]!
    return intersect(prev.a, prev.u, edge.a, edge.u) ?? edge.a
  })
  return {
    edges: moved.map((edge, i) => ({
      a: corners[i]!,
      b: corners[(i + 1) % corners.length]!,
      wallId: edge.wallId,
    })),
    convex: outline.convex,
  }
}

/** The highest and the lowest grade along the outlines, read every {@link GRADE_STEP} metres. */
function gradeAlong(
  outlines: readonly FoundationOutline[],
  gradeOf: (p: P) => number,
): { highestGradeY: number; lowestGradeY: number } {
  let highestGradeY = Number.NEGATIVE_INFINITY
  let lowestGradeY = Number.POSITIVE_INFINITY
  for (const outline of outlines)
    for (const edge of outline.edges) {
      const length = len(sub(edge.b, edge.a))
      const count = Math.max(2, Math.ceil(length / GRADE_STEP) + 1)
      for (let k = 0; k < count; k++) {
        const g = gradeOf(add(edge.a, scale(sub(edge.b, edge.a), k / (count - 1))))
        highestGradeY = Math.max(highestGradeY, g)
        lowestGradeY = Math.min(lowestGradeY, g)
      }
    }
  return { highestGradeY, lowestGradeY }
}

/** A stretch of a side at one footing level: `s0` to `s1` metres along it, its bottom at `level`. */
type Piece = { s0: number; s1: number; level: number }
/** A raised floor's stretch: its stem's top at `stemTop`, a cripple wall over it where that is under the floor framing. */
type RaisedPiece = Piece & { stemTop: number }

/**
 * A side cut into level pieces. Each sample needs its bottom no higher than `required(s)` (the
 * grade there, less the depth); pieces sit on steps of `stepHeight` over `datum` (the building's
 * deepest need, so flat ground puts every bottom exactly at its depth), and a piece shorter than
 * `minRun` joins the deeper neighbour. Unstepped, a side is one piece at `datum`.
 */
function piecesAlong(
  length: number,
  required: (s: number) => number,
  datum: number,
  foundation: BuildingFoundation,
): Piece[] {
  if (!foundation.stepped) return [{ s0: 0, s1: length, level: datum }]
  const step = inches(foundation.stepHeightIn)
  const minRun = inches(foundation.minStepRunIn)
  const count = Math.max(2, Math.ceil(length / GRADE_STEP) + 1)
  const levels: number[] = []
  for (let k = 0; k < count; k++) {
    // A sample stands for the run half a spacing either side of it: its level holds at both ends
    // too, or a steep bank between samples leaves the footing short of its depth there.
    const s = (length * k) / (count - 1)
    const half = length / (count - 1) / 2
    const need = Math.min(
      required(s),
      required(Math.max(0, s - half)),
      required(Math.min(length, s + half)),
    )
    levels.push(datum + Math.max(0, Math.floor((need - datum) / step + 1e-9)) * step)
  }
  const pieces: Piece[] = []
  for (let k = 0; k < count; k++) {
    const s = (length * k) / (count - 1)
    const half = length / (count - 1) / 2
    const last = pieces[pieces.length - 1]
    if (last && Math.abs(last.level - levels[k]!) < 1e-9) last.s1 = Math.min(length, s + half)
    else
      pieces.push({ s0: Math.max(0, s - half), s1: Math.min(length, s + half), level: levels[k]! })
  }
  // A step's run is never shorter than the least run: the short piece takes the deeper level of its
  // neighbours, which every sample of both still allows.
  while (pieces.length > 1) {
    let shortest = -1
    for (let k = 0; k < pieces.length; k++) {
      const piece = pieces[k]!
      if (piece.s1 - piece.s0 >= minRun - 1e-9) continue
      if (shortest < 0 || piece.s1 - piece.s0 < pieces[shortest]!.s1 - pieces[shortest]!.s0)
        shortest = k
    }
    if (shortest < 0) break
    const piece = pieces[shortest]!
    const before = pieces[shortest - 1]
    const after = pieces[shortest + 1]
    const into = !after || (before && before.level <= after.level) ? shortest - 1 : shortest + 1
    const other = pieces[into]!
    other.s0 = Math.min(other.s0, piece.s0)
    other.s1 = Math.max(other.s1, piece.s1)
    other.level = Math.min(other.level, piece.level)
    pieces.splice(shortest, 1)
    // Neighbours left at one level join.
    for (let k = pieces.length - 1; k > 0; k--) {
      const left = pieces[k - 1]!
      const right = pieces[k]!
      if (Math.abs(left.level - right.level) < 1e-9) {
        left.s1 = right.s1
        pieces.splice(k, 1)
      }
    }
  }
  return pieces
}

/**
 * A stretch of a wall over a cripple wall: its finish runs further down there, to the stepped-down
 * stem's top. `a` to `b` along the stem's line, level-local plan; `bottom` level-local Y.
 */
export type FoundationRimStep = { a: [number, number]; b: [number, number]; bottom: number }

export type DesignedFoundation = {
  members: FoundationMember[]
  /** Per exterior wall: the level-local Y its finish runs down to over the floor framing (the stem's top). */
  rimBottoms: Map<string, number>
  /** Per exterior wall: where its finish runs further down, over a cripple wall. */
  rimSteps: Map<string, FoundationRimStep[]>
  /**
   * Per wall a slab room shares with the house, on the house's stem: the stem's top (the sill
   * line), level-local. Under it the wall's face on the room's side, down to the room's slab, is
   * the stem's bare concrete; its finish starts there.
   */
  sharedStemTops: Map<string, number>
  /**
   * How it grades the ground (`foundation-grading`): a slab's building pads, one per outline, the
   * grade held along its edge; a raised floor's cut and crawl space; a basement's dig.
   */
  pads: GradingPad[]
  report: DesignedFoundationReport
}

/** How one drawn outline stands apart from the house's floor (a porch slab). */
export type DesignedOutlineOptions = {
  /** Its top this far under the level's floor top, metres. */
  drop?: number
  /** No floor plate lies over it: its slab is its own walking surface, up to its top. */
  ownTop?: boolean
}

/** A slab room's curb: its walls' sill this far over its slab (IRC R317.1: 8 in), metres. */
export const SLAB_ROOM_CURB = inches(8)

/** A raised house's room on a slab of its own (a garage, `floor.foundation`). */
type SlabRoom = {
  zoneId: string
  /** Its walls' outside faces, level-local: a wall it shares with the house to its far face. */
  region: FoundationOutline
  /** Its slab's top, world Y: the room's floor. */
  slabTop: number
  /** The ground held under it (`slabRoomTopAboveGradeIn` under its top), world Y. */
  padY: number
  /** Its walls: where they stand inside the house, on the house's stem wall (`insideRuns`). */
  shared: WallNode[]
}

/** Whether a wall runs along a side of `polygon`, within its own half thickness. */
function wallAlongPolygon(wall: WallNode, polygon: ReadonlyArray<readonly [number, number]>) {
  const mid = scale(add(wall.start as P, wall.end as P), 0.5)
  const dir = unit(sub(wall.end as P, wall.start as P))
  return polygon.some((a, index) => {
    const b = polygon[(index + 1) % polygon.length]!
    const side = sub(b as P, a as P)
    const length = len(side)
    if (length < 1e-6 || Math.abs(cross(unit(side), dir)) > 0.05) return false
    const t = ((mid[0] - a[0]) * side[0] + (mid[1] - a[1]) * side[1]) / (length * length)
    if (t < -0.01 || t > 1.01) return false
    const foot = add(a as P, scale(side, Math.max(0, Math.min(1, t))))
    return len(sub(mid, foot)) <= (wall.thickness ?? 0.15) / 2 + 0.05
  })
}

/**
 * The level's rooms on a slab of their own (`floor.foundation: 'slab'`) in a raised house: each
 * one's outline, the outside faces of the walls round it (`foundationOutlines`), its slab at its
 * floor and the ground held under it, and the walls it shares with the rest of the house.
 */
function slabRoomsOf(
  nodes: Nodes,
  level: LevelNode,
  planeY: number,
  foundation: BuildingFoundation,
): SlabRoom[] {
  const levelWalls = level.children
    .map((id) => nodes[id as AnyNodeId])
    .filter((node): node is WallNode => node?.type === 'wall' && node.visible !== false)
  const rooms: SlabRoom[] = []
  for (const id of level.children) {
    const zone = nodes[id as AnyNodeId]
    if (zone?.type !== 'zone' || zone.floor?.foundation !== 'slab' || zone.polygon.length < 3)
      continue
    const bounding =
      zone.boundaryWallIds.length > 0
        ? levelWalls.filter((wall) => zone.boundaryWallIds.includes(wall.id))
        : levelWalls.filter((wall) => wallAlongPolygon(wall, zone.polygon))
    const region = foundationOutlines(bounding)[0]
    if (!region) continue
    const slabTop = planeY + (zone.floor.elevation ?? DEFAULT_SLAB_ELEVATION)
    rooms.push({
      zoneId: zone.id,
      region,
      slabTop,
      padY: slabTop - inches(foundation.slabRoomTopAboveGradeIn),
      shared: bounding,
    })
  }
  return rooms
}

/**
 * A side of a raised outline (the stem's centreline, level-local) cut where it runs along a slab
 * room: `s0` to `s1` metres along it, the room it runs along or `null` for the raised floor.
 */
function slabSpansOf(
  edge: OutlineEdge,
  rooms: readonly SlabRoom[],
): Array<{ s0: number; s1: number; room: SlabRoom | null }> {
  const span = sub(edge.b, edge.a)
  const length = len(span)
  if (rooms.length === 0 || length < 1e-9) return [{ s0: 0, s1: length, room: null }]
  const u = unit(span)
  const inward: P = [-u[1], u[0]]
  const count = Math.max(2, Math.ceil(length / 0.05) + 1)
  const roomAt = (s: number) => {
    const probe = add(add(edge.a, scale(u, s)), scale(inward, 0.02))
    return (
      rooms.find((room) =>
        containsPoint([{ outer: room.region.edges.map((side) => side.a), holes: [] }], probe),
      ) ?? null
    )
  }
  const spans: Array<{ s0: number; s1: number; room: SlabRoom | null }> = []
  let previous = roomAt(0)
  let from = 0
  for (let k = 1; k < count; k++) {
    const s = (length * k) / (count - 1)
    const room = roomAt(s)
    if (room === previous) continue
    const cut = s - length / (count - 1) / 2
    spans.push({ s0: from, s1: cut, room: previous })
    from = cut
    previous = room
  }
  spans.push({ s0: from, s1: length, room: previous })
  return spans
}

/**
 * The stretches of a wall's centreline (level-local) standing inside `outline`, not on it: the
 * house on both its sides.
 */
function insideRuns(wall: WallNode, outline: FoundationOutline): Array<[P, P]> {
  const area = [{ outer: outline.edges.map((edge) => edge.a), holes: [] }]
  const start = wall.start as P
  const span = sub(wall.end as P, start)
  const length = len(span)
  if (length < 1e-6) return []
  const u = unit(span)
  const side = scale([-u[1], u[0]], (wall.thickness ?? 0.15) / 2 + 0.05)
  const count = Math.max(2, Math.ceil(length / 0.05) + 1)
  const inside = (s: number) => {
    const at = add(start, scale(u, s))
    return containsPoint(area, add(at, side)) && containsPoint(area, sub(at, side))
  }
  const runs: Array<[P, P]> = []
  let from: number | null = null
  for (let k = 0; k < count; k++) {
    const s = (length * k) / (count - 1)
    if (inside(s)) from ??= s
    else if (from !== null) {
      if (s - from > 0.1) runs.push([add(start, scale(u, from)), add(start, scale(u, s))])
      from = null
    }
  }
  if (from !== null && length - from > 0.1)
    runs.push([add(start, scale(u, from)), add(start, scale(u, length))])
  return runs
}

/**
 * The walls standing over `from` to `to` along a stem's centreline `edge`: in line with it, within
 * their half thickness and the stem's, overlapping the stretch.
 */
function wallsAlong(walls: readonly WallNode[], edge: OutlineEdge, from: number, to: number) {
  const u = unit(sub(edge.b, edge.a))
  const along = (p: P) => (p[0] - edge.a[0]) * u[0] + (p[1] - edge.a[1]) * u[1]
  const across = (p: P) => Math.abs(cross(u, sub(p, edge.a)))
  return walls.filter((wall) => {
    const start = wall.start as P
    const end = wall.end as P
    if (Math.abs(cross(u, unit(sub(end, start)))) > 0.05) return false
    if (across(scale(add(start, end), 0.5)) > (wall.thickness ?? 0.15) / 2 + 0.15) return false
    const [a, b] = [along(start), along(end)]
    return Math.min(to, Math.max(a, b)) - Math.max(from, Math.min(a, b)) > 1e-3
  })
}

/**
 * The doors in `wall` (a garage's overhead door, a man door), as stretches `s0` to `s1` along the
 * stem's centreline `edge`, within `from` to `to`, in order.
 */
function doorSpansAlong(
  nodes: Nodes,
  wall: WallNode,
  edge: OutlineEdge,
  from: number,
  to: number,
): Array<[number, number]> {
  const u = unit(sub(edge.b, edge.a))
  const dir = unit(sub(wall.end as P, wall.start as P))
  const along = (p: P) => (p[0] - edge.a[0]) * u[0] + (p[1] - edge.a[1]) * u[1]
  const spans: Array<[number, number]> = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'door' || node.parentId !== wall.id) continue
    const centre = node.position[0]
    const a = along(add(wall.start as P, scale(dir, centre - node.width / 2)))
    const b = along(add(wall.start as P, scale(dir, centre + node.width / 2)))
    const s0 = Math.max(from, Math.min(a, b))
    const s1 = Math.min(to, Math.max(a, b))
    if (s1 - s0 > 1e-3) spans.push([s0, s1])
  }
  return spans.sort((p, q) => p[0] - q[0])
}

/**
 * The building's designed foundation (`metadata.foundation`, switched on), under the exterior walls
 * of `level`, sized as the record says and set to the ground as it lies:
 *
 * - Slab on grade: the slab under the outline on its building pad, the finished grade held
 *   `topAboveGrade` under the slab's top all round (`pads`: low ground filled, high ground cut), its
 *   edge turned down `edgeDepth` under that grade, one level all round (a slab never steps),
 *   `edgeWidth` wide at the bottom, the inside face plumb from there (square to the bottom), then
 *   in at 45° to the slab's underside (`slabEdgeTaper`: half the depth under it, 6 to 12 in).
 * - Raised floor: a stem wall flush with the walls' faces from its footing up to the floor framing
 *   (the floor top less `floorFramingDepth`); the footing centred under it, its bottom `footingDepth`
 *   under the grade outside and as far under the crawl space's dirt, its top level. A side stays one
 *   level run while its stem stands no more than `maxStem` out of the ground; past that its footing
 *   steps down the slope, and where a step's stem would still stand over `maxStem` its top drops in
 *   whole steps to `topAboveGrade` over the ground there, a wood cripple wall over it up to the floor
 *   framing (or one level all round, unstepped). The crawl space is dug out to `crawlClearance`
 *   under the joists, and the ground outside cut down to `topAboveGrade` under the stem's top
 *   (`pads`).
 * - Piles: a grade beam in place of the footing and stem (or the slab's edge), its bottom as deep
 *   as a footing's, on piles at every corner and no further apart than `pileSpacing`.
 *
 * Grade is read along the outline where it meets the ground; the deepest need sets the datum the
 * steps are counted from, so flat ground leaves every bottom exactly at its depth. The outline is
 * the walls' outside faces (`foundationOutlines`), or `drawn` (the building's `foundation` nodes).
 */
export function designedFoundation(
  nodes: Nodes,
  building: BuildingNode,
  level: LevelNode,
  walls: WallNode[],
  foundation: BuildingFoundation,
  gradeAt: (x: number, z: number) => number,
  drawn?: FoundationOutline[],
  options: DesignedOutlineOptions = {},
): DesignedFoundation | null {
  const outlines = drawn ?? foundationOutlines(walls)
  if (outlines.length === 0) return null
  const planeY = levelPlaneWorldY(nodes, level.id) ?? building.position?.[1] ?? 0
  const drop = Math.max(0, options.drop ?? 0)
  const floorTopY = (levelFloorWorldY(nodes, level.id) ?? planeY) - drop
  // A slab's top is the floor's: a hair under the plates that draw the walking surface, and the
  // walking surface itself where no plate lies over it (past the walls, or the plates hidden).
  const slabTop = floorTopY - 0.002
  const raised = foundation.type === 'raised'
  const piles = foundation.support === 'piles'
  const world = (p: P): P => levelLocalToWorldXZ(building, p[0], p[1])
  const gradeOf = (p: P) => {
    const [x, z] = world(p)
    return gradeAt(x, z)
  }

  const { highestGradeY, lowestGradeY } = gradeAlong(outlines, gradeOf)

  const members: FoundationMember[] = []
  const rimBottoms = new Map<string, number>()
  const rimSteps = new Map<string, FoundationRimStep[]>()
  const base = { levelId: level.id, material: 'concrete' as const, designed: true as const }
  const stemTopY = raised ? floorTopY - inches(foundation.floorFramingDepthIn) : null
  // The top of the perimeter's concrete: under the floor framing, or (a slab) the floor top.
  const perimeterTop = stemTopY ?? floorTopY - 0.001
  // The level's floors lower than the slab's top (a garage a step down, a sunken room, a recessed
  // basin), world XZ: the concrete under them drops to their underside.
  const lowFloors: { polygon: P[]; y: number }[] = []
  if (!raised && !options.ownTop)
    for (const id of level.children) {
      const plate = nodes[id as AnyNodeId]
      if (plate?.type !== 'slab' || isSiteFlatwork(plate) || plate.polygon.length < 3) continue
      const top = planeY + plate.elevation
      if (plate.recessed !== true && top >= slabTop - 1e-4) continue
      lowFloors.push({
        polygon: plate.polygon.map(([x, z]) => world([x, z])),
        y: Math.min(slabTop, top - plate.thickness + 0.001),
      })
    }
  // A raised house's rooms on a slab of their own (a garage): poured apart from its raised floor.
  const slabRooms =
    raised && !piles && !options.drop && !options.ownTop
      ? slabRoomsOf(nodes, level, planeY, foundation)
      : []
  /** The concrete's top at a level-local point: under a lower floor there, else the slab's. */
  const surfaceAt = (p: P) => {
    const at = world(p)
    let top = slabTop
    for (const floor of lowFloors)
      if (containsPoint([{ outer: floor.polygon, holes: [] }], at)) top = Math.min(top, floor.y)
    return top
  }
  /**
   * The wall standing on a side of the outline: its own (traced from the walls), or one whose
   * outside face runs along a drawn side.
   */
  const wallOn = (edge: OutlineEdge): WallNode | undefined => {
    if (edge.wallId) return walls.find((candidate) => candidate.id === edge.wallId)
    const mid = scale(add(edge.a, edge.b), 0.5)
    const u = unit(sub(edge.b, edge.a))
    return walls.find((wall) => {
      const span = sub(wall.end as P, wall.start as P)
      const length = len(span)
      if (length < 1e-6 || Math.abs(cross(unit(span), u)) > 0.05) return false
      const offset = sub(mid, wall.start as P)
      const t = (offset[0] * span[0] + offset[1] * span[1]) / (length * length)
      if (t < 0 || t > 1) return false
      return (
        len(sub(mid, add(wall.start as P, scale(span, t)))) <= (wall.thickness ?? 0.15) / 2 + 0.03
      )
    })
  }
  const depthUnderGrade = inches(
    piles ? foundation.footingDepthIn : raised ? foundation.footingDepthIn : foundation.edgeDepthIn,
  )
  // A slab stands on its building pad: the finished grade held `topAboveGrade` under its top all
  // round (low ground filled, high ground cut), so its edge or grade beam is one level all round.
  const padY = raised ? null : floorTopY - inches(foundation.topAboveGradeIn)
  // A raised floor's crawl space, dug out under the joists (they bear on a sill on the stem). The
  // dug-out dirt is the ground inside: the footing goes as far under it as under the grade outside
  // (IRC R403.1.4), so where the dig is the lower its bottom drops to stay that deep.
  const crawlY = stemTopY === null ? null : stemTopY + SILL - inches(foundation.crawlClearanceIn)
  const needOf = (grade: number) =>
    (crawlY === null ? grade : Math.min(grade, crawlY)) - depthUnderGrade
  const datum = padY !== null ? padY - depthUnderGrade : needOf(lowestGradeY)
  let bottomY = Number.POSITIVE_INFINITY
  let steps = 0
  let tallestStep = 0
  let cripples = 0
  let tallestCripple = 0
  const pileAt: P[] = []
  const pads: GradingPad[] = []
  // The walls a slab room shares with the house, each on one stem however many rooms it bounds.
  const sharedStems = new Set<string>()
  const sharedStemTops = new Map<string, number>()

  /** Level pieces along one side of `outline` (possibly inset), bottoms no higher than its grade less the depth. */
  const piecesOf = (edge: OutlineEdge, depth: number) => {
    const span = sub(edge.b, edge.a)
    const length = len(span)
    if (padY !== null)
      return { length, pieces: [{ s0: 0, s1: length, level: padY - depth }], u: unit(span) }
    const pieces = piecesAlong(
      length,
      (s) => gradeOf(add(edge.a, scale(span, s / length))) - depth,
      lowestGradeY - depth,
      foundation,
    )
    countSteps(pieces)
    return { length, pieces, u: unit(span) }
  }

  const countSteps = (pieces: Piece[]) => {
    steps = Math.max(steps, pieces.length - 1)
    for (let k = 1; k < pieces.length; k++)
      tallestStep = Math.max(tallestStep, Math.abs(pieces[k]!.level - pieces[k - 1]!.level))
  }

  /**
   * A raised floor's side (the stem's centreline) in level pieces, each with its stem's top: one
   * level run, its footing at the deepest need along it, while the stem stands no more than
   * `maxStem` out of the ground; past that the footing steps down the slope (`piecesAlong`), and
   * where a piece's stem would still stand over `maxStem` its top drops in whole steps to
   * `topAboveGrade` over the piece's highest ground.
   */
  const raisedPiecesOf = (edge: OutlineEdge): { pieces: RaisedPiece[]; u: P } => {
    const span = sub(edge.b, edge.a)
    const length = len(span)
    const u = unit(span)
    const full = stemTopY!
    const gradeAlong = (s: number) => gradeOf(add(edge.a, scale(span, s / length)))
    const count = Math.max(2, Math.ceil(length / GRADE_STEP) + 1)
    const samples = Array.from({ length: count }, (_, k) => {
      const s = (length * k) / (count - 1)
      return { s, grade: gradeAlong(s) }
    })
    const lowest = Math.min(...samples.map((sample) => sample.grade))
    if (!foundation.stepped)
      return { pieces: [{ s0: 0, s1: length, level: datum, stemTop: full }], u }
    const step = inches(foundation.stepHeightIn)
    const maxStem = inches(foundation.maxStemIn)
    if (full - lowest <= maxStem + 1e-9) {
      // One level run: its bottom on the step at or under the side's deepest need.
      const need = needOf(lowest)
      const level = datum + Math.max(0, Math.floor((need - datum) / step + 1e-9)) * step
      return { pieces: [{ s0: 0, s1: length, level, stemTop: full }], u }
    }
    const pieces = piecesAlong(length, (s) => needOf(gradeAlong(s)), datum, foundation)
    countSteps(pieces)
    const top = inches(foundation.topAboveGradeIn)
    return {
      pieces: pieces.map((piece) => {
        const over = samples.filter(
          (sample) => sample.s >= piece.s0 - 1e-9 && sample.s <= piece.s1 + 1e-9,
        )
        const grades =
          over.length > 0
            ? over.map((sample) => sample.grade)
            : [gradeAlong((piece.s0 + piece.s1) / 2)]
        if (full - Math.min(...grades) <= maxStem + 1e-9) return { ...piece, stemTop: full }
        const drop =
          Math.max(0, Math.floor((full - (Math.max(...grades) + top)) / step + 1e-9)) * step
        return { ...piece, stemTop: full - drop }
      }),
      u,
    }
  }

  /** The world run of `s0..s1` along `edge`, carried `before` and `after` metres past its ends. */
  const runOf = (
    edge: OutlineEdge,
    u: P,
    s0: number,
    s1: number,
    before: number,
    after: number,
  ) => ({
    from: world(add(edge.a, scale(u, s0 - before))),
    to: world(add(edge.a, scale(u, s1 + after))),
  })

  for (const outline of outlines) {
    const count = outline.edges.length
    // A side is carried past an inside corner (where its neighbour's band would leave a notch), by
    // its own band's width; at a corner of the house it stops on the corner.
    const reach = (i: number, width: number) => ({
      before: outline.convex[i] ? 0 : width,
      after: outline.convex[(i + 1) % count] ? 0 : width,
    })

    if (piles) {
      const width = inches(foundation.gradeBeamWidthIn)
      const centre = insetOutline(outline, width / 2)
      const beamTop = stemTopY ?? floorTopY - 0.001
      const beamDepth = inches(foundation.gradeBeamDepthIn)
      const spacing = inches(foundation.pileSpacingIn)
      centre.edges.forEach((edge, i) => {
        const { length, pieces, u } = piecesOf(edge, depthUnderGrade)
        const ends = { before: width / 2, after: width / 2 }
        for (const [k, piece] of pieces.entries()) {
          // The piles carry it, so it needs no depth under the crawl space's dirt; it still goes
          // down to that dirt, or the dig inside would undercut it.
          const bottom = Math.min(
            beamTop - beamDepth,
            piece.level,
            crawlY ?? Number.POSITIVE_INFINITY,
          )
          bottomY = Math.min(bottomY, bottom)
          members.push({
            ...base,
            kind: 'grade-beam',
            ...runOf(
              edge,
              u,
              piece.s0,
              piece.s1,
              k === 0 ? ends.before : 0,
              k === pieces.length - 1 ? ends.after : 0,
            ),
            width,
            bottomY: bottom,
            topY: beamTop,
          })
        }
        const bays = Math.max(1, Math.ceil(length / spacing - 1e-9))
        for (let k = 0; k < bays; k++) {
          const s = (length * k) / bays
          const at = add(edge.a, scale(u, s))
          if (pileAt.some((other) => len(sub(other, at)) < width)) continue
          pileAt.push(at)
          const piece =
            pieces.find((candidate) => s <= candidate.s1 + 1e-9) ?? pieces[pieces.length - 1]!
          const top = Math.min(beamTop - beamDepth, piece.level)
          const bottom = top - inches(foundation.pileLengthIn)
          bottomY = Math.min(bottomY, bottom)
          const [x, z] = world(at)
          members.push({
            ...base,
            kind: 'pile',
            from: [x, z],
            to: [x, z],
            width: inches(foundation.pileDiameterIn),
            bottomY: bottom,
            topY: top,
          })
        }
      })
    } else if (raised) {
      const stemWidth = inches(foundation.stemThicknessIn)
      const footingWidth = Math.max(stemWidth, inches(foundation.footingWidthIn))
      const footingThickness = inches(foundation.footingThicknessIn)
      const centre = insetOutline(outline, stemWidth / 2)
      const outlineArea = [{ outer: outline.edges.map((edge) => world(edge.a)), holes: [] }]
      /**
       * A slab room's side, `s0` to `s1` along `edge` (the stem's centreline): a curb standing
       * `SLAB_ROOM_CURB` over the room's slab, on a footing its depth under the ground the room's
       * slab holds; at each door in the wall over it the curb is cut down to the slab, which runs
       * through to the outside face. The wall's finish runs down to the curb's top.
       */
      const pourCurb = (edge: OutlineEdge, s0: number, s1: number, room: SlabRoom) => {
        const length = len(sub(edge.b, edge.a))
        const u = unit(sub(edge.b, edge.a))
        const inward: P = [-u[1], u[0]]
        const first = s0 < 1e-9
        const last = s1 > length - 1e-9
        const footingBottom = room.padY - depthUnderGrade
        const footingTop = footingBottom + footingThickness
        const curbTop = room.slabTop + SLAB_ROOM_CURB
        bottomY = Math.min(bottomY, footingBottom)
        members.push({
          ...base,
          kind: 'footing',
          ...runOf(edge, u, s0, s1, first ? footingWidth / 2 : 0, last ? footingWidth / 2 : 0),
          width: footingWidth,
          bottomY: footingBottom,
          topY: footingTop,
        })
        // Every wall standing on this stretch (walls in line share one side of the outline).
        const over = wallsAlong(walls, edge, s0, s1)
        const doors = over
          .flatMap((wall) => doorSpansAlong(nodes, wall, edge, s0, s1))
          .sort((p, q) => p[0] - q[0])
        let from = s0
        for (const [d0, d1] of [...doors, [s1, s1] as [number, number]]) {
          if (d0 - from > 1e-3)
            members.push({
              ...base,
              kind: 'stem',
              ...runOf(
                edge,
                u,
                from,
                d0,
                from === s0 && first ? stemWidth / 2 : 0,
                d0 === s1 && last ? stemWidth / 2 : 0,
              ),
              width: stemWidth,
              bottomY: footingTop,
              topY: curbTop,
            })
          if (d1 - d0 > 1e-3) {
            // The door's gap: the slab runs out through it, at its own top, down to the footing.
            const at = (s: number, across: number) =>
              world(add(add(edge.a, scale(u, s)), scale(inward, across)))
            const gap = [
              at(d0, -stemWidth / 2),
              at(d1, -stemWidth / 2),
              at(d1, stemWidth / 2),
              at(d0, stemWidth / 2),
            ]
            members.push({
              ...base,
              kind: 'slab',
              from: gap[0]!,
              to: gap[0]!,
              width: 0,
              bottomY: footingTop,
              topY: room.slabTop - 0.002,
              outline: gap,
            })
          }
          from = Math.max(from, d1)
        }
        for (const wall of over) {
          const steps = rimSteps.get(wall.id) ?? []
          steps.push({
            a: add(edge.a, scale(u, s0 - (first ? stemWidth / 2 : 0))),
            b: add(edge.a, scale(u, s1 + (last ? stemWidth / 2 : 0))),
            bottom: curbTop - planeY,
          })
          rimSteps.set(wall.id, steps)
        }
      }
      centre.edges.forEach((edge) => {
        const length = len(sub(edge.b, edge.a))
        for (const span of slabSpansOf(edge, slabRooms)) {
          if (span.room) {
            pourCurb(edge, span.s0, span.s1, span.room)
            continue
          }
          // A side partly along a slab room: its raised stretch stands as a side of its own.
          const whole = span.s0 < 1e-9 && span.s1 > length - 1e-9
          const along = unit(sub(edge.b, edge.a))
          const part = whole
            ? edge
            : {
                a: add(edge.a, scale(along, span.s0)),
                b: add(edge.a, scale(along, span.s1)),
                wallId: edge.wallId,
              }
          const { pieces: own } = raisedPiecesOf(part)
          const u = along
          const pieces = own.map((piece) => ({
            ...piece,
            s0: piece.s0 + span.s0,
            s1: piece.s1 + span.s0,
          }))
          for (const [k, piece] of pieces.entries()) {
            const first = k === 0 && span.s0 < 1e-9
            const last = k === pieces.length - 1 && span.s1 > length - 1e-9
            const footingTop = Math.min(piece.level + footingThickness, piece.stemTop - 0.01)
            const footingBottom = Math.min(piece.level, footingTop - footingThickness)
            bottomY = Math.min(bottomY, footingBottom)
            members.push({
              ...base,
              kind: 'footing',
              ...runOf(
                edge,
                u,
                piece.s0,
                piece.s1,
                first ? footingWidth / 2 : 0,
                last ? footingWidth / 2 : 0,
              ),
              width: footingWidth,
              bottomY: footingBottom,
              topY: footingTop,
            })
            members.push({
              ...base,
              kind: 'stem',
              ...runOf(
                edge,
                u,
                piece.s0,
                piece.s1,
                first ? stemWidth / 2 : 0,
                last ? stemWidth / 2 : 0,
              ),
              width: stemWidth,
              bottomY: footingTop,
              topY: piece.stemTop,
            })
            const cripple = stemTopY! - piece.stemTop
            if (cripple > 1e-4) {
              cripples += 1
              tallestCripple = Math.max(tallestCripple, cripple)
              // The wall over it carries its finish down over the cripple wall to the stem.
              const wall = wallOn(edge)
              if (wall) {
                const steps = rimSteps.get(wall.id) ?? []
                steps.push({
                  a: add(edge.a, scale(u, piece.s0 - (first ? stemWidth / 2 : 0))),
                  b: add(edge.a, scale(u, piece.s1 + (last ? stemWidth / 2 : 0))),
                  bottom: piece.stemTop - planeY,
                })
                rimSteps.set(wall.id, steps)
              }
              members.push({
                ...base,
                material: 'wood',
                kind: 'cripple',
                ...runOf(
                  edge,
                  u,
                  piece.s0,
                  piece.s1,
                  first ? stemWidth / 2 : 0,
                  last ? stemWidth / 2 : 0,
                ),
                width: stemWidth,
                bottomY: piece.stemTop,
                topY: stemTopY!,
              })
            }
          }
        }
      })
      // A slab room's slab between its curbs, and the walls it shares with the house on the
      // house's stem, their full height standing over the room's slab.
      for (const room of slabRooms) {
        if (!room.region.edges.some((edge) => containsPoint(outlineArea, world(edge.a)))) continue
        const ring = insetOutline(room.region, stemWidth).edges.map((edge) => world(edge.a))
        members.push({
          ...base,
          kind: 'slab',
          from: ring[0]!,
          to: ring[0]!,
          width: 0,
          bottomY: room.slabTop - inches(foundation.slabThicknessIn),
          topY: room.slabTop - 0.002,
          outline: ring,
        })
        for (const wall of room.shared) {
          if (sharedStems.has(wall.id)) continue
          sharedStems.add(wall.id)
          const footingBottom = Math.min(crawlY ?? room.padY, room.padY) - depthUnderGrade
          const footingTop = footingBottom + footingThickness
          // Only where the wall stands inside the house: a stretch of it on the outline (the
          // house's wall running on past the room) is on the outline's own stem.
          for (const [start, end] of insideRuns(wall, outline)) {
            const u = unit(sub(end, start))
            bottomY = Math.min(bottomY, footingBottom)
            sharedStemTops.set(wall.id, stemTopY! - planeY)
            members.push(
              {
                ...base,
                kind: 'footing',
                from: world(add(start, scale(u, -footingWidth / 2))),
                to: world(add(end, scale(u, footingWidth / 2))),
                width: footingWidth,
                bottomY: footingBottom,
                topY: footingTop,
              },
              {
                ...base,
                kind: 'stem',
                from: world(add(start, scale(u, -stemWidth / 2))),
                to: world(add(end, scale(u, stemWidth / 2))),
                width: stemWidth,
                bottomY: footingTop,
                topY: stemTopY!,
              },
            )
          }
        }
      }
    } else {
      // The slab's edge, in section: out at the outline from its top down to the step's bottom,
      // along it the edge's width, the inside face plumb back up, then in at 45° to the slab's
      // underside (a deeper edge grows plumb, not wider). Its top is the slab's beside it; where a
      // wall stands on the side, the floor top under the wall (a curb, over a floor a step down).
      const edgeWidth = inches(foundation.edgeWidthIn)
      const slabUnderside = floorTopY - inches(foundation.slabThicknessIn)
      const taperAsSet = foundation.edgeTaperIn === null ? null : inches(foundation.edgeTaperIn)
      outline.edges.forEach((edge, i) => {
        const wall = wallOn(edge)
        const lip = wall ? Math.max(0.05, (wall.thickness ?? 0.15) - FACE_CLEARANCE * 2) : 0
        const inward: P = [-unit(sub(edge.b, edge.a))[1], unit(sub(edge.b, edge.a))[0]]
        const { pieces, u } = piecesOf(edge, depthUnderGrade)
        for (const [k, piece] of pieces.entries()) {
          const mid = add(edge.a, scale(u, (piece.s0 + piece.s1) / 2))
          const insideTop = surfaceAt(add(mid, scale(inward, lip + 0.05)))
          const outsideTop = wall ? Math.max(perimeterTop, insideTop) : insideTop
          const bottom = Math.min(piece.level, slabUnderside - 0.01, insideTop - 0.01)
          bottomY = Math.min(bottomY, bottom)
          const rise = Math.min(slabUnderside, insideTop) - bottom
          const taper = slabEdgeTaper(rise, taperAsSet)
          const top = edgeWidth + taper
          const lipWidth = Math.min(lip, top)
          const band = { before: 0, after: 0 }
          const corners = reach(i, top)
          if (k === 0) band.before = corners.before
          if (k === pieces.length - 1) band.after = corners.after
          const section: Array<[number, number]> = [
            [0, bottom],
            [edgeWidth, bottom],
            ...(rise - taper > 1e-6
              ? ([[edgeWidth, bottom + rise - taper]] as Array<[number, number]>)
              : []),
            [top, bottom + rise],
            ...(insideTop > bottom + rise + 1e-6
              ? ([[top, insideTop]] as Array<[number, number]>)
              : []),
            ...(outsideTop > insideTop + 1e-6
              ? ([
                  [lipWidth, insideTop],
                  [lipWidth, outsideTop],
                ] as Array<[number, number]>)
              : []),
            [0, outsideTop],
          ]
          members.push({
            ...base,
            kind: 'turndown',
            ...runOf(edge, u, piece.s0, piece.s1, band.before, band.after),
            width: top,
            bottomY: bottom,
            topY: outsideTop,
            section,
          })
        }
      })
    }
    if (!raised) {
      const thickness = inches(foundation.slabThicknessIn)
      const slab = (polygon: P[], holes: P[][], top: number, bottom: number) => {
        if (polygon.length < 3) return
        members.push({
          ...base,
          kind: 'slab',
          from: polygon[0]!,
          to: polygon[0]!,
          width: 0,
          bottomY: bottom,
          topY: top,
          outline: polygon,
          ...(holes.length > 0 ? { holes } : {}),
        })
      }
      // A hair inside the edge's outer face, which stands on the same line.
      const ring = insetOutline(outline, 0.01).edges.map((edge) => world(edge.a))
      if (lowFloors.length === 0) slab(ring, [], slabTop, floorTopY - thickness)
      else {
        // At the floor's top round the lower floors, under each of them at its underside.
        const low = union(lowFloors.map((floor) => floor.polygon))
        for (const piece of difference(ring, low))
          slab(openRing(piece.outer), piece.holes.map(openRing), slabTop, floorTopY - thickness)
        for (const floor of lowFloors)
          for (const piece of intersection(ring, floor.polygon))
            slab(openRing(piece.outer), piece.holes.map(openRing), floor.y, floor.y - thickness)
      }
    }
    if (padY !== null) {
      pads.push({ outline: outline.edges.map((edge) => world(edge.a)), y: padY })
      // The ground stays under the concrete: dug out under a slab thicker than its pad leaves room
      // for, and under each floor set down in it (a garage a step down) to that floor's underside.
      const thickness = inches(foundation.slabThicknessIn)
      const under = [
        { polygon: outline.edges.map((edge) => world(edge.a)), y: floorTopY - thickness },
        ...lowFloors.map((floor) => ({ polygon: floor.polygon, y: floor.y - thickness })),
      ]
      for (const { polygon, y } of under)
        if (y < padY - 1e-4) pads.push({ outline: polygon, y, kind: 'pit' })
    }
    if (stemTopY !== null && crawlY !== null) {
      // Round a raised floor the ground is cut down to hold the stem's top `topAboveGrade` over it
      // (never filled: the floor stands over the slope); inside its perimeter the crawl is dug out.
      // A slab room in it is graded as a slab is, the ground held its exposure under its top, and
      // no crawl space is dug under it.
      const perimeter = inches(piles ? foundation.gradeBeamWidthIn : foundation.stemThicknessIn)
      const area = [{ outer: outline.edges.map((edge) => world(edge.a)), holes: [] }]
      const rooms = slabRooms
        .map((room) => ({ room, ring: room.region.edges.map((edge) => world(edge.a)) }))
        .filter(({ ring }) => ring.some((point) => containsPoint(area, point)))
      const without = (ring: P[]): P[][] =>
        rooms.length === 0
          ? [ring]
          : difference(ring, union(rooms.map((entry) => entry.ring))).map((piece) =>
              openRing(piece.outer),
            )
      for (const ring of without(area[0]!.outer))
        pads.push({ outline: ring, y: stemTopY - inches(foundation.topAboveGradeIn), kind: 'cut' })
      for (const ring of without(
        insetOutline(outline, perimeter).edges.map((edge) => world(edge.a)),
      ))
        pads.push({ outline: ring, y: crawlY, kind: 'pit' })
      for (const { room, ring } of rooms) pads.push({ outline: ring, y: room.padY })
    }
  }
  if (stemTopY !== null) for (const wall of walls) rimBottoms.set(wall.id, stemTopY - planeY)

  return {
    members,
    rimBottoms,
    rimSteps,
    sharedStemTops,
    pads,
    report: {
      buildingId: building.id,
      levelId: level.id,
      foundation,
      floorTopY,
      highestGradeY,
      lowestGradeY,
      stemTopY,
      bottomY: Number.isFinite(bottomY) ? bottomY : datum,
      steps,
      tallestStep,
      piles: pileAt.length,
      cripples,
      tallestCripple,
      crawlY,
    },
  }
}

/** A house over a basement, as {@link designedBasement} cuts it into the ground. */
export type DesignedBasementOptions = {
  /** The basement: the building's lowest level, under its ground floor. */
  basement: LevelNode
  /** The ground floor over it, whose floor framing bears on the basement walls. */
  ground: LevelNode
  /** The level the outlines were read from: the basement's with its own walls, else the ground floor's. */
  outlineLevelId: string
  /**
   * The basement's own walls, where they close an outline: they are its foundation walls, standing
   * on their (generic) `footings`, its floor its own plates. Absent, the walls are poured.
   */
  own?: { footings: FoundationMember[] }
}

/**
 * Where the floor over a basement bears on its walls, world Y: under the joists of the ground
 * floor's plates (flooring, subfloor and joists; a ceiling hangs under them, inside the basement)
 * by the sill. A ground floor with no plate bears on them under its plane.
 */
export function basementWallTopY(nodes: Nodes, ground: LevelNode): number {
  const plane = levelPlaneWorldY(nodes, ground.id) ?? 0
  let underJoists = Number.POSITIVE_INFINITY
  for (const id of ground.children) {
    const plate = nodes[id as AnyNodeId]
    if (plate?.type !== 'slab' || plate.plateRole !== 'base' || plate.recessed === true) continue
    if (isSiteFlatwork(plate) || plate.polygon.length < 3) continue
    const ceiling = plate.buildUp?.ceiling?.thickness ?? 0
    underJoists = Math.min(underJoists, plane + plate.elevation - plate.thickness + ceiling)
  }
  return (Number.isFinite(underJoists) ? underJoists : plane) - SILL
}

/**
 * A house over a basement (`basement`, under its `ground` floor), cut into the ground: nothing is
 * filled or cut round it. Inside its outlines, the basement walls' outside faces, the ground is dug
 * out down to the slab's underside and cut plumb along them (`pads`: an `excavation` per outline),
 * so no earth stands in the basement or through its walls and slab; outside them the natural ground
 * meets the walls where it lies, a downhill wall standing further out of it (a daylight basement).
 *
 * - With walls of its own (drawn on its level, closing an outline), those are the foundation walls,
 *   standing on their footing as the generic foundation lays it (`own.footings`), the basement's
 *   floor its own plates; the outlines run along their outside faces.
 * - Without, its walls are poured under the house's outlines (the ground floor walls' outside
 *   faces, or the house's drawn outline): `basementWallThickness` of concrete flush with them, from
 *   a footing (`footingWidth` × `footingThickness`, centred under the wall, its top at the slab's
 *   underside) up to the floor framing over the basement (`basementWallTopY`), and the slab
 *   (`slabThickness`) between them, its top the basement's floor.
 *
 * The house is seated with the walls' top `basementTopAboveGrade` over the highest grade along the
 * outlines (`buildBuildingFoundationChanges`), the basement as deep under it as its storey goes.
 */
export function designedBasement(
  nodes: Nodes,
  building: BuildingNode,
  foundation: BuildingFoundation,
  gradeAt: (x: number, z: number) => number,
  outlines: FoundationOutline[],
  { basement, ground, outlineLevelId, own }: DesignedBasementOptions,
): DesignedFoundation | null {
  if (outlines.length === 0) return null
  const world = (p: P): P => levelLocalToWorldXZ(building, p[0], p[1])
  const plane = levelPlaneWorldY(nodes, basement.id) ?? building.position?.[1] ?? 0
  const floorTopY = levelFloorWorldY(nodes, basement.id) ?? plane
  const wallTopY = basementWallTopY(nodes, ground)
  const { highestGradeY, lowestGradeY } = gradeAlong(outlines, (p) => {
    const [x, z] = world(p)
    return gradeAt(x, z)
  })
  const members: FoundationMember[] = []
  let excavationY: number
  let bottomY: number
  if (own) {
    members.push(...own.footings)
    // Its floor is its own plates: dug out to their underside.
    excavationY = levelPlateUndersideWorldY(nodes, basement.id) ?? plane
    bottomY = Math.min(excavationY, ...own.footings.map((member) => member.bottomY))
  } else {
    const base = { levelId: basement.id, material: 'concrete' as const, designed: true as const }
    const wallWidth = inches(foundation.basementWallThicknessIn)
    const footingWidth = Math.max(wallWidth, inches(foundation.footingWidthIn))
    const slabBottom = floorTopY - inches(foundation.slabThicknessIn)
    const footingBottom = slabBottom - inches(foundation.footingThicknessIn)
    excavationY = slabBottom
    bottomY = footingBottom
    for (const outline of outlines) {
      // Along the walls' centreline, each run carried half its width past both ends so the
      // corners close.
      for (const edge of insetOutline(outline, wallWidth / 2).edges) {
        const span = sub(edge.b, edge.a)
        const length = len(span)
        if (length < 1e-6) continue
        const u = unit(span)
        const run = (reach: number) => ({
          from: world(add(edge.a, scale(u, -reach))),
          to: world(add(edge.a, scale(u, length + reach))),
        })
        members.push({
          ...base,
          kind: 'footing',
          ...run(footingWidth / 2),
          width: footingWidth,
          bottomY: footingBottom,
          topY: slabBottom,
        })
        if (wallTopY > slabBottom + 1e-4)
          members.push({
            ...base,
            kind: 'stem',
            ...run(wallWidth / 2),
            width: wallWidth,
            bottomY: slabBottom,
            topY: wallTopY,
          })
      }
      // The slab between the walls, a hair under the plates that draw the basement's floor.
      const ring = insetOutline(outline, wallWidth).edges.map((edge) => world(edge.a))
      if (ring.length >= 3)
        members.push({
          ...base,
          kind: 'slab',
          from: ring[0]!,
          to: ring[0]!,
          width: 0,
          bottomY: slabBottom,
          topY: floorTopY - 0.002,
          outline: ring,
        })
    }
  }
  return {
    members,
    rimBottoms: new Map(),
    rimSteps: new Map(),
    sharedStemTops: new Map(),
    pads: outlines.map((outline) => ({
      outline: outline.edges.map((edge) => world(edge.a)),
      y: excavationY,
      kind: 'excavation' as const,
    })),
    report: {
      buildingId: building.id,
      levelId: basement.id,
      foundation,
      floorTopY,
      highestGradeY,
      lowestGradeY,
      stemTopY: wallTopY,
      bottomY,
      steps: 0,
      tallestStep: 0,
      piles: 0,
      cripples: 0,
      tallestCripple: 0,
      crawlY: null,
      basement: {
        groundLevelId: ground.id,
        outlineLevelId,
        ownWalls: own !== undefined,
        wallTopY,
        groundFloorTopY: levelFloorWorldY(nodes, ground.id) ?? wallTopY + SILL,
        excavationY,
      },
    },
  }
}
