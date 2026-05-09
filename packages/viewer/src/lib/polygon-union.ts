export type Point2D = [number, number]

const EPSILON = 1e-7
const KEY_SCALE = 1e6

type Edge = {
  start: Point2D
  end: Point2D
  polygonIndex: number
  splits: number[]
}

type Segment = {
  start: Point2D
  end: Point2D
  used: boolean
}

function pointsEqual(a: Point2D, b: Point2D, tolerance = EPSILON) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance
}

function pointKey(point: Point2D) {
  return `${Math.round(point[0] * KEY_SCALE)}:${Math.round(point[1] * KEY_SCALE)}`
}

function interpolate(a: Point2D, b: Point2D, t: number): Point2D {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx
}

function polygonArea(points: Point2D[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const crossValue = cross(point[0] - start[0], point[1] - start[1], dx, dz)
  if (Math.abs(crossValue) > EPSILON) return false

  const dot =
    (point[0] - start[0]) * (point[0] - end[0]) + (point[1] - start[1]) * (point[1] - end[1])
  return dot <= EPSILON
}

function pointInPolygon(point: Point2D, polygon: Point2D[]) {
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!
    const pj = polygon[j]!

    if (pointOnSegment(point, pj, pi)) return false

    const intersects =
      pi[1] > point[1] !== pj[1] > point[1] &&
      point[0] < ((pj[0] - pi[0]) * (point[1] - pi[1])) / (pj[1] - pi[1]) + pi[0]

    if (intersects) inside = !inside
  }

  return inside
}

function normalizeRing(ring: Point2D[]) {
  const normalized: Point2D[] = []

  for (const [x, z] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue

    const point: Point2D = [x, z]
    const previous = normalized[normalized.length - 1]
    if (!previous || !pointsEqual(previous, point)) {
      normalized.push(point)
    }
  }

  const first = normalized[0]
  const last = normalized[normalized.length - 1]
  if (first && last && pointsEqual(first, last)) {
    normalized.pop()
  }

  if (normalized.length < 3 || Math.abs(polygonArea(normalized)) <= EPSILON) return []
  return polygonArea(normalized) < 0 ? [...normalized].reverse() : normalized
}

function addSplit(edge: Edge, t: number) {
  if (t < -EPSILON || t > 1 + EPSILON) return
  const clamped = Math.max(0, Math.min(1, t))
  if (edge.splits.some((split) => Math.abs(split - clamped) <= EPSILON)) return
  edge.splits.push(clamped)
}

function parameterOnEdge(point: Point2D, edge: Edge) {
  const dx = edge.end[0] - edge.start[0]
  const dz = edge.end[1] - edge.start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= EPSILON) return 0
  return ((point[0] - edge.start[0]) * dx + (point[1] - edge.start[1]) * dz) / lengthSquared
}

function addIntersectionSplits(left: Edge, right: Edge) {
  const rx = left.end[0] - left.start[0]
  const rz = left.end[1] - left.start[1]
  const sx = right.end[0] - right.start[0]
  const sz = right.end[1] - right.start[1]
  const qpx = right.start[0] - left.start[0]
  const qpz = right.start[1] - left.start[1]
  const denominator = cross(rx, rz, sx, sz)
  const numerator = cross(qpx, qpz, rx, rz)

  if (Math.abs(denominator) <= EPSILON) {
    if (Math.abs(numerator) > EPSILON) return

    for (const point of [left.start, left.end, right.start, right.end]) {
      if (
        pointOnSegment(point, left.start, left.end) &&
        pointOnSegment(point, right.start, right.end)
      ) {
        addSplit(left, parameterOnEdge(point, left))
        addSplit(right, parameterOnEdge(point, right))
      }
    }
    return
  }

  const t = cross(qpx, qpz, sx, sz) / denominator
  const u = cross(qpx, qpz, rx, rz) / denominator
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return

  addSplit(left, t)
  addSplit(right, u)
}

function buildEdges(polygons: Point2D[][]) {
  const edges: Edge[] = []

  polygons.forEach((polygon, polygonIndex) => {
    for (let i = 0; i < polygon.length; i++) {
      edges.push({
        start: polygon[i]!,
        end: polygon[(i + 1) % polygon.length]!,
        polygonIndex,
        splits: [0, 1],
      })
    }
  })

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const left = edges[i]!
      const right = edges[j]!
      if (left.polygonIndex === right.polygonIndex) continue
      addIntersectionSplits(left, right)
    }
  }

  return edges
}

function buildBoundarySegments(edges: Edge[], polygons: Point2D[][]) {
  const segments: Segment[] = []

  for (const edge of edges) {
    const splits = [...edge.splits].sort((a, b) => a - b)

    for (let i = 0; i < splits.length - 1; i++) {
      const startT = splits[i]!
      const endT = splits[i + 1]!
      if (endT - startT <= EPSILON) continue

      const start = interpolate(edge.start, edge.end, startT)
      const end = interpolate(edge.start, edge.end, endT)
      const mid = interpolate(edge.start, edge.end, (startT + endT) / 2)
      const insideAnother = polygons.some(
        (polygon, index) => index !== edge.polygonIndex && pointInPolygon(mid, polygon),
      )

      if (!insideAnother) {
        segments.push({ start, end, used: false })
      }
    }
  }

  return removeDuplicateInteriorSegments(segments)
}

function segmentKey(segment: Segment) {
  const start = pointKey(segment.start)
  const end = pointKey(segment.end)
  return start < end ? `${start}|${end}` : `${end}|${start}`
}

function removeDuplicateInteriorSegments(segments: Segment[]) {
  const groups = new Map<string, Segment[]>()
  for (const segment of segments) {
    const key = segmentKey(segment)
    const group = groups.get(key)
    if (group) {
      group.push(segment)
    } else {
      groups.set(key, [segment])
    }
  }

  const result: Segment[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]!)
      continue
    }

    const firstStart = pointKey(group[0]!.start)
    const firstEnd = pointKey(group[0]!.end)
    const hasOppositeDirection = group.some(
      (segment) => pointKey(segment.start) === firstEnd && pointKey(segment.end) === firstStart,
    )

    if (!hasOppositeDirection) {
      result.push(group[0]!)
    }
  }

  return result
}

function assembleRings(segments: Segment[]) {
  const byStart = new Map<string, Segment[]>()
  for (const segment of segments) {
    const key = pointKey(segment.start)
    const group = byStart.get(key)
    if (group) {
      group.push(segment)
    } else {
      byStart.set(key, [segment])
    }
  }

  const rings: Point2D[][] = []

  for (const firstSegment of segments) {
    if (firstSegment.used) continue

    firstSegment.used = true
    const ring: Point2D[] = [firstSegment.start, firstSegment.end]
    const startKey = pointKey(firstSegment.start)
    let currentKey = pointKey(firstSegment.end)

    while (currentKey !== startKey) {
      const next = byStart.get(currentKey)?.find((segment) => !segment.used)
      if (!next) break

      next.used = true
      ring.push(next.end)
      currentKey = pointKey(next.end)
    }

    if (currentKey !== startKey) continue

    const last = ring[ring.length - 1]
    if (last && pointsEqual(ring[0]!, last)) {
      ring.pop()
    }

    const normalized = normalizeRing(ring)
    if (normalized.length >= 3) {
      rings.push(normalized)
    }
  }

  return rings
}

export function unionPolygons(polygons: Point2D[][]): Point2D[][] {
  const validPolygons = polygons.map(normalizeRing).filter((polygon) => polygon.length >= 3)
  if (validPolygons.length <= 1) return validPolygons

  const edges = buildEdges(validPolygons)
  const segments = buildBoundarySegments(edges, validPolygons)
  const rings = assembleRings(segments)

  return rings.length > 0 ? rings : validPolygons
}
