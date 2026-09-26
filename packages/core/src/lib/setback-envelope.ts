/**
 * The BUILDABLE ENVELOPE as the zoning officer draws it: every lot line
 * pushed inward by its own required yard, measured perpendicular to that
 * line, the offsets clipped against each other where they meet. A curved
 * (radius) lot line — a cul-de-sac frontage, a rounded corner — offsets to
 * a CONCENTRIC curve, never a chord — the industry-standard setback for pie
 * shapes, radius corners and odd lots.
 *
 * Built as a distance field rather than by intersecting offset lines: a
 * point is buildable when its distance to EVERY lot line is at least that
 * line's setback. The zero contour of `min_i(dist(p, line_i) − d_i)` over
 * the lot is exactly the variable-distance inward offset — straight where
 * the lot is straight, concentric round a radius, clipped where offsets
 * cross, and rounded round a reflex notch — for convex, pie-shaped,
 * L-shaped and radius-cornered lots alike. The contour is traced by the
 * same marching squares the site plan draws terrain with, then simplified
 * so a rectangle comes back as four corners and an arc keeps its vertices.
 */

import { terrainContours } from './terrain-contours'
import { createTerrainField } from './terrain-field'

export type Pt = readonly [number, number]

const EPS = 1e-9

function pointInPolygon(points: readonly Pt[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Pt
    const b = points[j] as Pt
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-12) + a[0])
      inside = !inside
  }
  return inside
}

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const l2 = abx * abx + aby * aby
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby) / l2))
  return Math.hypot(px - (a[0] + abx * t), py - (a[1] + aby * t))
}

function signedArea(points: readonly Pt[]): number {
  let a = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

export function polygonAreaAbs(points: readonly Pt[]): number {
  return Math.abs(signedArea(points))
}

/**
 * Which edges belong to the same ARC RUN: consecutive short edges (under
 * `shortM`) turning gently (under `turnDeg` per vertex) — the county
 * fabric's way of drawing a radius. A long edge is its own run. Returns
 * the run id per edge.
 */
export function arcRuns(points: readonly Pt[], shortM = 4, turnDeg = 35): number[] {
  const n = points.length
  const dirs = points.map((p, i) => {
    const q = points[(i + 1) % n] as Pt
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy) || 1
    return { dx: dx / len, dy: dy / len, len }
  })
  const turn = Math.cos((turnDeg * Math.PI) / 180)
  const run: number[] = new Array(n).fill(-1)
  let runs = 0
  // start the sweep at a long edge when there is one, so a run never wraps across the sweep's seam
  const start = dirs.findIndex((d) => d.len >= shortM)
  const order = Array.from({ length: n }, (_, k) => ((start < 0 ? 0 : start) + k) % n)
  for (const i of order) {
    if (run[i] !== -1) continue
    const a = dirs[i] as (typeof dirs)[number]
    if (a.len >= shortM) {
      run[i] = runs++
      continue
    }
    const members = [i]
    let j = (i + 1) % n
    let cur = a
    while (j !== i && run[j] === -1) {
      const b = dirs[j] as (typeof dirs)[number]
      if (b.len >= shortM || cur.dx * b.dx + cur.dy * b.dy < turn) break
      members.push(j)
      cur = b
      j = (j + 1) % n
    }
    for (const m of members) run[m] = runs
    runs += 1
  }
  return run
}

/** Douglas–Peucker on an open polyline. */
function simplifyOpen(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts
  const a = pts[0] as Pt
  const b = pts[pts.length - 1] as Pt
  let worst = 0
  let worstAt = -1
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i] as Pt
    const d = segDist(p[0], p[1], a, b)
    if (d > worst) {
      worst = d
      worstAt = i
    }
  }
  if (worst <= tol || worstAt < 0) return [a, b]
  const left = simplifyOpen(pts.slice(0, worstAt + 1), tol)
  const right = simplifyOpen(pts.slice(worstAt), tol)
  return [...left.slice(0, -1), ...right]
}

/** Douglas–Peucker on a closed loop: split at the two farthest-apart vertices. */
function simplifyLoop(loop: Pt[], tol: number): Pt[] {
  if (loop.length < 4) return loop
  let i0 = 0
  let i1 = 0
  let best = -1
  for (let i = 0; i < loop.length; i++) {
    for (let j = i + 1; j < loop.length; j++) {
      const d = Math.hypot(
        (loop[i] as Pt)[0] - (loop[j] as Pt)[0],
        (loop[i] as Pt)[1] - (loop[j] as Pt)[1],
      )
      if (d > best) {
        best = d
        i0 = i
        i1 = j
      }
    }
  }
  const a = [...loop.slice(i0, i1 + 1)]
  const b = [...loop.slice(i1), ...loop.slice(0, i0 + 1)]
  const sa = simplifyOpen(a, tol)
  const sb = simplifyOpen(b, tol)
  return [...sa.slice(0, -1), ...sb.slice(0, -1)]
}

/**
 * Marching squares cuts a sharp convex corner with a one-cell chamfer;
 * where a short edge sits between two long ones, put the corner back at the
 * long edges' intersection when that point is where the chamfer was.
 */
function sharpen(loop: Pt[], maxChamfer: number): Pt[] {
  const n = loop.length
  if (n < 4) return loop
  const out: Pt[] = []
  const skip = new Set<number>()
  for (let i = 0; i < n; i++) {
    if (skip.has(i)) continue
    const p = loop[i] as Pt
    const q = loop[(i + 1) % n] as Pt
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (len > maxChamfer) {
      out.push(p)
      continue
    }
    const o = loop[(i - 1 + n) % n] as Pt
    const r = loop[(i + 2) % n] as Pt
    const d1x = p[0] - o[0]
    const d1y = p[1] - o[1]
    const d2x = r[0] - q[0]
    const d2y = r[1] - q[1]
    const denom = d1x * d2y - d1y * d2x
    if (Math.abs(denom) < EPS) {
      out.push(p)
      continue
    }
    const t = ((q[0] - o[0]) * d2y - (q[1] - o[1]) * d2x) / denom
    const cx = o[0] + d1x * t
    const cy = o[1] + d1y * t
    if (Math.hypot(cx - p[0], cy - p[1]) > 1.5 * maxChamfer) {
      out.push(p)
      continue
    }
    out.push([cx, cy])
    skip.add((i + 1) % n)
  }
  return out
}

/**
 * A convex lot with no radius runs is offset EXACTLY: each edge's offset
 * line intersected with its neighbours'. Null when the lot is not that
 * simple, or when the result folds (an edge shorter than its neighbours'
 * offsets) — the field then does the clipping.
 */
function analyticInset(points: readonly Pt[], ds: readonly number[]): Pt[] | null {
  const n = points.length
  const runs = arcRuns(points)
  if (new Set(runs).size !== n) return null
  const area = signedArea(points)
  const sign = area > 0 ? -1 : 1
  let turn = 0
  const lines: { ax: number; ay: number; dx: number; dy: number }[] = []
  for (let i = 0; i < n; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    const r = points[(i + 2) % n] as Pt
    const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])
    if (turn === 0) turn = Math.sign(cross)
    else if (Math.sign(cross) !== 0 && Math.sign(cross) !== turn) return null // concave
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy)
    if (len < EPS) return null
    const nx = (sign * -dy) / len
    const ny = (sign * dx) / len
    const d = ds[i] as number
    lines.push({ ax: p[0] - nx * d, ay: p[1] - ny * d, dx: dx / len, dy: dy / len })
  }
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n] as (typeof lines)[number]
    const cur = lines[i] as (typeof lines)[number]
    const denom = prev.dx * cur.dy - prev.dy * cur.dx
    if (Math.abs(denom) < 1e-9) {
      out.push([cur.ax, cur.ay])
      continue
    }
    const t = ((cur.ax - prev.ax) * cur.dy - (cur.ay - prev.ay) * cur.dx) / denom
    out.push([prev.ax + prev.dx * t, prev.ay + prev.dy * t])
  }
  // folded: an edge reversed, the ring flipped, or a corner outside the lot
  for (let i = 0; i < n; i++) {
    const p = out[i] as Pt
    const q = out[(i + 1) % n] as Pt
    const l = lines[i] as (typeof lines)[number]
    if ((q[0] - p[0]) * l.dx + (q[1] - p[1]) * l.dy < -1e-9) return null
    if (
      !pointInPolygon(points, p[0], p[1]) &&
      (ds[i] as number) > 0 &&
      (ds[(i - 1 + n) % n] as number) > 0
    )
      return null
  }
  if (polygonAreaAbs(out) < 1e-9) return null
  if (signedArea(out) > 0 !== area > 0) return null
  if (polygonAreaAbs(out) >= polygonAreaAbs(points)) return null
  return out
}

/**
 * The polygon `points` offset INWARD by `distances[i]` along edge i (edge i
 * runs from points[i] to points[i + 1]). Empty when nothing buildable
 * remains. The result starts near the lot's first vertex and winds the
 * lot's way.
 */
/** A half-plane the envelope may not enter: the line a→b, `inside` a point on the forbidden side (a sight triangle's hypotenuse, the corner inside). */
export type KeepOut = { a: Pt; b: Pt; inside: Pt }

export function insetPolygon(
  points: readonly Pt[],
  distances: readonly number[],
  options: { resolution?: number; simplifyM?: number; keepOut?: readonly KeepOut[] } = {},
): Pt[] {
  const n = points.length
  if (n < 3 || distances.length !== n) return []
  if (!distances.some((d) => Number.isFinite(d) && d > 0)) return []
  const ds = distances.map((d) => (Number.isFinite(d) && d > 0 ? d : 0))
  const keepOut = (options.keepOut ?? []).map((k) => {
    const dx = k.b[0] - k.a[0]
    const dy = k.b[1] - k.a[1]
    const len = Math.hypot(dx, dy) || 1
    let nx = -dy / len
    let ny = dx / len
    // the normal points AWAY from the forbidden side
    if ((k.inside[0] - k.a[0]) * nx + (k.inside[1] - k.a[1]) * ny > 0) {
      nx = -nx
      ny = -ny
    }
    return { ax: k.a[0], ay: k.a[1], nx, ny }
  })
  const exact = keepOut.length === 0 ? analyticInset(points, ds) : null
  if (exact) return exact
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    minX = Math.min(minX, p[0])
    maxX = Math.max(maxX, p[0])
    minY = Math.min(minY, p[1])
    maxY = Math.max(maxY, p[1])
  }
  const diag = Math.hypot(maxX - minX, maxY - minY)
  if (!(diag > 0)) return []
  const h = options.resolution ?? Math.max(0.08, Math.min(0.4, diag / 320))
  const cols = Math.ceil((maxX - minX) / h) + 4
  const rows = Math.ceil((maxY - minY) / h) + 4
  if (cols * rows > 4_000_000) return []
  const origin: [number, number] = [minX - 2 * h, minY - 2 * h]
  const step = 0.001
  const base = createTerrainField({ origin, spacing: h, cols, rows, step })
  const heights = new Int16Array(base.heights)
  const CAP = 20
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = origin[0] + col * h
      const y = origin[1] + row * h
      let f: number
      if (!pointInPolygon(points, x, y)) {
        // outside: the signed distance continues through the lot line, so a
        // zero-setback edge's contour lands exactly on the line
        f = Number.POSITIVE_INFINITY
        for (let i = 0; i < n; i++)
          f = Math.min(f, segDist(x, y, points[i] as Pt, points[(i + 1) % n] as Pt))
        f = -Math.max(f, 1e-4)
      } else {
        f = Number.POSITIVE_INFINITY
        for (let i = 0; i < n; i++) {
          const v = segDist(x, y, points[i] as Pt, points[(i + 1) % n] as Pt) - (ds[i] as number)
          if (v < f) f = v
        }
        for (const k of keepOut) {
          const v = (x - k.ax) * k.nx + (y - k.ay) * k.ny
          if (v < f) f = v
        }
      }
      f = Math.max(-CAP, Math.min(CAP, f))
      heights[row * cols + col] = Math.round(f / step)
    }
  }
  const field = { ...base, heights }
  // one level only: zero (the interval is past every value in the field)
  const contours = terrainContours(field, CAP + 1, points)
  let best: Pt[] | null = null
  let bestArea = 0
  for (const c of contours) {
    if (c.points.length < 3) continue
    const loop = c.points as Pt[]
    const a = polygonAreaAbs(loop)
    if (a > bestArea) {
      bestArea = a
      best = loop
    }
  }
  if (!best || bestArea < 1e-3) return []
  // drop a duplicated closing vertex
  const first = best[0] as Pt
  const last = best[best.length - 1] as Pt
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) best = best.slice(0, -1)
  let loop = simplifyLoop(best, options.simplifyM ?? 0.03)
  loop = sharpen(loop, 1.6 * h)
  if (loop.length < 3) return []
  // the lot's winding, starting near the lot's first vertex
  if (signedArea(loop) > 0 !== signedArea(points) > 0) loop = [...loop].reverse()
  const p0 = points[0] as Pt
  let startAt = 0
  let startD = Number.POSITIVE_INFINITY
  loop.forEach((p, i) => {
    const d = Math.hypot(p[0] - p0[0], p[1] - p0[1])
    if (d < startD) {
      startD = d
      startAt = i
    }
  })
  loop = [...loop.slice(startAt), ...loop.slice(0, startAt)]
  return loop.map((p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4] as Pt)
}

/**
 * Which envelope edge is the one behind the lot's front line: the longest
 * envelope edge running parallel to it (within 25°) with its midpoint
 * nearest that line; failing that, the envelope edge whose midpoint is
 * nearest the lot front's midpoint (a pie lot's curved frontage has no
 * single parallel — its longest arc chord fronts the house).
 */
export function envelopeFrontEdge(
  lot: readonly Pt[],
  frontIndex: number,
  envelope: readonly Pt[],
): number {
  const n = lot.length
  const m = envelope.length
  if (n < 2 || m < 2) return 0
  const fi = ((frontIndex % n) + n) % n
  const a = lot[fi] as Pt
  const b = lot[(fi + 1) % n] as Pt
  const fx = b[0] - a[0]
  const fy = b[1] - a[1]
  const fl = Math.hypot(fx, fy) || 1
  const ux = fx / fl
  const uy = fy / fl
  const fmid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  let bestI = -1
  let bestScore = Number.NEGATIVE_INFINITY
  for (let i = 0; i < m; i++) {
    const p = envelope[i] as Pt
    const q = envelope[(i + 1) % m] as Pt
    const ex = q[0] - p[0]
    const ey = q[1] - p[1]
    const el = Math.hypot(ex, ey)
    if (el < 1e-6) continue
    const par = Math.abs((ex * ux + ey * uy) / el)
    if (par < Math.cos((25 * Math.PI) / 180)) continue
    const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const dist = segDist(mid[0], mid[1], a, b)
    // long and close wins: the front's offset is one lot-front length away by the setback
    const score = el - 2 * dist
    if (score > bestScore) {
      bestScore = score
      bestI = i
    }
  }
  if (bestI >= 0) return bestI
  let nearest = 0
  let nd = Number.POSITIVE_INFINITY
  for (let i = 0; i < m; i++) {
    const p = envelope[i] as Pt
    const q = envelope[(i + 1) % m] as Pt
    const d = Math.hypot((p[0] + q[0]) / 2 - fmid[0], (p[1] + q[1]) / 2 - fmid[1])
    if (d < nd) {
      nd = d
      nearest = i
    }
  }
  return nearest
}

/**
 * The CORNER SIGHT TRIANGLE at a street intersection (the clear-vision /
 * visibility triangle): from the point where the two street lines meet —
 * the right-of-way lines extended through the curb return — `legM` along
 * each, the hypotenuse joining them; nothing over the code's height (30
 * in typically) stands inside it. The leg is the ordinance's (25 ft is the
 * common residential figure; FDOT and the Greenbook size it by speed) —
 * verify locally. `edgeA` and `edgeB` are the two street edges; null when
 * their lines are parallel or the corner lies far from both.
 */
export function sightTriangle(
  points: readonly Pt[],
  edgeA: number,
  edgeB: number,
  legM: number,
): { corner: Pt; a: Pt; b: Pt } | null {
  const n = points.length
  const line = (i: number) => {
    const p = points[((i % n) + n) % n] as Pt
    const q = points[(((i + 1) % n) + n) % n] as Pt
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy) || 1
    return { p, q, dx: dx / len, dy: dy / len, len }
  }
  const A = line(edgeA)
  const B = line(edgeB)
  const denom = A.dx * B.dy - A.dy * B.dx
  if (Math.abs(denom) < 1e-6) return null
  const t = ((B.p[0] - A.p[0]) * B.dy - (B.p[1] - A.p[1]) * B.dx) / denom
  const corner: Pt = [A.p[0] + A.dx * t, A.p[1] + A.dy * t]
  // along each line from the corner toward that edge's far end
  const away = (L: { p: Pt; q: Pt; dx: number; dy: number }): Pt => {
    const mid: Pt = [(L.p[0] + L.q[0]) / 2, (L.p[1] + L.q[1]) / 2]
    const s = (mid[0] - corner[0]) * L.dx + (mid[1] - corner[1]) * L.dy >= 0 ? 1 : -1
    return [corner[0] + s * L.dx * legM, corner[1] + s * L.dy * legM]
  }
  const dA = segDist(corner[0], corner[1], A.p, A.q)
  const dB = segDist(corner[0], corner[1], B.p, B.q)
  if (dA > 30 || dB > 30) return null
  return { corner, a: away(A), b: away(B) }
}

/**
 * The street corners of a lot: pairs of street edges that meet at a real
 * turn (40° or more) directly or across a curb-return run of short edges.
 */
export function streetCorners(
  points: readonly Pt[],
  streetEdges: readonly number[],
): [number, number][] {
  const n = points.length
  if (n < 3 || streetEdges.length < 2) return []
  const street = new Set(streetEdges.map((i) => ((i % n) + n) % n))
  const runs = arcRuns(points)
  const dir = (i: number) => {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    return [(q[0] - p[0]) / l, (q[1] - p[1]) / l]
  }
  const out: [number, number][] = []
  for (const i of street) {
    // walk forward past a curb-return run of short edges to the next long edge
    let j = (i + 1) % n
    let steps = 0
    while (j !== i && steps < n) {
      const same = runs[j] === runs[i]
      const short =
        Math.hypot(
          (points[(j + 1) % n] as Pt)[0] - (points[j] as Pt)[0],
          (points[(j + 1) % n] as Pt)[1] - (points[j] as Pt)[1],
        ) < 4
      if (!same && !short) break
      j = (j + 1) % n
      steps += 1
    }
    if (j === i || !street.has(j)) continue
    const a = dir(i)
    const b = dir(j)
    const cosTurn = (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number)
    if (cosTurn > Math.cos((40 * Math.PI) / 180)) continue
    out.push([i, j])
  }
  return out
}
