/**
 * Site-plan geometry — pure functions, no store, no React.
 *
 * All coordinates are SITE metres: origin = the geocoded point, x → east,
 * y → south (the plan frame the site polygon is stored in). Consumers
 * (2D editor, sheets) turn these into SVG through the existing renderer.
 */

export type Pt = readonly [number, number]

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Yard sides in the order the site-plan dimensions are cast. */
export type YardSide = 'north' | 'south' | 'east' | 'west'

export interface SetbackInputs {
  front: number
  side: number
  rear: number
  left?: number
  right?: number
}

/** Per-edge classification of a lot polygon relative to its front edge. */
export type EdgeRole = 'front' | 'rear' | 'left' | 'right'

const EPS = 1e-9

export function polygonBounds(points: readonly Pt[]): Bounds {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

export function polygonArea(points: readonly Pt[]): number {
  let a = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    a += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(a / 2)
}

export function polygonCentroid(points: readonly Pt[]): Pt {
  let cx = 0
  let cy = 0
  let a = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    const cross = p[0] * q[1] - q[0] * p[1]
    a += cross
    cx += (p[0] + q[0]) * cross
    cy += (p[1] + q[1]) * cross
  }
  if (Math.abs(a) < EPS) {
    // Degenerate ring — fall back to the vertex average.
    const n = Math.max(1, points.length)
    let sx = 0
    let sy = 0
    for (const [x, y] of points) {
      sx += x
      sy += y
    }
    return [sx / n, sy / n]
  }
  a /= 2
  return [cx / (6 * a), cy / (6 * a)]
}

/** True when the ring is wound counter-clockwise in a y-down (south-positive) frame. */
export function isCounterClockwise(points: readonly Pt[]): boolean {
  let a = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a > 0
}

/**
 * Unit normal of edge `i` pointing OUT of the polygon, winding-agnostic.
 */
export function outwardNormal(points: readonly Pt[], i: number): Pt {
  const n = points.length
  const p = points[i % n] as Pt
  const q = points[(i + 1) % n] as Pt
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const len = Math.hypot(dx, dy) || 1
  // Left normal of the edge direction. For a CCW ring (positive shoelace in
  // this frame) the left normal points inward, so flip.
  const sign = isCounterClockwise(points) ? -1 : 1
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

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

export function compassLabel(headingDeg: number): string {
  const idx = Math.round((((headingDeg % 360) + 360) % 360) / 22.5) % 16
  return COMPASS[idx] as string
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
export function classifyEdges(points: readonly Pt[], frontIndex: number): EdgeRole[] {
  const n = points.length
  const roles: EdgeRole[] = new Array(n).fill('left')
  if (n === 0) return roles

  const front = ((frontIndex % n) + n) % n
  const fn = outwardNormal(points, front)

  let rear = -1
  let rearDot = Number.POSITIVE_INFINITY
  for (let i = 0; i < n; i++) {
    if (i === front) continue
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
    case 'rear':
      return setbacks.rear
    case 'left':
      return setbacks.left ?? setbacks.side
    case 'right':
      return setbacks.right ?? setbacks.side
  }
}

/**
 * Buildable envelope — every lot edge pushed INWARD by its own setback, with
 * the new vertices taken as the intersections of adjacent offset lines
 * (variable-distance straight-skeleton-lite). Exact for convex lots; on a
 * concave lot a reflex corner can self-intersect, in which case the caller
 * still gets a ring but it is advisory, not a legal envelope.
 *
 * Returns `[]` when the polygon has fewer than 3 points, when any offset line
 * pair is parallel (no intersection), or when the result inverts (setbacks
 * larger than the lot).
 */
export function setbackEnvelope(
  points: readonly Pt[],
  setbacks: SetbackInputs,
  frontIndex: number,
): Pt[] {
  const n = points.length
  if (n < 3) return []
  const roles = classifyEdges(points, frontIndex)

  // Offset line for each edge: point `a` on the line + unit direction `d`.
  const lines: { ax: number; ay: number; dx: number; dy: number }[] = []
  for (let i = 0; i < n; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    const [nx, ny] = outwardNormal(points, i)
    const d = setbackForRole(setbacks, roles[i] as EdgeRole)
    if (!Number.isFinite(d) || d < 0) return []
    // Inward = against the outward normal.
    const ax = p[0] - nx * d
    const ay = p[1] - ny * d
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy)
    if (len < EPS) return []
    lines.push({ ax, ay, dx: dx / len, dy: dy / len })
  }

  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n] as (typeof lines)[number]
    const cur = lines[i] as (typeof lines)[number]
    const denom = prev.dx * cur.dy - prev.dy * cur.dx
    if (Math.abs(denom) < 1e-9) return []
    const t = ((cur.ax - prev.ax) * cur.dy - (cur.ay - prev.ay) * cur.dx) / denom
    out.push([prev.ax + prev.dx * t, prev.ay + prev.dy * t])
  }

  // A ring that shrank past itself flips winding or collapses — reject it
  // rather than draw a bow-tie the user might read as buildable.
  if (out.length < 3) return []
  if (polygonArea(out) < 1e-6) return []
  if (isCounterClockwise(out) !== isCounterClockwise(points)) return []
  if (polygonArea(out) >= polygonArea(points)) return []
  return out
}

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
 * The four yard dimensions: from each footprint bbox edge midpoint, straight
 * out to the lot line. Sides whose ray misses the lot line (footprint outside
 * the lot) are omitted rather than faked.
 */
export function castYardDimensions(
  lot: readonly Pt[],
  footprint: Bounds,
): YardDimension[] {
  if (lot.length < 3) return []
  const midX = (footprint.minX + footprint.maxX) / 2
  const midY = (footprint.minY + footprint.maxY) / 2
  const casts: { side: YardSide; from: Pt; dx: number; dy: number }[] = [
    { side: 'north', from: [midX, footprint.minY], dx: 0, dy: -1 },
    { side: 'south', from: [midX, footprint.maxY], dx: 0, dy: 1 },
    { side: 'west', from: [footprint.minX, midY], dx: -1, dy: 0 },
    { side: 'east', from: [footprint.maxX, midY], dx: 1, dy: 0 },
  ]
  const out: YardDimension[] = []
  for (const c of casts) {
    const hit = rayToPolygon(lot, c.from, c.dx, c.dy)
    if (!hit) continue
    out.push({ side: c.side, from: c.from, to: hit.point, distance: hit.distance })
  }
  return out
}

/** Even-odd point-in-polygon. */
export function pointInPolygon(points: readonly Pt[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Pt
    const b = points[j] as Pt
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside
    }
  }
  return inside
}

/** True when every corner of `bounds` is inside `lot`. */
export function boundsInsidePolygon(lot: readonly Pt[], bounds: Bounds): boolean {
  if (lot.length < 3) return false
  const corners: Pt[] = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ]
  return corners.every((c) => pointInPolygon(lot, c[0], c[1]))
}

export const METRES_PER_FOOT = 0.3048

/** `24'-6"` — the notation a US site plan uses for yard dimensions. */
export function formatFeetInches(metres: number): string {
  const totalInches = Math.round((metres / METRES_PER_FOOT) * 12)
  const feet = Math.floor(totalInches / 12)
  const inches = totalInches % 12
  return inches === 0 ? `${feet}'-0"` : `${feet}'-${inches}"`
}
