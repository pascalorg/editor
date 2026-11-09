/**
 * The ridges, hips and valleys a roof plan draws, read off the roof surface
 * itself rather than off each segment on its own.
 *
 * A planar segment (gable, hip, shed, flat) is a convex solid: over its
 * footprint its top is the lowest of its planes. Segments that overlap are
 * unioned, so the roof's top is the highest of the segments there. The lines
 * a plan draws are that surface's creases:
 *
 *   - two planes of one segment meeting where both are its top: a ridge
 *     (level) or a hip (sloped), drawn wherever no other segment rises over
 *     it, so a wing's ridge runs on past the main roof's wall line until it
 *     dives under the main roof's slope;
 *   - two segments' tops meeting: always a valley (the higher of two planes
 *     is a V), from the corner where their eaves cross up to where it meets
 *     the ridges.
 *
 * Everything is linear, so each crease is solved exactly along its line.
 */

export type PlanPoint = [number, number]

/** A plane over the plan: its height is `a·x + b·z + c`. */
export type RoofPlane = { a: number; b: number; c: number }

export type RoofCreaseSurface = {
  /** The roof node the segment belongs to: valleys between two roofs are drawn by one of them. */
  roofId: string
  /** The segment's footprint in plan: a convex polygon. */
  footprint: PlanPoint[]
  /** The segment's roof planes; its top over the footprint is the lowest of them. */
  planes: RoofPlane[]
}

export type RoofCreaseKind = 'ridge' | 'hip' | 'valley'

export type RoofCrease = {
  kind: RoofCreaseKind
  from: PlanPoint
  to: PlanPoint
  /** The roof that draws the line: the segment's own roof, or the lesser id of a valley's two. */
  roofId: string
  /** The indices of the surfaces that meet there (the same one twice for a ridge or hip). */
  between: [number, number]
}

type Interval = [number, number]

const EPS = 1e-6
/** Shorter than this, a crease is a point where planes meet, not a line. */
const MIN_CREASE = 0.01

const heightAt = (plane: RoofPlane, x: number, z: number) => plane.a * x + plane.b * z + plane.c

/** The `t` where `slope·t + offset >= 0`, as an interval (empty as `null`). */
function halfLine(slope: number, offset: number): Interval | null {
  if (Math.abs(slope) <= 1e-12) return offset >= -EPS ? [-Infinity, Infinity] : null
  const root = -offset / slope
  return slope > 0 ? [root, Infinity] : [-Infinity, root]
}

function intersect(a: Interval | null, b: Interval | null): Interval | null {
  if (!(a && b)) return null
  const lo = Math.max(a[0], b[0])
  const hi = Math.min(a[1], b[1])
  return hi > lo ? [lo, hi] : null
}

function subtract(intervals: Interval[], cut: Interval): Interval[] {
  return intervals.flatMap(([lo, hi]) => {
    if (cut[1] <= lo || cut[0] >= hi) return [[lo, hi] as Interval]
    const kept: Interval[] = []
    if (cut[0] > lo) kept.push([lo, cut[0]])
    if (cut[1] < hi) kept.push([cut[1], hi])
    return kept
  })
}

type Line = { origin: PlanPoint; dir: PlanPoint }

/** The plan line along which two planes stand at one height, or `null` when they never cross. */
function meetingLine(p: RoofPlane, q: RoofPlane): Line | null {
  const na = p.a - q.a
  const nb = p.b - q.b
  const norm2 = na * na + nb * nb
  if (norm2 <= 1e-12) return null
  const dc = p.c - q.c
  const norm = Math.sqrt(norm2)
  return {
    origin: [(-dc * na) / norm2, (-dc * nb) / norm2],
    dir: [-nb / norm, na / norm],
  }
}

/** The stretch of a line inside a convex polygon. */
function clipToPolygon(line: Line, polygon: PlanPoint[]): Interval | null {
  if (polygon.length < 3) return null
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x0, z0] = polygon[i]!
    const [x1, z1] = polygon[(i + 1) % polygon.length]!
    area += x0 * z1 - x1 * z0
  }
  const sign = area >= 0 ? 1 : -1
  let range: Interval | null = [-Infinity, Infinity]
  for (let i = 0; i < polygon.length && range; i++) {
    const [x0, z0] = polygon[i]!
    const [x1, z1] = polygon[(i + 1) % polygon.length]!
    const ex = x1 - x0
    const ez = z1 - z0
    // inside: sign · cross(edge, point − start) >= 0, linear in t
    const slope = sign * (ex * line.dir[1] - ez * line.dir[0])
    const offset = sign * (ex * (line.origin[1] - z0) - ez * (line.origin[0] - x0))
    range = intersect(range, halfLine(slope, offset + EPS))
  }
  return range
}

/** Along a line, the height of a plane as `slope·t + offset`. */
function along(plane: RoofPlane, line: Line): [number, number] {
  return [
    plane.a * line.dir[0] + plane.b * line.dir[1],
    heightAt(plane, line.origin[0], line.origin[1]),
  ]
}

/** Where `plane` is the lowest of the surface's planes, so the surface's top, along the line. */
function activeRange(surface: RoofCreaseSurface, plane: RoofPlane, line: Line): Interval | null {
  const [ps, po] = along(plane, line)
  let range: Interval | null = [-Infinity, Infinity]
  for (const other of surface.planes) {
    if (other === plane) continue
    const [os, oo] = along(other, line)
    range = intersect(range, halfLine(os - ps, oo - po + EPS))
    if (!range) return null
  }
  return range
}

/** Where `surface` stands higher than the crease (on `plane`) along the line. */
function buriedRange(surface: RoofCreaseSurface, plane: RoofPlane, line: Line): Interval | null {
  const [ps, po] = along(plane, line)
  let range = clipToPolygon(line, surface.footprint)
  for (const other of surface.planes) {
    if (!range) return null
    const [os, oo] = along(other, line)
    range = intersect(range, halfLine(os - ps, oo - po - EPS * 10))
  }
  return range
}

function pointAt(line: Line, t: number): PlanPoint {
  return [line.origin[0] + line.dir[0] * t, line.origin[1] + line.dir[1] * t]
}

/** The visible stretches of the line where plane `p` of surface `i` meets plane `q` of surface `k`. */
function visibleStretches(
  surfaces: RoofCreaseSurface[],
  i: number,
  p: RoofPlane,
  k: number,
  q: RoofPlane,
  line: Line,
): Interval[] {
  const si = surfaces[i]!
  const sk = surfaces[k]!
  let range = intersect(clipToPolygon(line, si.footprint), activeRange(si, p, line))
  if (k !== i) range = intersect(range, clipToPolygon(line, sk.footprint))
  range = intersect(range, activeRange(sk, q, line))
  if (!range) return []
  let stretches: Interval[] = [range]
  for (let m = 0; m < surfaces.length && stretches.length > 0; m++) {
    if (m === i || m === k) continue
    const buried = buriedRange(surfaces[m]!, p, line)
    if (buried) stretches = subtract(stretches, buried)
  }
  return stretches.filter(([lo, hi]) => hi - lo >= MIN_CREASE)
}

/**
 * Every ridge, hip and valley of the roof surface the planar segments make
 * together. Each crease is reported once, under the roof that draws it.
 */
export function getRoofSurfaceCreases(surfaces: RoofCreaseSurface[]): RoofCrease[] {
  const creases: RoofCrease[] = []
  for (let i = 0; i < surfaces.length; i++) {
    const si = surfaces[i]!
    // Within one segment: ridges and hips.
    for (let pi = 0; pi < si.planes.length; pi++) {
      for (let qi = pi + 1; qi < si.planes.length; qi++) {
        const p = si.planes[pi]!
        const q = si.planes[qi]!
        const line = meetingLine(p, q)
        if (!line) continue
        const level = Math.abs(along(p, line)[0]) <= 1e-6
        for (const [lo, hi] of visibleStretches(surfaces, i, p, i, q, line)) {
          creases.push({
            kind: level ? 'ridge' : 'hip',
            from: pointAt(line, lo),
            to: pointAt(line, hi),
            roofId: si.roofId,
            between: [i, i],
          })
        }
      }
    }
    // Between two segments: valleys.
    for (let k = i + 1; k < surfaces.length; k++) {
      const sk = surfaces[k]!
      for (const p of si.planes) {
        for (const q of sk.planes) {
          const line = meetingLine(p, q)
          if (!line) continue
          for (const [lo, hi] of visibleStretches(surfaces, i, p, k, q, line)) {
            creases.push({
              kind: 'valley',
              from: pointAt(line, lo),
              to: pointAt(line, hi),
              roofId: si.roofId < sk.roofId ? si.roofId : sk.roofId,
              between: [i, k],
            })
          }
        }
      }
    }
  }
  return creases
}
