import type { CastableElement, Vec2 } from './elements'
import { elementLength } from './elements'

/**
 * Plan-footprint geometry, shared by the trim and junction rules.
 *
 * A wall is a band about its centreline and a column a small convex outline, so
 * both clip exactly against a set of half-planes. A slab is an arbitrary
 * polygon with holes and does not, so it takes a crossing-sort clip instead.
 * Both answer the same question — which stretches of this line lie inside that
 * element — because that is what decides whether a face is buried.
 */

export interface Interval {
  t0: number
  t1: number
}

const EPS = 1e-12

/** Corners of the element's plan footprint, without a repeated final point. */
export function outlineOf(element: CastableElement): Vec2[] {
  if (element.plan) return element.plan.outline
  const length = elementLength(element)
  if (length < 1e-9) {
    // A degenerate wall reads as a point, so its footprint is the square its
    // half-width inscribes — the same fallback the abutment test uses.
    const h = element.halfWidth
    return [
      { x: element.start.x - h, y: element.start.y - h },
      { x: element.start.x + h, y: element.start.y - h },
      { x: element.start.x + h, y: element.start.y + h },
      { x: element.start.x - h, y: element.start.y + h },
    ]
  }
  const ux = (element.end.x - element.start.x) / length
  const uy = (element.end.y - element.start.y) / length
  const nx = -uy * element.halfWidth
  const ny = ux * element.halfWidth
  return [
    { x: element.start.x - nx, y: element.start.y - ny },
    { x: element.end.x - nx, y: element.end.y - ny },
    { x: element.end.x + nx, y: element.end.y + ny },
    { x: element.start.x + nx, y: element.start.y + ny },
  ]
}

function holesOf(element: CastableElement): Vec2[][] {
  return element.plan?.holes ?? []
}

function signedArea(outline: Vec2[]): number {
  let twice = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Vec2
    const b = outline[(i + 1) % outline.length] as Vec2
    twice += a.x * b.y - b.x * a.y
  }
  return twice / 2
}

/**
 * Half-plane clip of a segment against a convex outline, returning the
 * surviving parameter range or null. An exact interval is what lets
 * overlapping neighbours be unioned rather than summed. A segment lying on the
 * boundary counts as inside: a face flush against a neighbour's face is buried.
 */
function clipSegmentToConvex(outline: Vec2[], from: Vec2, to: Vec2): Interval | null {
  if (outline.length < 3) return null
  // Inside is to the left of every directed edge, which holds only for CCW.
  const ccw = signedArea(outline) >= 0 ? outline : [...outline].reverse()
  const dx = to.x - from.x
  const dy = to.y - from.y
  let t0 = 0
  let t1 = 1

  for (let i = 0; i < ccw.length; i++) {
    const p = ccw[i] as Vec2
    const q = ccw[(i + 1) % ccw.length] as Vec2
    const ex = q.x - p.x
    const ey = q.y - p.y
    const a = ex * (from.y - p.y) - ey * (from.x - p.x)
    const b = ex * dy - ey * dx
    if (Math.abs(b) < EPS) {
      if (a < -EPS) return null
      continue
    }
    const bound = -a / b
    if (b > 0) t0 = Math.max(t0, bound)
    else t1 = Math.min(t1, bound)
    if (t0 >= t1) return null
  }

  return { t0, t1 }
}

function distanceToEdge(a: Vec2, b: Vec2, point: Vec2): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const lengthSq = vx * vx + vy * vy
  if (lengthSq < EPS) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / lengthSq))
  return Math.hypot(a.x + t * vx - point.x, a.y + t * vy - point.y)
}

function pointInOutline(outline: Vec2[], point: Vec2, boundaryTolerance = 0): boolean {
  if (boundaryTolerance > 0) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i] as Vec2
      const b = outline[(i + 1) % outline.length] as Vec2
      if (distanceToEdge(a, b, point) <= boundaryTolerance) return true
    }
  }
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i] as Vec2
    const b = outline[j] as Vec2
    const straddles = a.y > point.y !== b.y > point.y
    if (!straddles) continue
    const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (point.x < x) inside = !inside
  }
  return inside
}

function crossingParams(outline: Vec2[], from: Vec2, to: Vec2, out: number[]): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i] as Vec2
    const q = outline[(i + 1) % outline.length] as Vec2
    const ex = q.x - p.x
    const ey = q.y - p.y
    const denominator = dx * ey - dy * ex
    if (Math.abs(denominator) < EPS) continue
    const t = ((p.x - from.x) * ey - (p.y - from.y) * ex) / denominator
    const s = ((p.x - from.x) * dy - (p.y - from.y) * dx) / denominator
    if (t < 0 || t > 1 || s < 0 || s > 1) continue
    out.push(t)
  }
}

/**
 * Clip against an arbitrary polygon with holes. Splitting the segment at every
 * boundary crossing leaves runs that are wholly in or wholly out, so one
 * midpoint test per run classifies it — no convexity assumed.
 */
function clipSegmentToPolygon(
  outline: Vec2[],
  holes: Vec2[][],
  from: Vec2,
  to: Vec2,
  boundaryTolerance: number,
): Interval[] {
  if (outline.length < 3) return []
  const cuts = [0, 1]
  crossingParams(outline, from, to, cuts)
  for (const hole of holes) crossingParams(hole, from, to, cuts)
  const sorted = [...new Set(cuts)].sort((a, b) => a - b)

  const out: Interval[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i] as number
    const t1 = sorted[i + 1] as number
    if (t1 - t0 < EPS) continue
    const mid = (t0 + t1) / 2
    const point: Vec2 = { x: from.x + (to.x - from.x) * mid, y: from.y + (to.y - from.y) * mid }
    if (!pointInOutline(outline, point, boundaryTolerance)) continue
    if (holes.some((hole) => pointInOutline(hole, point))) continue
    const previous = out[out.length - 1]
    if (previous && t0 - previous.t1 < EPS) previous.t1 = t1
    else out.push({ t0, t1 })
  }
  return out
}

/**
 * Stretches of `from → to` that lie inside `element`'s plan footprint.
 *
 * `boundaryTolerance` widens the footprint by that distance, which is what
 * makes a *shared* boundary count: two slab bays cast side by side have
 * coincident rims and overlap in no area at all, yet the later bay's rim is
 * cast against the earlier one and needs no edge form.
 */
export function clipSegmentToElement(
  element: CastableElement,
  from: Vec2,
  to: Vec2,
  boundaryTolerance = 0,
): Interval[] {
  const outline = outlineOf(element)
  const holes = holesOf(element)
  if (element.kind === 'slab' || holes.length > 0) {
    return clipSegmentToPolygon(outline, holes, from, to, boundaryTolerance)
  }
  const clipped = clipSegmentToConvex(outline, from, to)
  return clipped ? [clipped] : []
}

export function unionLength(intervals: readonly Interval[]): number {
  if (intervals.length === 0) return 0
  const sorted = [...intervals].sort((x, y) => x.t0 - y.t0)
  let total = 0
  let cursor = -1
  for (const span of sorted) {
    const start = Math.max(span.t0, cursor)
    if (span.t1 > start) {
      total += span.t1 - start
      cursor = span.t1
    }
  }
  return total
}

/** True when the two footprints share any plan area. */
export function footprintsOverlap(a: CastableElement, b: CastableElement): boolean {
  const outlineA = outlineOf(a)
  const outlineB = outlineOf(b)
  for (let i = 0; i < outlineA.length; i++) {
    const from = outlineA[i] as Vec2
    const to = outlineA[(i + 1) % outlineA.length] as Vec2
    if (unionLength(clipSegmentToElement(b, from, to)) > 0) return true
  }
  // One footprint wholly inside the other crosses no edges, so containment has
  // to be tested separately — a column inside a wall band is exactly that case.
  return pointInOutline(outlineB, outlineA[0] as Vec2) || pointInOutline(outlineA, outlineB[0] as Vec2)
}

/** Edges of an element's footprint, in outline order. */
export function footprintEdges(element: CastableElement): Array<{ from: Vec2; to: Vec2 }> {
  const outline = outlineOf(element)
  const out: Array<{ from: Vec2; to: Vec2 }> = []
  for (let i = 0; i < outline.length; i++) {
    out.push({ from: outline[i] as Vec2, to: outline[(i + 1) % outline.length] as Vec2 })
  }
  return out
}
