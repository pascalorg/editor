import type { FenceNode } from '../../schema'
import type { Point2D } from '../wall/wall-mitering'

/**
 * Pure 2D spline sampling for fences whose centerline is defined by a `path`
 * of control points (the "flying path" curved fence).
 *
 * Each control point carries an OUT-handle offset vector. When the user has
 * not adjusted it, the handle defaults to the Catmull-Rom tangent
 * `(next - prev) / 6`, which reproduces a smooth Catmull-Rom curve. When the
 * user drags a tangent handle (stored in `tangents[i]`), that point's handle
 * becomes the stored vector and the IN handle is its mirror, so the curve
 * stays smooth (C1) through the point but bends to taste. Each span is then a
 * cubic Bézier between consecutive points using their handles.
 *
 * Lives in `@pascal-app/core` and imports NO Three.js — the same `CurveFrame`
 * shape that `wall-curve.ts` returns (point / tangent / normal) is produced
 * here so the spline branch is a drop-in for the arc branch in every consumer.
 */

const EPSILON = 1e-6
const DEFAULT_SEGMENTS_PER_SPAN = 12

type FenceSplineLike = Pick<FenceNode, 'path'>
type TangentList = ReadonlyArray<readonly [number, number] | null> | undefined

export function isSplineFence(fence: FenceSplineLike): boolean {
  return Array.isArray(fence.path) && fence.path.length >= 2
}

type CurveFrame = {
  point: Point2D
  tangent: Point2D
  normal: Point2D
}

function toPoints(path: ReadonlyArray<readonly [number, number]>): Point2D[] {
  return path.map(([x, y]) => ({ x, y }))
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * OUT-handle offset vector for control point `index` — the stored tangent if
 * the user has adjusted it, otherwise the automatic Catmull-Rom tangent
 * `(next - prev) / 6` (endpoints duplicate the neighbour so the ends stay
 * tangent to their single span). The IN handle is the negation of this.
 *
 * Exported so the editing UI can draw the tangent line / handle dots at the
 * right place even before the user has dragged them.
 */
export function getFenceControlHandle(
  path: ReadonlyArray<readonly [number, number]>,
  tangents: TangentList,
  index: number,
): Point2D {
  const stored = tangents?.[index]
  if (stored) {
    return { x: stored[0], y: stored[1] }
  }
  const prev = path[index - 1] ?? path[index]!
  const next = path[index + 1] ?? path[index]!
  return {
    x: (next[0] - prev[0]) / 6,
    y: (next[1] - prev[1]) / 6,
  }
}

function cubicBezier(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, u: number): Point2D {
  const mu = 1 - u
  const a = mu * mu * mu
  const b = 3 * mu * mu * u
  const c = 3 * mu * u * u
  const d = u * u * u
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

function hasAnyTangent(tangents: TangentList): boolean {
  return Array.isArray(tangents) && tangents.some((t) => t != null)
}

/**
 * Sample the spline centerline into a polyline. Control points are honored as
 * on-curve anchors; `segmentsPerSpan` controls smoothness between them.
 * Returns `(segmentsPerSpan * spanCount) + 1` points, first == path[0],
 * last == path[-1].
 */
export function sampleFenceSpline(
  path: ReadonlyArray<readonly [number, number]>,
  tangents?: TangentList,
  segmentsPerSpan = DEFAULT_SEGMENTS_PER_SPAN,
): Point2D[] {
  const pts = toPoints(path)
  if (pts.length === 0) return []
  if (pts.length === 1) return [pts[0]!]
  // Two points with no adjusted tangents is a straight segment.
  if (pts.length === 2 && !hasAnyTangent(tangents)) return [pts[0]!, pts[1]!]

  const steps = Math.max(1, Math.floor(segmentsPerSpan))
  const result: Point2D[] = [pts[0]!]

  for (let i = 0; i < pts.length - 1; i += 1) {
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const outHandle = getFenceControlHandle(path, tangents, i)
    const nextHandle = getFenceControlHandle(path, tangents, i + 1)
    // Bézier controls: leave p1 along its OUT handle, arrive at p2 along its
    // IN handle (= negated OUT handle).
    const c1: Point2D = { x: p1.x + outHandle.x, y: p1.y + outHandle.y }
    const c2: Point2D = { x: p2.x - nextHandle.x, y: p2.y - nextHandle.y }

    for (let s = 1; s <= steps; s += 1) {
      result.push(cubicBezier(p1, c1, c2, p2, s / steps))
    }
  }

  return result
}

function frameFromPolyline(points: Point2D[], t: number): CurveFrame {
  if (points.length === 0) {
    return {
      point: { x: 0, y: 0 },
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
    }
  }
  if (points.length === 1) {
    return {
      point: points[0]!,
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
    }
  }

  const clamped = clamp01(t)
  const lastIndex = points.length - 1
  const scaled = clamped * lastIndex
  const lower = Math.min(lastIndex - 1, Math.floor(scaled))
  const upper = lower + 1
  const localU = scaled - lower

  const a = points[lower]!
  const b = points[upper]!
  const point = {
    x: a.x + (b.x - a.x) * localU,
    y: a.y + (b.y - a.y) * localU,
  }

  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  const tangent = len < EPSILON ? { x: 1, y: 0 } : { x: dx / len, y: dy / len }

  return {
    point,
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
  }
}

/**
 * Frame (point + tangent + normal) at parameter `t` in [0, 1] along the spline
 * centerline. Same return shape as `getWallCurveFrameAt` so it is a drop-in for
 * the arc branch. `t` is uniform over the sampled polyline (arc length is not
 * reparameterised — adequate for marching posts / rails and far cheaper).
 */
export function getFenceSplineFrameAt(
  path: ReadonlyArray<readonly [number, number]>,
  t: number,
  tangents?: TangentList,
  segmentsPerSpan = DEFAULT_SEGMENTS_PER_SPAN,
): CurveFrame {
  return frameFromPolyline(sampleFenceSpline(path, tangents, segmentsPerSpan), t)
}

/** Total polyline length of the sampled spline centerline. */
export function getFenceSplineLength(
  path: ReadonlyArray<readonly [number, number]>,
  tangents?: TangentList,
  segmentsPerSpan = DEFAULT_SEGMENTS_PER_SPAN,
): number {
  const points = sampleFenceSpline(path, tangents, segmentsPerSpan)
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1]!, points[i]!)
  }
  return total
}
