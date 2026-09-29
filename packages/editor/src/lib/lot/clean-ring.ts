/**
 * Lot ring cleanup — a GIS parcel ring as the registry draws it, made fit
 * for planning geometry (setbacks, the street edge, yard dimensions).
 *
 * What comes back from a parcel layer (seen live on the Land Park preset,
 * 2026-09-06): the closing vertex repeated, points dropped along straight
 * lines, and a curb-return CORNER drawn as nine ~1 m segments turning
 * 8–12° each. Left alone, that ring breaks everything downstream: the
 * street-facing "edge" the road detector picks is a 1 m sliver of the arc,
 * the sliver takes the 20 ft front setback while the real 30 ft frontage
 * beside it takes 5 ft, the offset lines cross and the setback envelope
 * collapses to nothing — and the house lands at the origin, unplaced.
 *
 * Three passes, each pure and tested:
 *   1. duplicates — consecutive vertices closer than `DUPLICATE_M` merge,
 *      the closing repeat goes;
 *   2. collinear — a vertex whose turn is under `COLLINEAR_DEG` goes;
 *   3. arcs — a run of short edges (each ≤ `ARC_EDGE_MAX_M`, the run ≤
 *      `ARC_RUN_MAX_M` long) between two longer edges that meet at
 *      ≥ `ARC_MIN_TURN_DEG` is a rounded or chamfered corner: its vertices
 *      are replaced by the corner the two long edges make when extended. A
 *      surveyed plat calls that point the lot corner; the envelope drawn
 *      from the squared edges sits inside the curved line by far more than
 *      the rounding took away, so it is the conservative reading for
 *      setbacks. The recorded lot area is never recomputed from it.
 *
 * Returns the cleaned ring with a count of what each pass removed, so the
 * caller can say so in the parcel notes.
 */
import type { Pt } from '../floorplan/site-plan/geometry'

export const DUPLICATE_M = 0.05
export const COLLINEAR_DEG = 1.5
/** A 10 ft corner cut (3.05 m) is a chamfer; a 15 ft one is a real side. */
export const ARC_EDGE_MAX_M = 3.5
export const ARC_RUN_MAX_M = 12
export const ARC_MIN_TURN_DEG = 20

export interface CleanRingResult {
  points: Pt[]
  removed: { duplicates: number; collinear: number; arcVertices: number; arcs: number }
}

const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1])

const turnDeg = (a: Pt, b: Pt, c: Pt): number => {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const vx = c[0] - b[0]
  const vy = c[1] - b[1]
  const lu = Math.hypot(ux, uy)
  const lv = Math.hypot(vx, vy)
  if (lu < 1e-12 || lv < 1e-12) return 0
  return (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI
}

/** Angle between two edge directions, degrees, unsigned. */
const angleBetweenDeg = (a0: Pt, a1: Pt, b0: Pt, b1: Pt): number => {
  const ux = a1[0] - a0[0]
  const uy = a1[1] - a0[1]
  const vx = b1[0] - b0[0]
  const vy = b1[1] - b0[1]
  return Math.abs((Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI)
}

/** Pass 1: consecutive near-duplicates (and the closing repeat) merge. */
export function dropDuplicateVertices(points: readonly Pt[], tol = DUPLICATE_M): Pt[] {
  const out: Pt[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && dist(last, p) < tol) continue
    out.push([p[0], p[1]])
  }
  while (out.length > 1 && dist(out[0] as Pt, out[out.length - 1] as Pt) < tol) out.pop()
  return out
}

/** Pass 2: vertices that do not turn go. */
export function mergeCollinearVertices(points: readonly Pt[], tolDeg = COLLINEAR_DEG): Pt[] {
  let ring = points.map((p) => [p[0], p[1]] as Pt)
  let changed = true
  while (changed && ring.length > 3) {
    changed = false
    for (let i = 0; i < ring.length && ring.length > 3; i++) {
      const n = ring.length
      const a = ring[(i - 1 + n) % n] as Pt
      const b = ring[i] as Pt
      const c = ring[(i + 1) % n] as Pt
      if (Math.abs(turnDeg(a, b, c)) < tolDeg) {
        ring = ring.filter((_, k) => k !== i)
        changed = true
        i--
      }
    }
  }
  return ring
}

/** Intersection of the lines a0→a1 and b0→b1, or null when parallel. */
function lineIntersection(a0: Pt, a1: Pt, b0: Pt, b1: Pt): Pt | null {
  const dx1 = a1[0] - a0[0]
  const dy1 = a1[1] - a0[1]
  const dx2 = b1[0] - b0[0]
  const dy2 = b1[1] - b0[1]
  const denom = dx1 * dy2 - dy1 * dx2
  if (Math.abs(denom) < 1e-9) return null
  const t = ((b0[0] - a0[0]) * dy2 - (b0[1] - a0[1]) * dx2) / denom
  return [a0[0] + dx1 * t, a0[1] + dy1 * t]
}

/**
 * Pass 3: rounded / chamfered corners squared. A run is a maximal set of
 * consecutive SHORT edges between two LONG edges; every vertex of the run
 * (the point where the long edge before it ends, through the point where
 * the long edge after it starts) is replaced by the long edges'
 * intersection when the run is short, the long edges meet at a real angle,
 * and the corner point lands near the run.
 */
export function squareCornerArcs(
  points: readonly Pt[],
  opts: { edgeMax?: number; runMax?: number; minTurnDeg?: number } = {},
): { points: Pt[]; arcs: number; arcVertices: number } {
  const edgeMax = opts.edgeMax ?? ARC_EDGE_MAX_M
  const runMax = opts.runMax ?? ARC_RUN_MAX_M
  const minTurn = opts.minTurnDeg ?? ARC_MIN_TURN_DEG
  const ring = points.map((p) => [p[0], p[1]] as Pt)
  const n = ring.length
  const none = { points: ring, arcs: 0, arcVertices: 0 }
  if (n < 4) return none

  const at = (i: number) => ring[((i % n) + n) % n] as Pt
  const short: boolean[] = []
  for (let i = 0; i < n; i++) short.push(dist(at(i), at(i + 1)) <= edgeMax)
  const start = short.indexOf(false)
  if (start < 0) return none // every edge short: not a lot we can square

  // Runs of short edges, as [first edge, last edge] in ring order.
  const runs: [number, number][] = []
  let k = 1
  while (k <= n) {
    const idx = (start + k) % n
    if (!short[idx]) {
      k++
      continue
    }
    const first = idx
    let last = idx
    while (short[(last + 1) % n] && (last + 1) % n !== start) last = (last + 1) % n
    runs.push([first, last])
    k += ((last - first + n) % n) + 1
  }

  // Which vertices each qualifying run replaces, and with what.
  const replaced = new Map<number, Pt | null>() // vertex → corner (first vertex) or null (dropped)
  let arcs = 0
  let arcVertices = 0
  for (const [first, last] of runs) {
    const before = (first - 1 + n) % n // long edge before the run
    const after = (last + 1) % n // long edge after the run
    if (short[before] || short[after]) continue
    let runLen = 0
    for (let e = first; ; e = (e + 1) % n) {
      runLen += dist(at(e), at(e + 1))
      if (e === last) break
    }
    if (runLen > runMax) continue
    if (angleBetweenDeg(at(before), at(before + 1), at(after), at(after + 1)) < minTurn) continue
    const corner = lineIntersection(at(before), at(before + 1), at(after), at(after + 1))
    if (!corner) continue
    if (dist(corner, at(first)) > runMax || dist(corner, at(after)) > runMax) continue
    // vertices first .. after (inclusive) → the corner
    const count = ((after - first + n) % n) + 1
    for (let j = 0; j < count; j++) replaced.set((first + j) % n, j === 0 ? corner : null)
    arcs++
    arcVertices += count - 1
  }
  if (arcs === 0) return none

  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    if (!replaced.has(i)) {
      out.push(at(i))
      continue
    }
    const corner = replaced.get(i)
    if (corner) out.push(corner)
  }
  return { points: out, arcs, arcVertices }
}

/** All three passes. */
export function cleanLotRing(points: readonly Pt[]): CleanRingResult {
  const deduped = dropDuplicateVertices(points)
  const duplicates = points.length - deduped.length
  const merged = mergeCollinearVertices(deduped)
  const squared = squareCornerArcs(merged)
  const final = mergeCollinearVertices(squared.points)
  const collinear = deduped.length - merged.length + (squared.points.length - final.length)
  return {
    points: final,
    removed: { duplicates, collinear, arcVertices: squared.arcVertices, arcs: squared.arcs },
  }
}

/** One sentence for the parcel notes, or '' when nothing was removed. */
export function describeRingCleanup(before: number, result: CleanRingResult): string {
  const r = result.removed
  if (before === result.points.length) return ''
  const parts = [
    r.arcs > 0
      ? `${r.arcs} rounded corner${r.arcs === 1 ? '' : 's'} squared (${r.arcVertices} arc vertices)`
      : '',
    r.collinear > 0 ? `${r.collinear} collinear point${r.collinear === 1 ? '' : 's'} merged` : '',
    r.duplicates > 0 ? `${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'} dropped` : '',
  ].filter(Boolean)
  return `Lot ring simplified for planning: ${before} → ${result.points.length} vertices (${parts.join(', ')}); setbacks and the street edge use the simplified ring, the recorded lot area stands.`
}
