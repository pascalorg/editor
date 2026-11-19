import { sampleFenceSpline } from '../systems/fence/fence-spline'

/**
 * A drawn line made smooth, shared by every noun that is planted or laid along a line or around
 * an outline (the hedge first): through the points by the fence's spline, or straight sides with
 * rounded corners; open, or closed into a ring. And a reader of a polyline by the metres
 * travelled along it. Plan points [x, z] in metres.
 */

type Point = [number, number]

const SPLINE_SEGMENTS = 10
const FILLET_SEGMENTS = 6
const SAME_POINT = 1e-4

const length2 = (x: number, z: number) => Math.sqrt(x * x + z * z)

function distinctPoints(path: readonly (readonly [number, number])[], closed: boolean): Point[] {
  const points: Point[] = []
  for (const [x, z] of path) {
    const last = points.at(-1)
    if (!last || length2(x - last[0], z - last[1]) > SAME_POINT) points.push([x, z])
  }
  const [first, last] = [points[0], points.at(-1)]
  if (
    closed &&
    points.length > 1 &&
    first &&
    last &&
    length2(first[0] - last[0], first[1] - last[1]) <= SAME_POINT
  )
    points.pop()
  return points
}

/** Straight sides whose corners are rounded over `reach` metres each way, less on a short side. */
function roundedCorners(points: Point[], closed: boolean, reach: number): Point[] {
  const out: Point[] = []
  const count = points.length
  for (let i = 0; i < count; i++) {
    const here = points[i] as Point
    if (!closed && (i === 0 || i === count - 1)) {
      out.push(here)
      continue
    }
    const before = points[(i - 1 + count) % count] as Point
    const after = points[(i + 1) % count] as Point
    const [ax, az] = [before[0] - here[0], before[1] - here[1]]
    const [bx, bz] = [after[0] - here[0], after[1] - here[1]]
    const [la, lb] = [length2(ax, az), length2(bx, bz)]
    const d = Math.min(reach, la * 0.45, lb * 0.45)
    const turn = Math.abs(ax * bz - az * bx) / (la * lb)
    if (d < 1e-3 || turn < 1e-3) {
      out.push(here)
      continue
    }
    const start: Point = [here[0] + (ax / la) * d, here[1] + (az / la) * d]
    const end: Point = [here[0] + (bx / lb) * d, here[1] + (bz / lb) * d]
    for (let step = 0; step <= FILLET_SEGMENTS; step++) {
      const t = step / FILLET_SEGMENTS
      const [u, v, w] = [(1 - t) * (1 - t), 2 * (1 - t) * t, t * t]
      out.push([u * start[0] + v * here[0] + w * end[0], u * start[1] + v * here[1] + w * end[1]])
    }
  }
  if (closed && out[0]) out.push([out[0][0], out[0][1]])
  return out
}

/** A smooth curve through the points: the fence's spline, wrapped around for a ring. */
function splineThrough(points: Point[], closed: boolean): Point[] {
  const count = points.length
  const wrapped = closed
    ? [points[count - 2], points[count - 1], ...points, points[0], points[1]].map(
        (point) => point as Point,
      )
    : points
  const modes = wrapped.slice(1).map(() => 'curve' as const)
  const sampled = sampleFenceSpline(wrapped, undefined, SPLINE_SEGMENTS, modes).map(
    ({ x, y }): Point => [x, y],
  )
  return closed ? sampled.slice(2 * SPLINE_SEGMENTS, (count + 2) * SPLINE_SEGMENTS + 1) : sampled
}

/**
 * The line through `path` as a polyline: `curve` bends it through the points, otherwise its sides
 * stay straight and its corners are rounded over `cornerReach` metres. A ring ends on its first
 * point. Repeated points are dropped; fewer than two distinct points give no line.
 */
export function smoothLine(
  path: readonly (readonly [number, number])[],
  options: { closed: boolean; curve: boolean; cornerReach: number },
): { points: Point[]; closed: boolean } {
  const points = distinctPoints(path, options.closed)
  if (points.length < 2) return { points: [], closed: false }
  const closed = options.closed && points.length >= 3
  return {
    points: options.curve
      ? splineThrough(points, closed)
      : roundedCorners(points, closed, options.cornerReach),
    closed,
  }
}

/** Reads a polyline by the metres travelled along it. */
export function lineWalker(points: Point[], closed: boolean) {
  const travelled = [0]
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Point, points[i] as Point]
    travelled.push((travelled[i - 1] as number) + length2(b[0] - a[0], b[1] - a[1]))
  }
  const total = travelled.at(-1) ?? 0
  const at = (s: number): Point => {
    const along = closed ? ((s % total) + total) % total : Math.min(total, Math.max(0, s))
    let [low, high] = [0, travelled.length - 1]
    while (high - low > 1) {
      const middle = (low + high) >> 1
      if ((travelled[middle] as number) <= along) low = middle
      else high = middle
    }
    const [a, b] = [points[low] as Point, points[high] as Point]
    const span = (travelled[high] as number) - (travelled[low] as number)
    const t = span > 0 ? (along - (travelled[low] as number)) / span : 0
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  }
  return { total, at }
}
