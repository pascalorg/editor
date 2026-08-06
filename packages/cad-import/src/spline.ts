/**
 * B-spline / NURBS evaluation, for flattening DXF `SPLINE` entities.
 *
 * A spline is the one DXF curve that cannot be reduced to an arc, so it needs
 * real basis-function evaluation rather than the sagitta arithmetic the arcs
 * and bulges use. Everything here is 2D — the parser drops Z, like it does
 * everywhere else.
 */

export type SplinePoint = readonly [number, number]

export type SplineDefinition = {
  controlPoints: SplinePoint[]
  /** Rational weights, one per control point. Empty means uniform (a plain B-spline). */
  weights: number[]
  knots: number[]
  degree: number
  closed: boolean
}

/**
 * Index of the knot span containing `u`.
 *
 * Binary search over the knot vector, clamped at both ends so the curve's
 * first and last points evaluate exactly rather than falling off the array.
 */
function findSpan(lastControl: number, degree: number, u: number, knots: number[]): number {
  if (u >= knots[lastControl + 1]!) return lastControl
  if (u <= knots[degree]!) return degree

  let low = degree
  let high = lastControl + 1
  let mid = Math.floor((low + high) / 2)
  while (u < knots[mid]! || u >= knots[mid + 1]!) {
    if (u < knots[mid]!) high = mid
    else low = mid
    mid = Math.floor((low + high) / 2)
    if (mid <= low && mid >= high) break
  }
  return mid
}

/**
 * Point on the curve at parameter `u`, via de Boor's algorithm.
 *
 * Rational splines are evaluated in homogeneous coordinates and divided back
 * at the end, which is what makes weighted control points bend the curve
 * rather than merely move it.
 */
export function evaluateSpline(spline: SplineDefinition, u: number): SplinePoint {
  const { controlPoints, weights, knots, degree } = spline
  const lastControl = controlPoints.length - 1
  const span = findSpan(lastControl, degree, u, knots)

  const x: number[] = []
  const y: number[] = []
  const w: number[] = []
  for (let j = 0; j <= degree; j++) {
    const index = span - degree + j
    const point = controlPoints[index] ?? controlPoints[lastControl]!
    const weight = weights[index] ?? 1
    x.push(point[0] * weight)
    y.push(point[1] * weight)
    w.push(weight)
  }

  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const left = knots[j + span - degree]!
      const right = knots[j + 1 + span - r]!
      const denom = right - left
      // Repeated knots produce zero-width spans; the control point is already
      // the answer there.
      const alpha = denom === 0 ? 0 : (u - left) / denom
      x[j] = (1 - alpha) * x[j - 1]! + alpha * x[j]!
      y[j] = (1 - alpha) * y[j - 1]! + alpha * y[j]!
      w[j] = (1 - alpha) * w[j - 1]! + alpha * w[j]!
    }
  }

  const weight = w[degree]!
  if (!(Number.isFinite(weight) && weight !== 0)) {
    return controlPoints[Math.min(span, lastControl)] ?? [0, 0]
  }
  return [x[degree]! / weight, y[degree]! / weight]
}

/** A spline is usable when its knot vector matches its control points and degree. */
export function isEvaluable(spline: SplineDefinition): boolean {
  const { controlPoints, knots, degree } = spline
  if (degree < 1) return false
  if (controlPoints.length < degree + 1) return false
  if (knots.length !== controlPoints.length + degree + 1) return false
  for (let i = 1; i < knots.length; i++) {
    if (knots[i]! < knots[i - 1]!) return false
  }
  return knots[knots.length - 1]! > knots[0]!
}

/** Depth cap for the adaptive split — 2^10 samples per span is far past useful. */
const MAX_DEPTH = 10

/**
 * Flatten a spline to points, subdividing only where the curve actually bends.
 *
 * Uniform sampling would either under-resolve a tight corner or waste
 * thousands of segments on a nearly straight run — and CAD files contain both,
 * often in the same entity. Splitting on measured deviation spends points
 * where they change the result.
 */
export function flattenSpline(spline: SplineDefinition, tolerance: number): SplinePoint[] {
  if (!isEvaluable(spline)) {
    // Degenerate or malformed: the control polygon is a poor curve but a
    // truthful outline, and far better than dropping the entity.
    return spline.controlPoints.slice()
  }

  const { knots, degree, controlPoints } = spline
  const start = knots[degree]!
  const end = knots[controlPoints.length]!
  if (!(end > start)) return spline.controlPoints.slice()

  const points: SplinePoint[] = [evaluateSpline(spline, start)]

  // One seed sample per knot span, so a curve with many spans starts from a
  // reasonable approximation before refinement.
  const spans = new Set<number>([start, end])
  for (let i = degree; i <= controlPoints.length; i++) {
    const knot = knots[i]!
    if (knot > start && knot < end) spans.add(knot)
  }
  const seeds = [...spans].sort((a, b) => a - b)

  for (let i = 0; i < seeds.length - 1; i++) {
    subdivide(
      spline,
      seeds[i]!,
      seeds[i + 1]!,
      points[points.length - 1]!,
      evaluateSpline(spline, seeds[i + 1]!),
      tolerance,
      0,
      points,
    )
  }

  return points
}

function subdivide(
  spline: SplineDefinition,
  u0: number,
  u1: number,
  p0: SplinePoint,
  p1: SplinePoint,
  tolerance: number,
  depth: number,
  out: SplinePoint[],
): void {
  const um = (u0 + u1) / 2
  const pm = evaluateSpline(spline, um)

  if (depth >= MAX_DEPTH || distanceToSegment(pm, p0, p1) <= tolerance) {
    out.push(p1)
    return
  }

  subdivide(spline, u0, um, p0, pm, tolerance, depth + 1, out)
  subdivide(spline, um, u1, pm, p1, tolerance, depth + 1, out)
}

function distanceToSegment(point: SplinePoint, a: SplinePoint, b: SplinePoint): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-18) return Math.hypot(point[0] - a[0], point[1] - a[1])

  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared),
  )
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t))
}
