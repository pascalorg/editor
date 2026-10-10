import type { ReferencePoint as PlanPoint } from './reference-transform'

export type BandCenterline = {
  /** Centreline of the band; consecutive points become wall segments. */
  points: PlanPoint[]
  /** `true` for a ring band (closed loop), `false` for a straight band. */
  closed: boolean
  /** Uniform band width in metres — the created walls' thickness. */
  thickness: number
}

const THICKNESS_MIN = 0.02
const THICKNESS_MAX = 2
/** A band is elongated; squarish fills are rooms, not wall bodies. */
const ELONGATION_MIN = 1.8
const SAMPLES = 192

const subtract = (a: PlanPoint, b: PlanPoint): PlanPoint => [a[0] - b[0], a[1] - b[1]]
const cross = (a: PlanPoint, b: PlanPoint) => a[0] * b[1] - a[1] * b[0]
const norm = (a: PlanPoint) => Math.hypot(a[0], a[1])

function resampleLoop(loop: PlanPoint[], count: number): PlanPoint[] {
  const n = loop.length
  if (n < 3) return []
  const cumulative: number[] = [0]
  for (let i = 0; i < n; i++) {
    const a = loop[i]!,
      b = loop[(i + 1) % n]!
    cumulative.push(cumulative[i]! + norm(subtract(b, a)))
  }
  const total = cumulative[n]!
  if (total <= 0) return []
  const result: PlanPoint[] = []
  let edge = 0
  for (let i = 0; i < count; i++) {
    const target = (total * i) / count
    while (edge < n - 1 && cumulative[edge + 1]! < target) edge++
    const a = loop[edge]!,
      b = loop[(edge + 1) % n]!
    const span = cumulative[edge + 1]! - cumulative[edge]!
    const t = span > 0 ? (target - cumulative[edge]!) / span : 0
    result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return result
}

function nearestOnLoop(
  point: PlanPoint,
  loop: PlanPoint[],
  closed: boolean,
): { point: PlanPoint; distance: number } {
  let best: PlanPoint = loop[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  const last = closed ? loop.length : loop.length - 1
  for (let i = 0; i < last; i++) {
    const a = loop[i]!,
      b = loop[(i + 1) % loop.length]!
    const ab = subtract(b, a)
    const denominator = ab[0] * ab[0] + ab[1] * ab[1]
    const t =
      denominator > 0
        ? Math.max(
            0,
            Math.min(1, ((point[0] - a[0]) * ab[0] + (point[1] - a[1]) * ab[1]) / denominator),
          )
        : 0
    const q: PlanPoint = [a[0] + ab[0] * t, a[1] + ab[1] * t]
    const d = Math.hypot(point[0] - q[0], point[1] - q[1])
    if (d < bestDistance) {
      bestDistance = d
      best = q
    }
  }
  return { point: best, distance: bestDistance }
}

function rdp(points: PlanPoint[], epsilon: number): PlanPoint[] {
  if (points.length < 3) return [...points]
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    if (end - start < 2) continue
    const a = points[start]!,
      b = points[end]!
    let maxDistance = 0,
      maxIndex = -1
    for (let i = start + 1; i < end; i++) {
      const d = nearestOnLoop(points[i]!, [a, b], false).distance
      if (d > maxDistance) {
        maxDistance = d
        maxIndex = i
      }
    }
    if (maxDistance > epsilon && maxIndex > 0) {
      keep[maxIndex] = true
      stack.push([start, maxIndex], [maxIndex, end])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Simplify a closed loop while keeping the two split corners as anchors. */
export function simplifyClosedLoop(points: PlanPoint[], epsilon: number): PlanPoint[] {
  if (points.length < 4) return [...points]
  const half = Math.floor(points.length / 2)
  const first = rdp(points.slice(0, half + 1), epsilon)
  const second = rdp(points.slice(half), epsilon)
  // first ends at the second split corner; second keeps its own end, whose
  // wrap edge back to the loop start is implied by the closed loop.
  const merged = [...first.slice(0, -1), ...second]
  // The open RDP passes force-keep the split corners even when they sit on a
  // straight run; one deviation pass removes those redundant vertices.
  const cleaned = merged.filter((point, i) => {
    const previous = merged[(i - 1 + merged.length) % merged.length]!
    const next = merged[(i + 1) % merged.length]!
    return nearestOnLoop(point, [previous, next], false).distance > epsilon
  })
  return cleaned.length >= 3 ? cleaned : merged
}

function percentile(sorted: number[], fraction: number) {
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))
  ]!
}

function distanceToLine(point: PlanPoint, a: PlanPoint, b: PlanPoint) {
  const ab = subtract(b, a)
  const denominator = norm(ab)
  return denominator > 0
    ? Math.abs(cross(ab, subtract(point, a))) / denominator
    : norm(subtract(point, a))
}

function minimumEdge(points: PlanPoint[]) {
  let min = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!
    min = Math.min(min, norm(subtract(b, a)))
  }
  return min
}

/** Ring band: one hole whose boundary runs parallel to the outer boundary. */
function ringBand(outer: PlanPoint[], hole: PlanPoint[]): BandCenterline | null {
  const outerSamples = resampleLoop(outer, SAMPLES)
  const innerSamples = resampleLoop(hole, SAMPLES)
  if (!outerSamples.length || !innerSamples.length) return null
  const distances = [
    ...innerSamples.map((p) => nearestOnLoop(p, outer, true).distance),
    ...outerSamples.map((p) => nearestOnLoop(p, hole, true).distance),
  ].sort((a, b) => a - b)
  const median = percentile(distances, 0.5)
  if (median < THICKNESS_MIN || median > THICKNESS_MAX) return null
  // SVG jitter and corner rounding perturb the width; only a roughly uniform
  // band deserves one thick wall, anything else keeps the outline behaviour.
  if (percentile(distances, 0.9) - percentile(distances, 0.1) > Math.max(0.03, 0.3 * median))
    return null
  const midline = outerSamples.map((o) => {
    const h = nearestOnLoop(o, hole, true).point
    return [(o[0] + h[0]) / 2, (o[1] + h[1]) / 2] as PlanPoint
  })
  const points = simplifyClosedLoop(midline, Math.max(0.01, Math.min(0.08, median / 5)))
  if (points.length < 3 || minimumEdge(points) < 0.01) return null
  return { points, closed: true, thickness: median }
}

/** Solid band: a convex quadrilateral — typically a wall drawn as a filled rectangle. */
function solidBand(polygon: PlanPoint[]): BandCenterline | null {
  const width = Math.abs(
    Math.min(...polygon.map((p) => p[0])) - Math.max(...polygon.map((p) => p[0])),
  )
  const height = Math.abs(
    Math.min(...polygon.map((p) => p[1])) - Math.max(...polygon.map((p) => p[1])),
  )
  const quad = simplifyClosedLoop(polygon, Math.max(0.01, 0.01 * Math.hypot(width, height)))
  if (quad.length !== 4 || minimumEdge(quad) < THICKNESS_MIN) return null
  const edges = quad.map((a, i) => subtract(quad[(i + 1) % 4]!, a))
  const turns = edges.map((e, i) => cross(e, edges[(i + 1) % 4]!))
  if (!turns.every((t) => t > 0) && !turns.every((t) => t < 0)) return null
  const pairs = [0, 1].map((offset) => ({
    offset,
    meanLength: (norm(edges[offset]!) + norm(edges[offset + 2]!)) / 2,
  }))
  const [shortPair, longPair] = [...pairs].sort((a, b) => a.meanLength - b.meanLength)
  if (!longPair || !shortPair || longPair.meanLength / shortPair.meanLength < ELONGATION_MIN)
    return null
  const sideOffset = longPair.offset
  const sideEnd = (sideOffset + 2) % 4
  const parallelism =
    Math.abs(cross(edges[sideOffset]!, edges[sideEnd]!)) /
    (norm(edges[sideOffset]!) * norm(edges[sideEnd]!))
  if (parallelism > 0.08) return null
  const near = distanceToLine(quad[sideEnd]!, quad[sideOffset]!, quad[(sideOffset + 1) % 4]!)
  const far = distanceToLine(
    quad[(sideEnd + 1) % 4]!,
    quad[sideOffset]!,
    quad[(sideOffset + 1) % 4]!,
  )
  const thickness = (near + far) / 2
  if (thickness < THICKNESS_MIN || thickness > THICKNESS_MAX) return null
  if (Math.abs(far - near) > Math.max(0.03, 0.2 * thickness)) return null
  const midOf = (i: number) => {
    const a = quad[i]!,
      b = quad[(i + 1) % 4]!
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as PlanPoint
  }
  const endOffsets = sideOffset === 0 ? [1, 3] : [0, 2]
  const points = [midOf(endOffsets[0]!), midOf(endOffsets[1]!)]
  if (norm(subtract(points[1]!, points[0]!)) < THICKNESS_MIN) return null
  return { points, closed: false, thickness }
}

/**
 * Interpret a filled plan area as a wall body: a uniform-width band becomes
 * one thick wall along its centreline instead of outline walls around both
 * boundaries. Returns `null` when the fill does not read as a band, so the
 * caller can fall back to outlining the area.
 */
export function bandWallCenterline(
  polygon: PlanPoint[],
  holes: PlanPoint[][],
): BandCenterline | null {
  if (holes.length === 1) return ringBand(polygon, holes[0]!)
  if (holes.length === 0) return solidBand(polygon)
  return null
}
