import type { DrawingBounds, Vec2 } from './types'

export const EPS = 1e-9

export function pointInPolygon(polygon: readonly Vec2[], px: number, py: number): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (!a || !b) continue
    const intersects = a[1] > py !== b[1] > py
    if (!intersects) continue
    const x = ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]
    if (px < x) inside = !inside
  }
  return inside
}

/**
 * Parameter intervals of the segment `a → b` that lie inside `polygon`.
 * Returned as `[t0, t1]` pairs with `t` in [0, 1].
 *
 * Collects every edge crossing, sorts them, and keeps the sub-spans whose
 * midpoint is inside — robust against vertex hits and collinear edges in a way
 * that pairing crossings blindly is not (mitred wall footprints hand us both).
 */
export function segmentInsidePolygon(
  polygon: readonly Vec2[],
  a: Vec2,
  b: Vec2,
): Array<[number, number]> {
  if (polygon.length < 3) return []
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const ts = new Set<number>([0, 1])
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const p = polygon[j]
    const q = polygon[i]
    if (!p || !q) continue
    const ex = q[0] - p[0]
    const ey = q[1] - p[1]
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) < EPS) continue
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / denom
    const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / denom
    if (t > -EPS && t < 1 + EPS && u > -EPS && u < 1 + EPS) {
      ts.add(Math.min(1, Math.max(0, t)))
    }
  }
  const sorted = [...ts].sort((m, n) => m - n)
  const spans: Array<[number, number]> = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i]!
    const t1 = sorted[i + 1]!
    if (t1 - t0 < 1e-7) continue
    const mid = (t0 + t1) / 2
    if (!pointInPolygon(polygon, a[0] + dx * mid, a[1] + dy * mid)) continue
    const last = spans[spans.length - 1]
    if (last && Math.abs(last[1] - t0) < 1e-7) last[1] = t1
    else spans.push([t0, t1])
  }
  return spans
}

/**
 * Three.js Y-rotation applied to a plan point. `rotation.y = θ` maps
 * (x, z) → (x cosθ + z sinθ, −x sinθ + z cosθ). This is the same mapping the
 * roof floor-plan builder reproduces as "standard rotation by −θ"
 * (packages/nodes/src/roof-segment/floorplan.ts).
 */
export function rotateY(x: number, z: number, theta: number): Vec2 {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [x * c + z * s, -x * s + z * c]
}

/** Inverse of {@link rotateY}. */
export function unrotateY(x: number, z: number, theta: number): Vec2 {
  return rotateY(x, z, -theta)
}

export function boundsOf(points: Iterable<Vec2>): DrawingBounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let any = false
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    any = true
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return any ? { minX, minY, maxX, maxY } : null
}

export function padBounds(bounds: DrawingBounds, pad: number): DrawingBounds {
  return {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
  }
}
