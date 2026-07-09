// Pure 2D geometry for the screen-rect marquee's membership test. The
// marquee intersects each node's ORIENTED bounding box projected to screen —
// a convex hull — instead of a screen-space AABB of the world AABB, whose
// double inflation (world AABB around rotated geometry, then a 2D AABB
// around its projection) selected objects visually far from the cursor.

export type ScreenRect = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type Point2 = [number, number]

function cross(o: Point2, a: Point2, b: Point2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/** Andrew monotone-chain convex hull. Returns CCW hull without the closing
 *  point; degenerate inputs (0–2 points, collinear sets) pass through. */
export function convexHull2D(points: readonly Point2[]): Point2[] {
  if (points.length <= 2) return [...points]
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const lower: Point2[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Point2[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  const hull = [...lower, ...upper]
  return hull.length > 0 ? hull : [sorted[0]!]
}

function pointInRect(p: Point2, rect: ScreenRect): boolean {
  return p[0] >= rect.minX && p[0] <= rect.maxX && p[1] >= rect.minY && p[1] <= rect.maxY
}

/** Ray-crossing point-in-polygon — works for convex and degenerate hulls. */
function pointInPolygon(p: Point2, polygon: readonly Point2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  const v = cross(a, b, c)
  if (v > 0) return 1
  if (v < 0) return -1
  return 0
}

function onSegment(a: Point2, b: Point2, p: Point2): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  )
}

function segmentsIntersect(a1: Point2, a2: Point2, b1: Point2, b2: Point2): boolean {
  const o1 = orientation(a1, a2, b1)
  const o2 = orientation(a1, a2, b2)
  const o3 = orientation(b1, b2, a1)
  const o4 = orientation(b1, b2, a2)
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(a1, a2, b1)) return true
  if (o2 === 0 && onSegment(a1, a2, b2)) return true
  if (o3 === 0 && onSegment(b1, b2, a1)) return true
  if (o4 === 0 && onSegment(b1, b2, a2)) return true
  return false
}

/** Segment vs polygon (general, possibly concave): endpoint containment or
 *  any edge crossing. */
export function segmentIntersectsPolygon(
  a: Point2,
  b: Point2,
  polygon: readonly Point2[],
): boolean {
  if (polygon.length === 0) return false
  if (polygon.length === 1) return false
  if (polygon.length >= 3 && (pointInPolygon(a, polygon) || pointInPolygon(b, polygon))) return true
  for (let i = 0; i < polygon.length; i++) {
    if (segmentsIntersect(a, b, polygon[i]!, polygon[(i + 1) % polygon.length]!)) return true
  }
  return false
}

/** Polygon vs polygon (general): containment either way or any edge crossing. */
export function polygonsIntersect(a: readonly Point2[], b: readonly Point2[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  if (a.length >= 3 && b.some((p) => pointInPolygon(p, a))) return true
  if (b.length >= 3 && a.some((p) => pointInPolygon(p, b))) return true
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!
    const a2 = a[(i + 1) % a.length]!
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a1, a2, b[j]!, b[(j + 1) % b.length]!)) return true
    }
  }
  return false
}

/**
 * Does the axis-aligned marquee rect intersect the (convex) hull polygon?
 * Covers all cases: hull vertex inside the rect, rect fully inside the hull,
 * and pure edge crossings.
 */
export function rectIntersectsHull(rect: ScreenRect, hull: readonly Point2[]): boolean {
  if (hull.length === 0) return false
  for (const p of hull) {
    if (pointInRect(p, rect)) return true
  }
  if (hull.length === 1) return false
  const rectCorners: Point2[] = [
    [rect.minX, rect.minY],
    [rect.maxX, rect.minY],
    [rect.maxX, rect.maxY],
    [rect.minX, rect.maxY],
  ]
  if (hull.length >= 3) {
    for (const c of rectCorners) {
      if (pointInPolygon(c, hull)) return true
    }
  }
  for (let i = 0; i < hull.length; i++) {
    const h1 = hull[i]!
    const h2 = hull[(i + 1) % hull.length]!
    for (let j = 0; j < 4; j++) {
      const r1 = rectCorners[j]!
      const r2 = rectCorners[(j + 1) % 4]!
      if (segmentsIntersect(h1, h2, r1, r2)) return true
    }
  }
  return false
}
