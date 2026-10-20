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
 * envelope edge facing the same way (within 25°) with its midpoint nearest
 * that line. Facing, not only parallel: on a lot that widens away from its
 * street the rear edge is parallel too, and longer. Null when no edge faces
 * the street: side setbacks wider than a narrow frontage take the whole
 * front, and a side is no front.
 */
export function envelopeFrontEdge(
  lot: readonly Pt[],
  frontIndex: number,
  envelope: readonly Pt[],
): number | null {
  const n = lot.length
  const m = envelope.length
  if (n < 2 || m < 2) return null
  const fi = ((frontIndex % n) + n) % n
  const a = lot[fi] as Pt
  const b = lot[(fi + 1) % n] as Pt
  const [fnx, fny] = outwardNormal(lot, fi)
  let best: number | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (let i = 0; i < m; i++) {
    const p = envelope[i] as Pt
    const q = envelope[(i + 1) % m] as Pt
    const el = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (el < 1e-6) continue
    const [enx, eny] = outwardNormal(envelope, i)
    if (enx * fnx + eny * fny < Math.cos((25 * Math.PI) / 180)) continue
    const dist = segDist((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, a, b)
    // long and close wins: the front's offset is one lot-front length away by the setback
    const score = el - 2 * dist
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
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

/* ---------------------------------------------- lot edges and setbacks */

export interface SetbackInputs {
  front: number
  side: number
  rear: number
  left?: number
  right?: number
  /** A corner lot's second street side; absent = the front setback. */
  streetSide?: number
}

/** Per-edge classification of a lot polygon relative to its front edge. */
export type EdgeRole = 'front' | 'rear' | 'left' | 'right' | 'street'

/** Unit normal of edge `i` pointing OUT of the polygon, winding-agnostic. */
export function outwardNormal(points: readonly Pt[], i: number): Pt {
  const n = points.length
  const p = points[i % n] as Pt
  const q = points[(i + 1) % n] as Pt
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const len = Math.hypot(dx, dy) || 1
  // Left normal of the edge direction. For a CCW ring (positive shoelace in
  // this frame) the left normal points inward, so flip.
  const sign = signedArea(points) > 0 ? -1 : 1
  return [(sign * -dy) / len, (sign * dx) / len]
}

/**
 * Compass heading of edge `i`'s outward normal, in DEGREES clockwise from
 * north, where `northRotation` (radians, clockwise) is true north's offset
 * from plan up (−y). This is the direction the edge faces.
 */
export function edgeHeadingDeg(points: readonly Pt[], i: number, northRotation = 0): number {
  const [nx, ny] = outwardNormal(points, i)
  // Plan up (−y) is 0°, +x (east) is 90°.
  const raw = Math.atan2(nx, -ny) - northRotation
  const deg = (raw * 180) / Math.PI
  return ((deg % 360) + 360) % 360
}

/** Length of edge `i`, metres. */
export function edgeLength(points: readonly Pt[], i: number): number {
  const n = points.length
  const p = points[i % n] as Pt
  const q = points[(i + 1) % n] as Pt
  return Math.hypot(q[0] - p[0], q[1] - p[1])
}

/**
 * Fallback front edge: the edge whose outward normal points closest to true
 * north. Ties break toward the longer edge — the street frontage of a typical
 * lot is one of its long sides.
 */
export function mostNorthFacingEdge(points: readonly Pt[], northRotation = 0): number {
  let best = 0
  let bestScore = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i++) {
    const heading = edgeHeadingDeg(points, i, northRotation)
    const off = Math.min(heading, 360 - heading)
    // Sub-degree ties resolve on length so a chamfer corner never wins.
    const score = off - Math.min(0.5, edgeLength(points, i) / 1000)
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/** `frontEdge` if it indexes a real edge, else the most north-facing edge. */
export function resolveFrontEdge(
  points: readonly Pt[],
  frontEdge: number | undefined,
  northRotation = 0,
): number {
  if (
    typeof frontEdge === 'number' &&
    Number.isInteger(frontEdge) &&
    frontEdge >= 0 &&
    frontEdge < points.length
  ) {
    return frontEdge
  }
  return mostNorthFacingEdge(points, northRotation)
}

/**
 * Classify every edge as front / rear / left / right.
 *
 * - front = `frontIndex`.
 * - rear  = the edge whose outward normal is most anti-parallel to the front's.
 * - the rest are sides. LEFT / RIGHT are defined along the FRONT EDGE
 *   DIRECTION (`points[front] → points[front + 1]`): an edge whose midpoint
 *   projects behind the front-edge midpoint on that axis is `left`, ahead of
 *   it is `right`. Deterministic and independent of winding.
 */
export function classifyEdges(
  points: readonly Pt[],
  frontIndex: number,
  streetEdges: readonly number[] = [],
): EdgeRole[] {
  const n = points.length
  const roles: EdgeRole[] = new Array(n).fill('left')
  if (n === 0) return roles

  const front = ((frontIndex % n) + n) % n
  const fn = outwardNormal(points, front)
  // a corner lot's other street edges (the parcel fabric's frontage) are
  // 'street' — they take the street-side setback, never a side yard, and
  // the rear is never one of them
  const street = new Set(streetEdges.map((i) => ((i % n) + n) % n))
  street.delete(front)

  let rear = -1
  let rearDot = Number.POSITIVE_INFINITY
  for (let i = 0; i < n; i++) {
    if (i === front || street.has(i)) continue
    const ni = outwardNormal(points, i)
    const dot = fn[0] * ni[0] + fn[1] * ni[1]
    if (dot < rearDot) {
      rearDot = dot
      rear = i
    }
  }

  const fp = points[front] as Pt
  const fq = points[(front + 1) % n] as Pt
  const dx = fq[0] - fp[0]
  const dy = fq[1] - fp[1]
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const fmx = (fp[0] + fq[0]) / 2
  const fmy = (fp[1] + fq[1]) / 2

  for (let i = 0; i < n; i++) {
    if (i === front) {
      roles[i] = 'front'
      continue
    }
    if (street.has(i)) {
      roles[i] = 'street'
      continue
    }
    if (i === rear) {
      roles[i] = 'rear'
      continue
    }
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    const mx = (p[0] + q[0]) / 2 - fmx
    const my = (p[1] + q[1]) / 2 - fmy
    roles[i] = mx * ux + my * uy < 0 ? 'left' : 'right'
  }
  return roles
}

/** Required setback distance (metres) for each edge role. */
export function setbackForRole(setbacks: SetbackInputs, role: EdgeRole): number {
  switch (role) {
    case 'front':
      return setbacks.front
    case 'street':
      return setbacks.streetSide ?? setbacks.front
    case 'rear':
      return setbacks.rear
    case 'left':
      return setbacks.left ?? setbacks.side
    case 'right':
      return setbacks.right ?? setbacks.side
  }
}

/**
 * Buildable envelope — every lot edge pushed INWARD by its own setback
 * (`insetPolygon`): straight where the lot is straight, concentric round a
 * radius, clipped where the offsets cross. On a concave lot a reflex corner
 * can self-intersect, in which case the caller still gets a ring but it is
 * advisory, not a legal envelope.
 *
 * Returns `[]` when the polygon has fewer than 3 points, when a setback is
 * not a distance, or when nothing buildable remains (setbacks larger than
 * the lot).
 */
export function setbackEnvelope(
  points: readonly Pt[],
  setbacks: SetbackInputs,
  frontIndex: number,
  options: { streetEdges?: readonly number[]; sightTriangleM?: number } = {},
): Pt[] {
  const n = points.length
  if (n < 3) return []
  const streetEdges = options.streetEdges ?? []
  const roles = classifyEdges(points, frontIndex, streetEdges)
  // A radius drawn as a run of short edges takes ONE role. A curb return
  // is street frontage: a run carrying, or touching, a front / street edge
  // is front / street all along (otherwise the last sliver of the return
  // became a side yard, and the envelope jutted out toward the corner); a
  // run carrying the rear is rear; else
  // each sliver keeps its own side.
  const runs = arcRuns(points)
  const runRole = new Map<number, EdgeRole>()
  const streetLike = (r: EdgeRole) => r === 'front' || r === 'street'
  for (let i = 0; i < n; i++) {
    const r = roles[i] as EdgeRole
    const g = runs[i] as number
    const have = runRole.get(g)
    if (streetLike(r) || (r === 'rear' && !(have && streetLike(have)))) runRole.set(g, r)
    else if (!have) runRole.set(g, r)
  }
  for (let i = 0; i < n; i++) {
    const g = runs[i] as number
    const have = runRole.get(g) as EdgeRole
    if (streetLike(have)) continue
    const before = roles[(i - 1 + n) % n] as EdgeRole
    const after = roles[(i + 1) % n] as EdgeRole
    const members = runs.filter((x) => x === g).length
    if (members > 1) {
      if (runs[(i - 1 + n) % n] !== g && streetLike(before)) runRole.set(g, before)
      else if (runs[(i + 1) % n] !== g && streetLike(after)) runRole.set(g, after)
    }
  }
  // One lot line drawn as two: the county fabric splits a frontage at a kink of
  // a degree or two, and only one half may come back from the street lookup
  // (or the north-facing fallback). The half left out took a side yard, and
  // the front yard swung round their shared corner in a circle as deep as
  // itself. An edge running on nearly straight from a front or street edge
  // is that frontage too.
  const roleOf = (i: number) =>
    runRole.get(runs[(i + n) % n] as number) ?? (roles[(i + n) % n] as EdgeRole)
  const direction = (i: number) => {
    const p = points[(i + n) % n] as Pt
    const q = points[(i + 1 + n) % n] as Pt
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    return [(q[0] - p[0]) / l, (q[1] - p[1]) / l] as const
  }
  const straightOn = Math.cos((8 * Math.PI) / 180)
  const continued = new Map<number, EdgeRole>()
  for (let pass = 0; pass < n; pass++) {
    let grew = false
    for (let i = 0; i < n; i++) {
      const own = continued.get(i) ?? roleOf(i)
      if (streetLike(own)) continue
      const d = direction(i)
      for (const j of [i - 1, i + 1]) {
        const k = (j + n) % n
        const theirs = continued.get(k) ?? roleOf(k)
        const e = direction(k)
        if (streetLike(theirs) && d[0] * e[0] + d[1] * e[1] > straightOn) {
          continued.set(i, theirs)
          grew = true
          break
        }
      }
    }
    if (!grew) break
  }
  const distances: number[] = []
  for (let i = 0; i < n; i++) {
    const role = continued.get(i) ?? runRole.get(runs[i] as number) ?? (roles[i] as EdgeRole)
    const d = setbackForRole(
      setbacks,
      role === 'left' || role === 'right' ? (roles[i] as EdgeRole) : role,
    )
    if (!Number.isFinite(d) || d < 0) return []
    distances.push(d)
  }
  // the corner sight triangles keep the envelope out of the clear-vision
  // zone at each street intersection (the hypotenuse is a half-plane)
  const keepOut: KeepOut[] = []
  if (options.sightTriangleM && options.sightTriangleM > 0) {
    for (const [a, b] of streetCorners(points, [frontIndex, ...streetEdges])) {
      const tri = sightTriangle(points, a, b, options.sightTriangleM)
      if (tri) keepOut.push({ a: tri.a, b: tri.b, inside: tri.corner })
    }
  }
  return insetPolygon(points, distances, { keepOut })
}

/* ------------------------------------------------------------- yards */

/**
 * Distance from `origin` along unit direction `(dx, dy)` to the first crossing
 * of the polygon boundary. `null` when the ray never hits (origin outside, or
 * a degenerate ring).
 */
export function rayToPolygon(
  points: readonly Pt[],
  origin: Pt,
  dx: number,
  dy: number,
): { distance: number; point: Pt } | null {
  const n = points.length
  let best: { distance: number; point: Pt } | null = null
  for (let i = 0; i < n; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    const ex = q[0] - p[0]
    const ey = q[1] - p[1]
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) < 1e-12) continue
    // origin + t*d = p + u*e
    const t = ((p[0] - origin[0]) * ey - (p[1] - origin[1]) * ex) / denom
    const u = ((p[0] - origin[0]) * dy - (p[1] - origin[1]) * dx) / denom
    if (t <= 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue
    if (!best || t < best.distance) {
      best = { distance: t, point: [origin[0] + dx * t, origin[1] + dy * t] }
    }
  }
  return best
}

/** Yard sides in the order the site-plan dimensions are cast. */
export type YardSide = 'north' | 'south' | 'east' | 'west'

export interface YardDimension {
  side: YardSide
  /** Bounding-box edge midpoint the dimension starts at. */
  from: Pt
  /** Where the cast ray meets the lot line. */
  to: Pt
  /** Metres. */
  distance: number
}

/**
 * Yard dimensions for a building TURNED on its lot. The footprint's bounds
 * are taken in the building's own frame (`yaw`, the building node's Y
 * rotation), and the four edge midpoints cast square to the house's faces
 * out to the lot line — the yards a plan checker measures. With a house
 * square to a diagonal lot the axis-aligned bbox sticks out past the real
 * corners and reads a front yard inches short of the setback it actually
 * meets (Land Park, 2026-09-06). `side` is the compass direction nearest the
 * cast, so labels keep reading N / S / E / W. Sides whose ray misses the lot
 * line (footprint outside the lot) are omitted rather than faked.
 */
export function castYardDimensionsOriented(
  lot: readonly Pt[],
  footprintLoops: readonly (readonly Pt[])[],
  yaw: number,
): YardDimension[] {
  if (lot.length < 3) return []
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  // world = (c·lx + s·lz, −s·lx + c·lz)  ⇒  local = (c·wx − s·wz, s·wx + c·wz)
  const toLocal = (p: Pt): Pt => [c * p[0] - s * p[1], s * p[0] + c * p[1]]
  const toWorld = (p: Pt): Pt => [c * p[0] + s * p[1], -s * p[0] + c * p[1]]
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const loop of footprintLoops) {
    for (const p of loop) {
      const [x, z] = toLocal(p)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
  }
  if (!Number.isFinite(minX)) return []
  const midX = (minX + maxX) / 2
  const midZ = (minZ + maxZ) / 2
  const casts: { from: Pt; dir: Pt }[] = [
    { from: [midX, minZ], dir: [0, -1] },
    { from: [midX, maxZ], dir: [0, 1] },
    { from: [minX, midZ], dir: [-1, 0] },
    { from: [maxX, midZ], dir: [1, 0] },
  ]
  const sides: YardSide[] = ['north', 'east', 'south', 'west']
  const out: YardDimension[] = []
  for (const cast of casts) {
    const from = toWorld(cast.from)
    const [dx, dy] = toWorld(cast.dir)
    const hit = rayToPolygon(lot, from, dx, dy)
    if (!hit) continue
    // heading of the cast: plan up (−y) is north, +x east
    const heading = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    const side = sides[Math.round(heading / 90) % 4] as YardSide
    out.push({ side, from, to: hit.point, distance: hit.distance })
  }
  return out
}
