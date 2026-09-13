/**
 * The street frame — where the street is, in the level's own plan frame.
 * Pure: (site polygon + front edge, the building's transform, the walls
 * and rooms) → a unit direction FROM the building TOWARD the street, the
 * setback to the lot line, and where the answer came from.
 *
 * Every service engine reads it: the meter-main stands on a SIDE wall near
 * the front, the building drain leaves toward the street (or the rear), the
 * service drop comes from the pole at the lot line, the outdoor front
 * receptacle is on the street side. One definition of "the street" for the
 * whole MEP story — the electrical engine's bbox proxy stands only when no
 * frame can be built (site-less scenes, byte parity).
 */
import type { StreetFrame } from '../core/spec'
import type { RoomSlice, WallSlice } from '../core/types'

type Pt = readonly [number, number]

/** A site node's plan ring and its street-side edge index, as the host stores them. */
export type SiteRing = {
  points: readonly Pt[]
  /** The edge from points[i] to points[i + 1]; absent = the most north-facing edge. */
  frontEdge?: number
}

/** The building's site-local transform (three.js: world = position + Ry(yaw)·local). */
export type BuildingTransform = {
  position: readonly number[]
  rotation: readonly number[]
}

/** A wall's outward unit normal: the side whose face midpoint lies in no indoor room. */
export function outwardNormal(wall: WallSlice, rooms: readonly RoomSlice[], walls: readonly WallSlice[]): Pt {
  const [dx, dz] = wall.dir
  const mid: Pt = [
    wall.start[0] + dx * (wall.length / 2),
    wall.start[1] + dz * (wall.length / 2),
  ]
  const indoor = rooms.filter((r) => r.category !== 'outdoor')
  const probe = (side: 1 | -1): Pt => [mid[0] + -dz * side * (wall.thickness / 2 + 0.3), mid[1] + dx * side * (wall.thickness / 2 + 0.3)]
  const inside = (p: Pt) => indoor.some((r) => pointInPolygon(p, r.polygon))
  for (const side of [1, -1] as const) {
    if (!inside(probe(side)) && inside(probe(side === 1 ? -1 : 1))) return [-dz * side, dx * side]
  }
  // no room tells: away from the walls' centroid
  let cx = 0
  let cz = 0
  let n = 0
  for (const w of walls) {
    cx += w.start[0] + w.end[0]
    cz += w.start[1] + w.end[1]
    n += 2
  }
  if (n === 0) return [-dz, dx]
  cx /= n
  cz /= n
  const away = (mid[0] - cx) * -dz + (mid[1] - cz) * dx
  return away >= 0 ? [-dz, dx] : [dz, -dx]
}

function pointInPolygon(p: Pt, polygon: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Pt
    const b = polygon[j] as Pt
    const cross = a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]
    if (cross) inside = !inside
  }
  return inside
}

/** Seen from the street facing the house: the viewer's right-hand side (plan, y up). */
export const rightOfStreet = (dir: Pt): Pt => [dir[1], -dir[0]]
/** Seen from the street facing the house: the viewer's left-hand side. */
export const leftOfStreet = (dir: Pt): Pt => [-dir[1], dir[0]]

/** The site ring's outward unit normal of edge i (away from the ring's centroid). */
function ringOutward(points: readonly Pt[], i: number): Pt {
  const a = points[i] as Pt
  const b = points[(i + 1) % points.length] as Pt
  const ex = b[0] - a[0]
  const ez = b[1] - a[1]
  const len = Math.hypot(ex, ez) || 1
  let nx = -ez / len
  let nz = ex / len
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length
  const cz = points.reduce((s, p) => s + p[1], 0) / points.length
  const mx = (a[0] + b[0]) / 2
  const mz = (a[1] + b[1]) / 2
  if ((mx - cx) * nx + (mz - cz) * nz < 0) {
    nx = -nx
    nz = -nz
  }
  return [nx, nz]
}

/**
 * Build the frame. Precedence: the site's street edge (the lot plugin's
 * `frontEdge`, else the most north-facing edge — the same fallback the
 * site plan draws), turned into the level frame by the building's yaw;
 * else the exterior wall carrying the widest exterior door (the entry);
 * else plan up (−z) with a nominal 6 m setback. Null only with no walls.
 */
export function streetFrameFor(input: {
  site?: SiteRing | null
  building?: BuildingTransform | null
  walls: readonly WallSlice[]
  rooms: readonly RoomSlice[]
}): StreetFrame | null {
  const { site, building, walls, rooms } = input
  const straight = walls.filter((w) => !w.curved && w.length >= 0.1)
  if (straight.length === 0) return null
  if (site && site.points.length >= 3) {
    const n = site.points.length
    let i =
      typeof site.frontEdge === 'number' && Number.isInteger(site.frontEdge) && site.frontEdge >= 0 && site.frontEdge < n
        ? site.frontEdge
        : -1
    if (i < 0) {
      // most north-facing: the outward normal pointing most toward −z (plan up = north)
      let best = Number.POSITIVE_INFINITY
      for (let k = 0; k < n; k++) {
        const [, nz] = ringOutward(site.points, k)
        if (nz < best) {
          best = nz
          i = k
        }
      }
    }
    const [wx, wz] = ringOutward(site.points, i)
    const pos = building?.position ?? [0, 0, 0]
    const yaw = building?.rotation?.[1] ?? 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    // world = R(yaw)·local with local +x → (cos, −sin), local +z → (sin, cos);
    // so local = R(−yaw)·world: lx = wx·cos − wz·sin, lz = wx·sin + wz·cos
    const dir: Pt = [wx * cos - wz * sin, wx * sin + wz * cos]
    const a = site.points[i] as Pt
    const b = site.points[(i + 1) % n] as Pt
    const mw: Pt = [(a[0] + b[0]) / 2 - (pos[0] ?? 0), (a[1] + b[1]) / 2 - (pos[2] ?? 0)]
    const ml: Pt = [mw[0] * cos - mw[1] * sin, mw[0] * sin + mw[1] * cos]
    const edgeProj = ml[0] * dir[0] + ml[1] * dir[1]
    let maxWall = Number.NEGATIVE_INFINITY
    for (const w of straight) {
      for (const p of [w.start, w.end]) maxWall = Math.max(maxWall, p[0] * dir[0] + p[1] * dir[1])
    }
    // the whole ring in the level frame — the service engines put the
    // utility pole / pad transformer at its street corner
    const lot = site.points.map((p): Pt => {
      const wx = p[0] - (pos[0] ?? 0)
      const wz = p[1] - (pos[2] ?? 0)
      return [wx * cos - wz * sin, wx * sin + wz * cos]
    })
    return { dir, setbackM: Math.max(0.5, edgeProj - maxWall), source: 'site', lot, frontEdge: i }
  }
  // the entry: the exterior wall with the widest exterior door
  let entry: { wall: WallSlice; width: number } | null = null
  for (const w of straight) {
    if (!w.exterior) continue
    for (const o of w.openings) {
      if (o.kind !== 'door') continue
      if (!entry || o.roughWidth > entry.width) entry = { wall: w, width: o.roughWidth }
    }
  }
  if (entry) {
    return { dir: outwardNormal(entry.wall, rooms, straight), setbackM: 6, source: 'entry-door' }
  }
  return { dir: [0, -1], setbackM: 6, source: 'plan-up' }
}
