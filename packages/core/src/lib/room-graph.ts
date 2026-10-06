import type { AnyNode, SeparatorNode, WallNode } from '../schema'
import { getWallArcData, getWallCurveFrameAt, isCurvedWall } from '../systems/wall/wall-curve'
import { getWallBodyCenterOffset, getWallFaceOffsets } from '../systems/wall/wall-frame'
import { area, difference, intersection, type Ring, union } from './polygon-boolean'
import type { BoundaryNode, BoundarySpan } from './room-topology-index'

export type Point2D = { x: number; y: number }
type JunctionVertex = Point2D & { wallEndpoint: boolean }

export type OpenWallEnd = {
  wallId: string
  end: 'start' | 'end'
  point: [number, number]
  reason: 'gap' | 'crosses' | 'parallel' | 'rejected' | 'isolated'
  gap?: number
  candidate?: { wallId: string; point: [number, number]; kind: 'endpoint' | 'body' }
}

export type SpaceBoundaryFace = {
  wallId: WallNode['id']
  face: 'front' | 'back'
  points: Array<[number, number]>
}

export type ExtractedRoom = {
  id: string
  referencePolygon: Array<[number, number]>
  holes: Array<Array<[number, number]>>
  spans: BoundarySpan[]
  polygon: Point2D[]
  boundaryFaces: SpaceBoundaryFace[]
}

const ROOM_CURVE_TOLERANCE = 0.04
const MAX_CURVE_SUBDIVISION_DEPTH = 6
export const WALL_JUNCTION_TOLERANCE = 0.08

export function pointFromTuple(point: [number, number]): Point2D {
  return { x: point[0], y: point[1] }
}

export function pointToTuple(point: Point2D): [number, number] {
  return [point.x, point.y]
}

function pointKey(point: Point2D) {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`
}

export function polygonArea(points: Point2D[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (!(a && b)) continue
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

function minRotationSignature(keys: string[]) {
  if (keys.length === 0) return ''
  let best = ''
  for (let i = 0; i < keys.length; i++) {
    const rotated = [...keys.slice(i), ...keys.slice(0, i)]
    const value = rotated.join('|')
    if (!best || value < best) best = value
  }
  return best
}

export function polygonSignature(points: Point2D[]) {
  const keys = points.map(pointKey)
  const forward = minRotationSignature(keys)
  const reversed = minRotationSignature([...keys].reverse())
  return forward < reversed ? forward : reversed
}

function samePointWithinTolerance(a: Point2D, b: Point2D, tolerance = 1e-4) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance
}

export function dedupeSequentialPoints(points: Point2D[], tolerance = 1e-4) {
  const deduped: Point2D[] = []

  for (const point of points) {
    const previous = deduped[deduped.length - 1]
    if (previous && samePointWithinTolerance(previous, point, tolerance)) {
      continue
    }
    deduped.push(point)
  }

  const firstPoint = deduped[0]
  const lastPoint = deduped[deduped.length - 1]
  if (
    deduped.length > 2 &&
    firstPoint &&
    lastPoint &&
    samePointWithinTolerance(firstPoint, lastPoint, tolerance)
  ) {
    deduped.pop()
  }

  return deduped
}

export function bboxOf(points: Point2D[]) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  return { minX, minY, maxX, maxY }
}

function pointLineDistance(point: Point2D, start: Point2D, end: Point2D) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared < 1e-9) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx
  return Math.abs(cross) / Math.sqrt(lengthSquared)
}

export function sampleWallPointsForRoomDetection(
  wall: Pick<WallNode, 'start' | 'end' | 'curveOffset'>,
  tolerance = ROOM_CURVE_TOLERANCE,
) {
  const start = { x: wall.start[0], y: wall.start[1] }
  const end = { x: wall.end[0], y: wall.end[1] }

  if (!isCurvedWall(wall)) {
    return [start, end]
  }

  const subdivide = (
    t0: number,
    p0: Point2D,
    t1: number,
    p1: Point2D,
    depth: number,
  ): Point2D[] => {
    const midT = (t0 + t1) / 2
    const midPoint = getWallCurveFrameAt(wall, midT).point
    const deviation = pointLineDistance(midPoint, p0, p1)

    if (depth >= MAX_CURVE_SUBDIVISION_DEPTH || deviation <= tolerance) {
      return [p0, p1]
    }

    const left = subdivide(t0, p0, midT, midPoint, depth + 1)
    const right = subdivide(midT, midPoint, t1, p1, depth + 1)
    return [...left.slice(0, -1), ...right]
  }

  return subdivide(0, start, 1, end, 0)
}

function segmentProjection(point: Point2D, start: Point2D, end: Point2D) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-12) {
    return { t: 0, distance: Math.hypot(point.x - start.x, point.y - start.y) }
  }
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  const clampedT = Math.max(0, Math.min(1, t))
  const projX = start.x + clampedT * dx
  const projY = start.y + clampedT * dy
  return { t, distance: Math.hypot(point.x - projX, point.y - projY) }
}

// Break a straight wall at any junction vertex (another wall's endpoint) that
// lands on its interior, returning the ordered polyline [start, …splits, end].
// Splitting at the *vertex* position (not the projection) keeps the split node's
// key identical to the touching wall's endpoint so the two share a graph node.
function splitStraightWallAtVertices(
  start: Point2D,
  end: Point2D,
  vertices: JunctionVertex[],
  separator = false,
) {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length < 1e-9) return [start, end]

  const interior: Array<{ point: Point2D; t: number }> = []
  for (const vertex of vertices) {
    // Separators have authored/snapped coordinates; proximity must not pull an
    // island into a nearby wall or bend another segment of a multi-point path.
    const tolerance = separator || !vertex.wallEndpoint ? 1e-6 : WALL_JUNCTION_TOLERANCE
    const { t, distance } = segmentProjection(vertex, start, end)
    if (distance > tolerance) continue
    const along = t * length
    if (along <= tolerance || along >= length - tolerance) continue
    interior.push({ point: { x: vertex.x, y: vertex.y }, t })
  }
  interior.sort((a, b) => a.t - b.t)

  const ordered: Point2D[] = [start]
  let lastKey = pointKey(start)
  for (const { point } of interior) {
    const key = pointKey(point)
    if (key === lastKey) continue
    ordered.push(point)
    lastKey = key
  }
  if (lastKey !== pointKey(end)) ordered.push(end)
  return ordered
}

function splitCurvedWallAtVertices(
  points: Point2D[],
  vertices: JunctionVertex[],
  wall: BoundaryNode,
): Point2D[][] {
  const arc = getWallArcData(wall)
  const stations = [0]
  for (let i = 1; i < points.length; i++) {
    stations.push(
      stations[i - 1]! +
        Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y),
    )
  }
  const length = stations.at(-1)!
  const cuts = [
    { point: points[0]!, station: 0 },
    { point: points.at(-1)!, station: length },
  ]
  for (const vertex of vertices) {
    // Divide snaps to 64 chord samples; allow their sagitta, not the wall-junction radius.
    const separatorTolerance = arc ? arc.radius * (1 - Math.cos(arc.delta / 128)) + 1e-6 : 1e-6
    if (
      !vertex.wallEndpoint &&
      arc &&
      Math.abs(Math.hypot(vertex.x - arc.center.x, vertex.y - arc.center.y) - arc.radius) >
        separatorTolerance
    )
      continue
    const endpointTolerance = vertex.wallEndpoint ? WALL_JUNCTION_TOLERANCE : 1e-6
    let best = { distance: Number.POSITIVE_INFINITY, station: 0 }
    for (let i = 0; i < points.length - 1; i++) {
      const { t, distance } = segmentProjection(vertex, points[i]!, points[i + 1]!)
      if (distance >= best.distance) continue
      best = {
        distance,
        station: stations[i]! + Math.max(0, Math.min(1, t)) * (stations[i + 1]! - stations[i]!),
      }
    }
    if (
      best.distance > WALL_JUNCTION_TOLERANCE ||
      best.station <= endpointTolerance ||
      best.station >= length - endpointTolerance
    )
      continue
    cuts.push({ point: { x: vertex.x, y: vertex.y }, station: best.station })
  }
  cuts.sort((a, b) => a.station - b.station)
  return cuts.slice(0, -1).flatMap((cut, i) => {
    const next = cuts[i + 1]!
    if (pointKey(cut.point) === pointKey(next.point)) return []
    return [
      dedupeSequentialPoints([
        cut.point,
        ...points.filter(
          (_, j) => stations[j]! > cut.station + 1e-8 && stations[j]! < next.station - 1e-8,
        ),
        next.point,
      ]),
    ]
  })
}

// Reference half-edges determine connectivity; body lines keep room geometry invariant
// when a reference moves beneath an unchanged wall body.
function roomBodyPolygon(edges: Array<{ wall: BoundaryNode; points: Point2D[] }>): Point2D[] {
  const shifted = edges.map(({ wall, points }) => {
    const offset = wall.type === 'wall' ? getWallBodyCenterOffset(wall) : 0
    const arc = getWallArcData(wall)
    const frame = getWallCurveFrameAt(wall, 0)
    return points.map((point) => {
      if (offset === 0) return point
      if (arc) {
        const scale = (arc.radius - arc.direction * offset) / arc.radius
        return {
          x: arc.center.x + (point.x - arc.center.x) * scale,
          y: arc.center.y + (point.y - arc.center.y) * scale,
        }
      }
      return { x: point.x + frame.normal.x * offset, y: point.y + frame.normal.y * offset }
    })
  })
  const result: Point2D[] = []
  for (let i = 0; i < shifted.length; i++) {
    const previous = shifted[(i + shifted.length - 1) % shifted.length]!
    const current = shifted[i]!
    const a = previous[previous.length - 2]!
    const b = previous[previous.length - 1]!
    const c = current[0]!
    const d = current[1]!
    const dx = b.x - a.x,
      dy = b.y - a.y
    const ex = d.x - c.x,
      ey = d.y - c.y
    const denominator = dx * ey - dy * ex
    if (Math.abs(denominator) < 1e-9) {
      result.push(b, c)
    } else {
      const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / denominator
      const intersection = { x: a.x + t * dx, y: a.y + t * dy }
      const limit =
        10 *
        Math.max(
          Math.abs(boundaryBodyOffset(edges[i]!.wall)),
          Math.abs(boundaryBodyOffset(edges[(i + edges.length - 1) % edges.length]!.wall)),
          1e-6,
        )
      if (
        Math.hypot(intersection.x - b.x, intersection.y - b.y) <= limit &&
        Math.hypot(intersection.x - c.x, intersection.y - c.y) <= limit
      )
        result.push(intersection)
      else result.push(b, c)
    }
    result.push(...current.slice(1, -1))
  }
  return dedupeSequentialPoints(result)
}

function boundaryBodyOffset(boundary: BoundaryNode) {
  return boundary.type === 'wall' ? getWallBodyCenterOffset(boundary) : 0
}

/** Largest visible gap between two wall bodies that still reads as a joint. */
const JOINT_GAP = 0.015
/** Farthest a wall end may sit off another wall's reference line and still join its body. */
export const TEE_REACH = 0.4

/**
 * How far apart two boundaries' reference lines may be where they still join: the
 * junction tolerance, or, for walls, as far as their drawn bodies can touch.
 */
export function junctionReach(a: BoundaryNode, b: BoundaryNode) {
  if (a.type !== 'wall' || b.type !== 'wall') return WALL_JUNCTION_TOLERANCE
  // Metre-thick "walls" are blocks or slabs drawn with the wall tool, not joints.
  if (Math.max(a.thickness ?? 0.1, b.thickness ?? 0.1) > 2 * TEE_REACH)
    return WALL_JUNCTION_TOLERANCE
  return Math.max(
    WALL_JUNCTION_TOLERANCE,
    Math.min(TEE_REACH, Math.max(a.thickness ?? 0.1, b.thickness ?? 0.1) / 2 + JOINT_GAP),
  )
}
const GRID_CELL = 1
const MAX_GRID_CELLS = 256

type Box = { minX: number; minY: number; maxX: number; maxY: number }
type SampledBoundary = {
  boundary: BoundaryNode
  points: Point2D[]
  stations: number[]
  length: number
  box: Box
  body?: Point2D[][]
}

function sampleBoundary(boundary: BoundaryNode): SampledBoundary {
  const points = sampleWallPointsForRoomDetection(boundary)
  const stations = [0]
  for (let i = 1; i < points.length; i++)
    stations.push(
      stations[i - 1]! +
        Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y),
    )
  return { boundary, points, stations, length: stations.at(-1)!, box: bboxOf(points) }
}

function gridKeys(box: Box, margin: number) {
  const minX = Math.floor((box.minX - margin) / GRID_CELL)
  const maxX = Math.floor((box.maxX + margin) / GRID_CELL)
  const minY = Math.floor((box.minY - margin) / GRID_CELL)
  const maxY = Math.floor((box.maxY + margin) / GRID_CELL)
  if (
    ![minX, maxX, minY, maxY].every(Number.isSafeInteger) ||
    (maxX - minX + 1) * (maxY - minY + 1) > MAX_GRID_CELLS
  )
    return null
  const keys: string[] = []
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) keys.push(`${x},${y}`)
  return keys
}

/** Items near a box, bounded by a uniform grid; huge or extreme boxes fall back to a scan. */
function spatialIndex<T>(items: readonly T[], boxOf: (item: T) => Box) {
  const cells = new Map<string, T[]>()
  const wide: T[] = []
  for (const item of items) {
    const keys = gridKeys(boxOf(item), 0)
    if (!keys) {
      wide.push(item)
      continue
    }
    for (const key of keys) {
      const cell = cells.get(key)
      if (cell) cell.push(item)
      else cells.set(key, [item])
    }
  }
  return (box: Box, margin: number): Iterable<T> => {
    const keys = gridKeys(box, margin)
    if (!keys) return items
    const found = new Set<T>(wide)
    for (const key of keys) for (const item of cells.get(key) ?? []) found.add(item)
    return found
  }
}

function pointBox(point: Point2D): Box {
  return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
}

function joinsBoundaryInterior(point: Point2D, sampled: SampledBoundary) {
  const tolerance = sampled.boundary.type === 'separator' ? 1e-6 : WALL_JUNCTION_TOLERANCE
  const { points, stations, length } = sampled
  for (let i = 0; i < points.length - 1; i++) {
    const { t, distance } = segmentProjection(point, points[i]!, points[i + 1]!)
    const along = stations[i]! + Math.max(0, Math.min(1, t)) * (stations[i + 1]! - stations[i]!)
    if (distance <= tolerance && along > tolerance && along < length - tolerance) return true
  }
  return false
}

function sampledCrossings(left: SampledBoundary, right: SampledBoundary) {
  const margin = WALL_JUNCTION_TOLERANCE
  const crossings: Array<{ point: Point2D; along: number; otherAlong: number; sine: number }> = []
  for (let i = 0; i < left.points.length - 1; i++) {
    const p = left.points[i]!
    const r = { x: left.points[i + 1]!.x - p.x, y: left.points[i + 1]!.y - p.y }
    for (let j = 0; j < right.points.length - 1; j++) {
      const q = right.points[j]!
      const u = { x: right.points[j + 1]!.x - q.x, y: right.points[j + 1]!.y - q.y }
      const denominator = r.x * u.y - r.y * u.x
      if (Math.abs(denominator) <= 1e-12) continue
      const t = ((q.x - p.x) * u.y - (q.y - p.y) * u.x) / denominator
      const v = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / denominator
      if (t < 0 || t > 1 || v < 0 || v > 1) continue
      const along = left.stations[i]! + t * (left.stations[i + 1]! - left.stations[i]!)
      const otherAlong = right.stations[j]! + v * (right.stations[j + 1]! - right.stations[j]!)
      if (
        along > margin &&
        along < left.length - margin &&
        otherAlong > margin &&
        otherAlong < right.length - margin
      )
        crossings.push({
          point: { x: p.x + t * r.x, y: p.y + t * r.y },
          along,
          otherAlong,
          sine: Math.abs(denominator) / (Math.hypot(r.x, r.y) * Math.hypot(u.x, u.y)),
        })
    }
  }
  return crossings
}

function sampledCross(left: SampledBoundary, right: SampledBoundary) {
  return sampledCrossings(left, right).length > 0
}

/**
 * Crossings where a wall end runs a short way past another wall: the stub past the crossing
 * must end free, so a wall passing through another near its corner stays a plain crossing.
 */
function overshootCrossings(
  left: SampledBoundary,
  right: SampledBoundary,
  free: (end: Point2D) => boolean,
) {
  if (
    left.boundary.type !== 'wall' ||
    right.boundary.type !== 'wall' ||
    isCurvedWall(left.boundary) ||
    isCurvedWall(right.boundary) ||
    Math.max(left.boundary.thickness ?? 0.1, right.boundary.thickness ?? 0.1) > 0.8
  )
    return []
  const overshoots = (sampled: SampledBoundary, along: number) =>
    (along <= TEE_REACH && free(sampled.points[0]!)) ||
    (sampled.length - along <= TEE_REACH && free(sampled.points.at(-1)!))
  return sampledCrossings(left, right).filter(
    ({ along, otherAlong, sine }) =>
      sine >= Math.SQRT1_2 && (overshoots(left, along) || overshoots(right, otherAlong)),
  )
}

/**
 * True when two boundaries cross away from their ends (sample vertices included).
 * Room detection and the incremental topology index share this predicate.
 */
export function boundariesCross(a: BoundaryNode, b: BoundaryNode) {
  return sampledCross(sampleBoundary(a), sampleBoundary(b))
}

/** The wall body as drawn: one quad per sampled segment, between its two faces. */
function bodyOf(sampled: SampledBoundary) {
  if (sampled.body) return sampled.body
  const wall = sampled.boundary
  const { a, b } = wall.type === 'wall' ? getWallFaceOffsets(wall) : { a: 0, b: 0 }
  sampled.body = sampled.points.slice(0, -1).flatMap((p, i) => {
    const q = sampled.points[i + 1]!
    const length = Math.hypot(q.x - p.x, q.y - p.y)
    if (!(length > 1e-9)) return []
    const n = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length }
    return [
      [
        { x: p.x + n.x * a, y: p.y + n.y * a },
        { x: q.x + n.x * a, y: q.y + n.y * a },
        { x: q.x + n.x * b, y: q.y + n.y * b },
        { x: p.x + n.x * b, y: p.y + n.y * b },
      ],
    ]
  })
  return sampled.body
}

function insideQuad(point: Point2D, quad: Point2D[]) {
  let inside = false
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const a = quad[i]!
    const b = quad[j]!
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside
  }
  return inside
}

function quadGap(left: Point2D[], right: Point2D[]) {
  if (left.some((p) => insideQuad(p, right)) || right.some((p) => insideQuad(p, left))) return 0
  let gap = Number.POSITIVE_INFINITY
  for (const [points, other] of [
    [left, right],
    [right, left],
  ] as const)
    for (const p of points)
      for (let i = 0; i < other.length; i++)
        gap = Math.min(
          gap,
          segmentProjection(p, other[i]!, other[(i + 1) % other.length]!).distance,
        )
  return gap
}

/** What the user sees: the two drawn wall bodies touch, or nearly, at the joint. */
function bodyGap(left: SampledBoundary, right: SampledBoundary, near: Point2D, minimumReach = 0) {
  if (left.boundary.type !== 'wall' || right.boundary.type !== 'wall') return Infinity
  const reach = Math.max(
    minimumReach,
    WALL_JUNCTION_TOLERANCE +
      Math.max(left.boundary.thickness ?? 0.1, right.boundary.thickness ?? 0.1),
  )
  // Only the stretch of each body around the joint counts, never a touch elsewhere.
  const local = (sampled: SampledBoundary) =>
    bodyOf(sampled).filter((quad) => {
      const box = bboxOf(quad)
      return (
        near.x >= box.minX - reach &&
        near.x <= box.maxX + reach &&
        near.y >= box.minY - reach &&
        near.y <= box.maxY + reach
      )
    })
  const rightQuads = local(right)
  return Math.min(...local(left).flatMap((quad) => rightQuads.map((other) => quadGap(quad, other))))
}

function bodiesTouch(left: SampledBoundary, right: SampledBoundary, near: Point2D) {
  return bodyGap(left, right, near) <= JOINT_GAP
}

function halfBody(sampled: SampledBoundary) {
  return sampled.boundary.type === 'wall' ? (sampled.boundary.thickness ?? 0.1) / 2 : 0
}

/** Unit direction a wall arrives at one of its ends. */
function endDirection(sampled: SampledBoundary, end: Point2D) {
  const { points } = sampled
  const atStart = pointKey(points[0]!) === pointKey(end)
  const [from, to] = atStart ? [points[1]!, points[0]!] : [points.at(-2)!, points.at(-1)!]
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

/** Nearest point of a wall's reference line to `point`, if it lies away from its ends. */
function interiorFoot(point: Point2D, sampled: SampledBoundary) {
  const { points, stations, length } = sampled
  let best: { point: Point2D; distance: number; direction: Point2D } | undefined
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const segment = stations[i + 1]! - stations[i]!
    if (!(segment > 1e-9)) continue
    const { t, distance } = segmentProjection(point, a, b)
    const clamped = Math.max(0, Math.min(1, t))
    const along = stations[i]! + clamped * segment
    if (along <= WALL_JUNCTION_TOLERANCE || along >= length - WALL_JUNCTION_TOLERANCE) continue
    if (best && distance >= best.distance) continue
    best = {
      point: { x: a.x + clamped * (b.x - a.x), y: a.y + clamped * (b.y - a.y) },
      distance,
      direction: { x: (b.x - a.x) / segment, y: (b.y - a.y) / segment },
    }
  }
  return best
}

/** Where a straight wall's line meets another straight wall's reference line between its ends. */
function ownAxisMeet(sampled: SampledBoundary, other: SampledBoundary): Point2D | undefined {
  if (isCurvedWall(sampled.boundary) || isCurvedWall(other.boundary)) return
  const [p, p2] = sampled.points as [Point2D, Point2D]
  const [q, q2] = other.points as [Point2D, Point2D]
  const r = { x: p2.x - p.x, y: p2.y - p.y }
  const u = { x: q2.x - q.x, y: q2.y - q.y }
  const denominator = r.x * u.y - r.y * u.x
  if (Math.abs(denominator) < 1e-12) return
  const along = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / denominator
  if (!(along > 0 && along < 1)) return
  const t = ((q.x - p.x) * u.y - (q.y - p.y) * u.x) / denominator
  return { x: p.x + t * r.x, y: p.y + t * r.y }
}

/** Where two loose straight wall ends would meet if both ran on to their corner. */
function cornerOf(
  cluster: readonly { point: Point2D; boundaryIds: Set<string> }[],
  byId: ReadonlyMap<string, SampledBoundary>,
  reachOf: (a: BoundaryNode, b: BoundaryNode) => number,
): Point2D | undefined {
  if (cluster.length !== 2) return
  const [a, b] = cluster.map((group) => byId.get([...group.boundaryIds][0]!)?.boundary)
  if (!(a && b) || isCurvedWall(a) || isCurvedWall(b)) return
  const r = { x: a.end[0] - a.start[0], y: a.end[1] - a.start[1] }
  const u = { x: b.end[0] - b.start[0], y: b.end[1] - b.start[1] }
  const denominator = r.x * u.y - r.y * u.x
  // Only a real corner: walls nearly in line meet where their ends already are.
  if (Math.abs(denominator) < 0.5 * Math.hypot(r.x, r.y) * Math.hypot(u.x, u.y)) return
  const t = ((b.start[0] - a.start[0]) * u.y - (b.start[1] - a.start[1]) * u.x) / denominator
  const corner = { x: a.start[0] + t * r.x, y: a.start[1] + t * r.y }
  const reach = reachOf(a, b)
  return cluster.every(({ point }) => Math.hypot(point.x - corner.x, point.y - corner.y) <= reach)
    ? corner
    : undefined
}

/** Distance from a wall end touching this wall's body within the tolerance of its end at `corner`. */
function bodyReach(
  point: Point2D,
  corner: { point: Point2D },
  sampled: SampledBoundary,
  reach = WALL_JUNCTION_TOLERANCE,
) {
  if (sampled.boundary.type !== 'wall') return Number.POSITIVE_INFINITY
  const { points } = sampled
  const atStart = pointKey(points[0]!) === pointKey(corner.point)
  const [a, b] = atStart ? [points[0]!, points[1]!] : [points.at(-1)!, points.at(-2)!]
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  // A stub is reached through its ends only.
  if (!(length > 2 * reach)) return Number.POSITIVE_INFINITY
  const along = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length
  if (along < 0 || along > reach) return Number.POSITIVE_INFINITY
  return Math.abs((point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)) / length
}

/**
 * Walls drawn a few centimetres short of a corner read as joined when their drawn
 * bodies touch there. A wall end that meets no other boundary joins the nearest
 * boundary end within the junction tolerance, or a wall body that close to its end,
 * whose drawn body touches its own (a visible gap, however small the walls, stays
 * open). Returns exact endpoint keys mapped to their junction point. A junction only
 * involves walls that touch within the tolerance, so incremental topology rebuilds of
 * one component elect the same point as full ones.
 */
function nearMissJunctions(
  boundaries: readonly BoundaryNode[],
  bodyJoints: boolean,
  diagnostics?: OpenWallEnd[],
) {
  const reachOf = (a: BoundaryNode, b: BoundaryNode) =>
    bodyJoints ? junctionReach(a, b) : WALL_JUNCTION_TOLERANCE
  // loose: a wall end meeting nothing. A loose end whose wall crosses another is
  // blocked; that is only checked where a join is possible.
  type Group = {
    key: string
    point: Point2D
    boundaryIds: Set<string>
    state: 'joined' | 'loose'
  }
  const sampled = boundaries.map(sampleBoundary)
  const byId = new Map<string, SampledBoundary>(sampled.map((item) => [item.boundary.id, item]))
  const near = spatialIndex(sampled, (item) => item.box)
  const groups = new Map<string, Group>()
  for (const boundary of boundaries)
    for (const tuple of [boundary.start, boundary.end]) {
      const point = pointFromTuple(tuple)
      const key = pointKey(point)
      const group = groups.get(key) ?? { key, point, boundaryIds: new Set(), state: 'joined' }
      group.boundaryIds.add(boundary.id)
      groups.set(key, group)
    }
  const ordered = [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const nearGroups = spatialIndex(ordered, (group) => pointBox(group.point))
  const crossing = new Map<string, boolean>()
  const looseEnd = (end: Point2D) => groups.get(pointKey(end))?.state === 'loose'
  // The graph is planar only at junctions; connecting a wall that crosses another
  // would close faces through the crossing.
  const crosses = (wall: SampledBoundary) => {
    let value = crossing.get(wall.boundary.id)
    if (value === undefined) {
      value = false
      for (const other of near(wall.box, 0))
        if (
          other !== wall &&
          sampledCrossings(wall, other).length >
            (bodyJoints ? overshootCrossings(wall, other, looseEnd).length : 0)
        ) {
          value = true
          break
        }
      crossing.set(wall.boundary.id, value)
    }
    return value
  }
  for (const group of ordered) {
    const [only, ...rest] = group.boundaryIds
    const wall = byId.get(only!)!
    if (rest.length || wall.boundary.type !== 'wall') continue
    let joined = false
    for (const other of near(pointBox(group.point), WALL_JUNCTION_TOLERANCE))
      if (other !== wall && joinsBoundaryInterior(group.point, other)) {
        joined = true
        break
      }
    if (!joined) group.state = 'loose'
  }
  const blocked = (group: Group) =>
    group.state === 'loose' && crosses(byId.get([...group.boundaryIds][0]!)!)
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    const next = parent.get(key)
    if (!next || next === key) return key
    const root = find(next)
    parent.set(key, root)
    return root
  }
  const members = new Map<string, Set<string>>()
  const membersOf = (root: string) => members.get(root) ?? new Set([root])
  const ends = new Map<string, readonly [string, string]>(
    boundaries.map((boundary) => [
      boundary.id,
      [pointKey(pointFromTuple(boundary.start)), pointKey(pointFromTuple(boundary.end))] as const,
    ]),
  )
  // Joining must neither collapse a wall onto one junction nor lay a wall on top of
  // another one between the same two junctions.
  const neighbours = (keys: Set<string>, joined: Set<string>) => {
    const roots = new Set<string>()
    for (const key of keys)
      for (const id of groups.get(key)!.boundaryIds) {
        const [start, end] = ends.get(id)!
        if (start === end) continue
        if (joined.has(start) && joined.has(end)) return null
        roots.add(find(joined.has(start) ? end : start))
      }
    return roots
  }
  for (const group of ordered) {
    if (group.state !== 'loose') continue
    const wall = byId.get([...group.boundaryIds][0]!)!
    const candidates: { group: Group; distance: number }[] = []
    for (const candidate of nearGroups(pointBox(group.point), 2 * TEE_REACH)) {
      if (candidate === group || candidate.boundaryIds.has(wall.boundary.id)) continue
      // Thick walls are reached as far as their drawn bodies can touch the end.
      const reach = Math.max(
        ...[...candidate.boundaryIds].map((id) => reachOf(wall.boundary, byId.get(id)!.boundary)),
      )
      const distance = Math.min(
        Math.hypot(candidate.point.x - group.point.x, candidate.point.y - group.point.y),
        ...[...candidate.boundaryIds].map((id) =>
          bodyReach(group.point, candidate, byId.get(id)!, reach),
        ),
      )
      if (distance <= reach) candidates.push({ group: candidate, distance })
    }
    if (!candidates.length || blocked(group)) continue
    candidates.sort((a, b) => a.distance - b.distance || (a.group.key < b.group.key ? -1 : 1))
    const best = candidates.find(
      ({ group: candidate }) =>
        !blocked(candidate) &&
        [...candidate.boundaryIds].some((id) => bodiesTouch(wall, byId.get(id)!, group.point)),
    )?.group
    if (!best) continue
    const left = find(group.key)
    const right = find(best.key)
    if (left === right) continue
    const joined = new Set([...membersOf(left), ...membersOf(right)])
    const leftRoots = neighbours(membersOf(left), joined)
    const rightRoots = neighbours(membersOf(right), joined)
    if (!(leftRoots && rightRoots) || [...leftRoots].some((root) => rightRoots.has(root))) continue
    parent.set(left, right)
    members.set(right, joined)
    members.delete(left)
  }
  // A wall end standing inside another wall's drawn body, away from its ends, joins it
  // at the foot of that body's reference line even when the lines are far apart.
  const tees = new Map<string, Point2D>()
  for (const group of bodyJoints ? ordered : []) {
    if (group.state !== 'loose' || membersOf(find(group.key)).size > 1 || blocked(group)) continue
    const wall = byId.get([...group.boundaryIds][0]!)!
    const approach = endDirection(wall, group.point)
    let best: { point: Point2D; distance: number } | undefined
    for (const other of near(pointBox(group.point), TEE_REACH)) {
      if (other === wall || other.boundary.type !== 'wall') continue
      const foot = interiorFoot(group.point, other)
      if (!foot || foot.distance > junctionReach(wall.boundary, other.boundary)) continue
      // Walls running alongside each other are stacked, not joined.
      if (Math.abs(approach.x * foot.direction.y - approach.y * foot.direction.x) < 0.5) continue
      // A stub drawn entirely inside the other wall's body shows nothing to join.
      const start =
        wall.points[pointKey(wall.points[0]!) === group.key ? wall.points.length - 1 : 0]!
      if ((interiorFoot(start, other)?.distance ?? Number.POSITIVE_INFINITY) <= halfBody(other))
        continue
      if (best && foot.distance >= best.distance) continue
      if (bodiesTouch(wall, other, group.point)) best = foot
    }
    if (best) tees.set(group.key, best.point)
  }
  const junctions = new Map<string, Point2D>(tees)
  for (const keys of members.values()) {
    const cluster = [...keys].map((key) => groups.get(key)!)
    const junction =
      cluster.find((group) => group.state === 'joined')?.point ??
      cornerOf(cluster, byId, reachOf) ??
      cluster.sort((a, b) => (a.key < b.key ? -1 : 1))[0]!.point
    for (const group of cluster)
      if (pointKey(group.point) !== pointKey(junction)) junctions.set(group.key, junction)
  }
  if (diagnostics)
    for (const group of ordered) {
      for (const id of group.boundaryIds) {
        const wall = byId.get(id)!
        if (wall.boundary.type !== 'wall') continue
        const approach = endDirection(wall, group.point)
        let best:
          | {
              candidate: NonNullable<OpenWallEnd['candidate']>
              distance: number
              parallel: boolean
              gap: number
            }
          | undefined
        let crossingTarget: typeof best
        for (const other of near(pointBox(group.point), 0.35)) {
          if (other === wall || other.boundary.type !== 'wall') continue
          const consider = (point: Point2D, kind: 'endpoint' | 'body', parallel: boolean) => {
            const distance = Math.hypot(point.x - group.point.x, point.y - group.point.y)
            if (distance > 0.35 || (best && distance >= best.distance)) return
            best = {
              candidate: { wallId: other.boundary.id, point: pointToTuple(point), kind },
              distance,
              parallel,
              gap: bodyGap(wall, other, group.point, 0.35),
            }
          }
          for (const point of [other.points[0]!, other.points.at(-1)!])
            consider(point, 'endpoint', false)
          const foot = interiorFoot(group.point, other)
          if (foot) {
            const parallel =
              Math.abs(approach.x * foot.direction.y - approach.y * foot.direction.x) < 0.5
            // A straight wall joins a straight body where its own line meets it, never tilting.
            const meet = parallel ? undefined : ownAxisMeet(wall, other)
            consider(meet ?? foot.point, 'body', parallel)
          }
          for (const crossing of sampledCrossings(wall, other)) {
            const distance = Math.hypot(
              crossing.point.x - group.point.x,
              crossing.point.y - group.point.y,
            )
            if (distance <= 0.35 && (!crossingTarget || distance < crossingTarget.distance))
              crossingTarget = {
                candidate: {
                  wallId: other.boundary.id,
                  point: pointToTuple(crossing.point),
                  kind: 'body',
                },
                distance,
                parallel: false,
                gap: 0,
              }
          }
        }
        const target = crossingTarget ?? best
        const reason: OpenWallEnd['reason'] =
          crossingTarget || crosses(wall)
            ? 'crosses'
            : best?.parallel
              ? 'parallel'
              : best && best.gap > JOINT_GAP
                ? 'gap'
                : best
                  ? 'rejected'
                  : 'isolated'
        diagnostics.push({
          wallId: id,
          end: pointKey(pointFromTuple(wall.boundary.start)) === group.key ? 'start' : 'end',
          point: pointToTuple(group.point),
          reason,
          ...(reason === 'gap' && best && Number.isFinite(best.gap) ? { gap: best.gap } : {}),
          ...(target ? { candidate: target.candidate } : {}),
        })
      }
    }
  // Free once joints are elected: a loose end no joint connected.
  const freeEnd = (end: Point2D) => {
    const key = pointKey(end)
    return looseEnd(end) && !tees.has(key) && membersOf(find(key)).size === 1
  }
  return { junctions, freeEnd }
}

export function wallEndJoinCandidates(nodes: Readonly<Record<string, AnyNode>>, levelId: string) {
  const ends: OpenWallEnd[] = []
  nearMissJunctions(
    Object.values(nodes).filter(
      (node): node is BoundaryNode =>
        (node.type === 'wall' || node.type === 'separator') && node.parentId === levelId,
    ),
    true,
    ends,
  )
  return ends
}

/** Separator edges preserve intentional openings after wall deletion; only wall ends are reported. */
export function detectOpenWallEnds(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
): OpenWallEnd[] {
  const boundaries = Object.values(nodes).filter(
    (node): node is BoundaryNode =>
      (node.type === 'wall' || node.type === 'separator') && node.parentId === levelId,
  )
  const joined = extractRoomGraph(boundaries, {}, true, true)
  if (!joined.bodyJoints) return joined.openEnds
  const plain = extractRoomGraph(boundaries, {}, false, true)
  const selected = new Set(keepPlainRoomsWhereLost(plain.rooms, joined.rooms))
  const rejected = new Set(
    plain.rooms
      .filter((room) => selected.has(room) && !joined.rooms.includes(room))
      .flatMap((room) => room.spans.map((span) => span.boundaryId)),
  )
  return [
    ...joined.openEnds.filter((end) => !rejected.has(end.wallId)),
    ...plain.openEnds
      .filter((end) => rejected.has(end.wallId))
      .map((end) => ({ ...end, reason: 'rejected' as const })),
  ].sort((a, b) => a.wallId.localeCompare(b.wallId) || a.end.localeCompare(b.end))
}

/**
 * Rooms enclosed by walls and separators. Joints where drawn wall bodies touch (thick
 * walls, ends inside another wall's body) only ever add or split rooms: wherever they
 * would lose room area the plain junction rules drew, that structure keeps the plain
 * result, so no scene loses a room it had.
 */
export function extractRooms(
  boundaries: BoundaryNode[],
  options: { includeHoles?: boolean } = {},
): ExtractedRoom[] {
  boundaries = boundaries.filter((boundary) => boundary.metadata?.roomBoundary !== false)
  const joined = extractRoomGraph(boundaries, options, true)
  if (!joined.bodyJoints) return joined.rooms
  const plain = extractRoomGraph(boundaries, options, false).rooms
  return keepPlainRoomsWhereLost(plain, joined.rooms)
}

function roomArea(rooms: readonly ExtractedRoom[]) {
  return rooms.map((room) => ({ outer: room.referencePolygon, holes: room.holes }))
}

/** Joints may split rooms or close new ones, never shrink or merge the plain ones. */
function losesRooms(group: { plain: ExtractedRoom[]; joined: ExtractedRoom[] }) {
  try {
    const plain = roomArea(group.plain)
    const joined = roomArea(group.joined)
    if (area(difference(union(plain), union(joined))) > 0.01) return true
    return joined.some(
      (room) => plain.filter((other) => area(intersection(room, other)) > 0.2).length > 1,
    )
  } catch {
    return true
  }
}

function keepPlainRoomsWhereLost(plain: ExtractedRoom[], joined: ExtractedRoom[]) {
  // Structures: rooms of either result that share a boundary.
  const all = [...plain, ...joined]
  const parent = all.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i]!
    return i
  }
  const owner = new Map<string, number>()
  all.forEach((room, i) => {
    for (const span of room.spans) {
      const other = owner.get(span.boundaryId)
      if (other === undefined) owner.set(span.boundaryId, i)
      else parent[find(i)] = find(other)
    }
  })
  const groups = new Map<number, { plain: ExtractedRoom[]; joined: ExtractedRoom[] }>()
  all.forEach((room, i) => {
    const group = groups.get(find(i)) ?? { plain: [], joined: [] }
    ;(i < plain.length ? group.plain : group.joined).push(room)
    groups.set(find(i), group)
  })
  const rooms: ExtractedRoom[] = []
  for (const group of groups.values()) {
    const same =
      group.plain.length === group.joined.length &&
      group.plain.every((room, i) => room.id === group.joined[i]!.id)
    rooms.push(...(!same && group.plain.length && losesRooms(group) ? group.plain : group.joined))
  }
  rooms.sort((a, b) => Math.abs(polygonArea(b.polygon)) - Math.abs(polygonArea(a.polygon)))
  return rooms
}

function extractRoomGraph(
  boundaries: BoundaryNode[],
  { includeHoles = true }: { includeHoles?: boolean },
  bodyJoints: boolean,
  diagnostics = false,
): { rooms: ExtractedRoom[]; bodyJoints: boolean; openEnds: OpenWallEnd[] } {
  if (boundaries.length < 3 && !diagnostics) return { rooms: [], bodyJoints: false, openEnds: [] }
  // Snapped junctions must elect the same representative in migrations,
  // full index rebuilds and incremental edits, independent of map insertion order.
  const walls = [...boundaries].sort((a, b) => a.id.localeCompare(b.id))

  type HalfEdge = {
    id: string
    reverseId: string
    fromKey: string
    toKey: string
    angle: number
    points: Point2D[]
    wallId: BoundaryNode['id']
    face: 'front' | 'back'
  }
  type Node = { point: Point2D; outgoing: string[] }

  const wallById = new Map(walls.map((wall) => [wall.id, wall]))
  const graph = new Map<string, Node>()
  const halfEdges = new Map<string, HalfEdge>()

  const upsertNode = (point: Point2D) => {
    const key = pointKey(point)
    if (!graph.has(key)) {
      graph.set(key, { point: { ...point }, outgoing: [] })
    }
    return key
  }

  // Planarize first: collect every wall endpoint as a candidate graph vertex so
  // straight walls can be split at T-junctions where another wall ends mid-span.
  // Without this the touching wall's endpoint is a dangling degree-1 node and the
  // enclosed area (e.g. a room added against the middle of an existing wall)
  // never forms a cycle.
  const openEnds: OpenWallEnd[] = []
  const { junctions, freeEnd } = nearMissJunctions(
    walls,
    bodyJoints,
    diagnostics ? openEnds : undefined,
  )
  // Whether the body joints change the graph at all: new junctions, or doubled spans
  // dropped where joints connect walls.
  let changed = false
  if (bodyJoints) {
    const plain = nearMissJunctions(walls, false).junctions
    changed =
      plain.size !== junctions.size ||
      [...junctions].some(([key, point]) => {
        const other = plain.get(key)
        return !other || pointKey(other) !== pointKey(point)
      })
  }
  const junction = (tuple: [number, number]) => {
    const point = pointFromTuple(tuple)
    return junctions.get(pointKey(point)) ?? point
  }
  const vertexByKey = new Map<string, JunctionVertex>()
  for (const wall of walls) {
    for (const tuple of [wall.start, wall.end]) {
      const point = junction(tuple)
      const key = pointKey(point)
      const existing = vertexByKey.get(key)
      if (!existing) vertexByKey.set(key, { ...point, wallEndpoint: wall.type === 'wall' })
      else if (wall.type === 'wall') existing.wallEndpoint = true
    }
  }
  const vertices = [...vertexByKey.values()]
  if (bodyJoints) {
    const sampled = walls.map(sampleBoundary)
    const near = spatialIndex(sampled, (item) => item.box)
    for (const wall of sampled)
      for (const other of near(wall.box, 0)) {
        if (wall.boundary.id >= other.boundary.id) continue
        // An end already joined (e.g. onto the crossed wall's body) gets no second vertex at
        // the crossing, which would only double that joint with a sliver.
        for (const { point } of overshootCrossings(wall, other, freeEnd)) {
          vertices.push({ ...point, wallEndpoint: false })
          changed = true
        }
      }
  }

  const nearVertices = spatialIndex(vertices, (vertex) => pointBox(vertex))
  const parts: { wall: BoundaryNode; points: Point2D[]; subIndex: number; snapped: boolean }[] = []
  for (const wall of walls) {
    const start = pointFromTuple(wall.start)
    const end = pointFromTuple(wall.end)
    if (samePointWithinTolerance(start, end)) continue
    const points = sampleWallPointsForRoomDetection(wall)
    const localVertices = [...nearVertices(bboxOf(points), WALL_JUNCTION_TOLERANCE)]

    const subPolylines: Point2D[][] = isCurvedWall(wall)
      ? splitCurvedWallAtVertices(points, localVertices, wall)
      : (() => {
          const ordered = splitStraightWallAtVertices(
            start,
            end,
            localVertices,
            wall.type === 'separator',
          )
          const parts: Point2D[][] = []
          for (let index = 0; index < ordered.length - 1; index += 1) {
            parts.push([ordered[index]!, ordered[index + 1]!])
          }
          return parts
        })()
    // A near-miss end moves onto its junction only after the body is split, so every
    // T-junction found along the wall as drawn stays connected.
    const startJunction = junctions.get(pointKey(start))
    const endJunction = junctions.get(pointKey(end))
    const snapped = new Set<number>()
    if (startJunction && subPolylines.length) {
      subPolylines[0] = [startJunction, ...subPolylines[0]!.slice(1)]
      snapped.add(0)
    }
    if (endJunction && subPolylines.length) {
      subPolylines[subPolylines.length - 1] = [...subPolylines.at(-1)!.slice(0, -1), endJunction]
      snapped.add(subPolylines.length - 1)
    }
    for (const [subIndex, points] of subPolylines.entries())
      parts.push({ wall, points, subIndex, snapped: snapped.has(subIndex) })
  }
  // A moved end never doubles a span another boundary already draws between the same
  // two nodes (e.g. parallel walls a few centimetres apart).
  const pairKey = (points: Point2D[]) => {
    const keys = points.map(pointKey)
    const reversed = [...keys].reverse()
    return (keys.join('|') < reversed.join('|') ? keys : reversed).join('|')
  }
  const drawnPairs = new Set(
    parts.filter((part) => !part.snapped).map((part) => pairKey(part.points)),
  )
  // Where joints connect walls, a span drawn twice (walls stacked on each other) would
  // give two edges with the same angle at a node, and the face walk could cut through
  // rooms: keep one per span there. Elsewhere the graph stays exactly as drawn.
  const componentOf = new Map<string, string>()
  const root = (key: string): string => {
    const next = componentOf.get(key)
    if (!next || next === key) return key
    const found = root(next)
    componentOf.set(key, found)
    return found
  }
  for (const { points } of parts) {
    const a = root(pointKey(points[0]!))
    const b = root(pointKey(points.at(-1)!))
    if (a !== b) componentOf.set(a, b)
  }
  const joined = new Set(
    bodyJoints ? [...junctions.values()].map((point) => root(pointKey(point))) : [],
  )
  const seenPairs = new Set<string>()
  for (const { wall, points, subIndex, snapped } of parts) {
    const pair = pairKey(points)
    if (snapped && drawnPairs.has(pair)) continue
    if (joined.has(root(pointKey(points[0]!)))) {
      if (seenPairs.has(pair)) {
        changed = true
        continue
      }
      seenPairs.add(pair)
    }
    const from = points[0]!
    const to = points[points.length - 1]!
    const fromKey = upsertNode(from)
    const toKey = upsertNode(to)
    if (fromKey === toKey) continue

    const reversePoints = [...points].reverse()
    const forwardId = `${wall.id}#${subIndex}:f`
    const reverseId = `${wall.id}#${subIndex}:r`

    halfEdges.set(forwardId, {
      id: forwardId,
      reverseId,
      fromKey,
      toKey,
      angle: Math.atan2(points[1]!.y - from.y, points[1]!.x - from.x),
      points,
      wallId: wall.id,
      face: 'front',
    })
    halfEdges.set(reverseId, {
      id: reverseId,
      reverseId: forwardId,
      fromKey: toKey,
      toKey: fromKey,
      angle: Math.atan2(reversePoints[1]!.y - to.y, reversePoints[1]!.x - to.x),
      points: reversePoints,
      wallId: wall.id,
      face: 'back',
    })

    graph.get(fromKey)?.outgoing.push(forwardId)
    graph.get(toKey)?.outgoing.push(reverseId)
  }

  const sortedOutgoing = new Map<string, string[]>()
  for (const [key, node] of graph.entries()) {
    const outgoing = [...node.outgoing]
    outgoing.sort((a, b) => (halfEdges.get(a)?.angle ?? 0) - (halfEdges.get(b)?.angle ?? 0))
    sortedOutgoing.set(key, outgoing)
  }

  const nextEdge = (edgeId: string) => {
    const edge = halfEdges.get(edgeId)
    if (!edge) return null

    const outgoing = sortedOutgoing.get(edge.toKey)
    if (!outgoing || outgoing.length === 0) return null

    const idx = outgoing.indexOf(edge.reverseId)
    if (idx === -1) return null

    const nextIdx = (idx - 1 + outgoing.length) % outgoing.length
    return outgoing[nextIdx] ?? null
  }

  const splitIntoSimpleCycles = (walkEdgeIds: string[]) => {
    const cycles: string[][] = []
    const firstEdge = halfEdges.get(walkEdgeIds[0] ?? '')
    if (!firstEdge) return cycles

    const pathEdges: string[] = []
    const pathVertices = [firstEdge.fromKey]
    const vertexIndex = new Map([[firstEdge.fromKey, 0]])

    for (const edgeId of walkEdgeIds) {
      const edge = halfEdges.get(edgeId)
      if (!edge || edge.fromKey !== pathVertices[pathVertices.length - 1]) return []

      pathEdges.push(edgeId)
      const repeatedIndex = vertexIndex.get(edge.toKey)
      if (repeatedIndex === undefined) {
        pathVertices.push(edge.toKey)
        vertexIndex.set(edge.toKey, pathVertices.length - 1)
        continue
      }

      const cycle = pathEdges.slice(repeatedIndex)
      if (cycle.length >= 3) cycles.push(cycle)

      for (let index = repeatedIndex + 1; index < pathVertices.length; index += 1) {
        vertexIndex.delete(pathVertices[index]!)
      }
      pathVertices.length = repeatedIndex + 1
      pathEdges.length = repeatedIndex
    }

    return pathEdges.length === 0 && pathVertices.length === 1 ? cycles : []
  }

  const visitedDirected = new Set<string>()
  const rooms: ExtractedRoom[] = []
  const innerCycles: ExtractedRoom[] = []
  // A face walk cannot revisit a half-edge, so the half-edge count bounds its
  // length. It can revisit a vertex when dangling walls or other graph bridges
  // are traced out and back; those excursions are removed below.
  const maxSteps = Math.min(2000, halfEdges.size + 10)

  for (const edgeId of halfEdges.keys()) {
    if (visitedDirected.has(edgeId)) continue

    const cycleEdgeIds: string[] = []
    let currentEdgeId = edgeId
    let valid = true
    let closed = false

    for (let step = 0; step < maxSteps; step += 1) {
      const currentEdge = halfEdges.get(currentEdgeId)
      if (!currentEdge) {
        valid = false
        break
      }

      visitedDirected.add(currentEdgeId)
      cycleEdgeIds.push(currentEdgeId)

      const next = nextEdge(currentEdgeId)
      if (!next) {
        valid = false
        break
      }

      currentEdgeId = next
      if (currentEdgeId === edgeId) {
        closed = true
        break
      }
    }

    if (!(valid && closed) || cycleEdgeIds.length < 3) continue

    for (const simpleCycleEdgeIds of splitIntoSimpleCycles(cycleEdgeIds)) {
      const bodyEdges = simpleCycleEdgeIds.map((id) => {
        const edge = halfEdges.get(id)!
        return { wall: wallById.get(edge.wallId)!, points: edge.points }
      })
      const polygon = bodyEdges.some(
        ({ wall }) => wall.type === 'wall' && wall.justification !== undefined,
      )
        ? roomBodyPolygon(bodyEdges)
        : dedupeSequentialPoints(
            simpleCycleEdgeIds.flatMap((id, index) => {
              const points = halfEdges.get(id)?.points ?? []
              return index === simpleCycleEdgeIds.length - 1 ? points : points.slice(0, -1)
            }),
          )

      if (polygon.length < 3) continue

      const referencePoints = dedupeSequentialPoints(
        simpleCycleEdgeIds.flatMap((id) => halfEdges.get(id)!.points.slice(0, -1)),
      ).map(pointToTuple)

      // Room identity must not change when wall thickness or justification changes.
      const signedArea = polygonArea(referencePoints.map(pointFromTuple))
      if (signedArea <= 0 && !includeHoles) continue
      const minArea = bodyEdges.every(({ wall }) => wall.type === 'separator') ? 0.25 : 0.5
      if (Math.abs(signedArea) < minArea - 1e-9 || Math.abs(signedArea) > 10_000) continue

      const cycles = signedArea > 0 ? rooms : innerCycles
      const signature = polygonSignature(polygon)
      if (cycles.some((room) => polygonSignature(room.polygon) === signature)) continue

      let first = 0
      for (let i = 1; i < referencePoints.length; i++) {
        const p = referencePoints[i]!,
          q = referencePoints[first]!
        if (p[0] < q[0] || (p[0] === q[0] && p[1] < q[1])) first = i
      }
      const referencePolygon = [...referencePoints.slice(first), ...referencePoints.slice(0, first)]
      const roomId = `room-${polygonSignature(referencePolygon.map(pointFromTuple))}`
      const spans: BoundarySpan[] = simpleCycleEdgeIds.map((id) => {
        const edge = halfEdges.get(id)!
        const boundary = wallById.get(edge.wallId)!
        const start = pointFromTuple(boundary.start)
        const end = pointFromTuple(boundary.end)
        const from = segmentProjection(edge.points[0]!, start, end).t
        const to = segmentProjection(edge.points.at(-1)!, start, end).t
        return {
          roomId,
          boundaryId: boundary.id,
          kind: boundary.type,
          face: edge.face === 'front' ? 'a' : 'b',
          t0: Math.max(0, Math.min(1, Math.min(from, to))),
          t1: Math.max(0, Math.min(1, Math.max(from, to))),
        }
      })
      spans.sort(
        (a, b) =>
          a.boundaryId.localeCompare(b.boundaryId) || a.face.localeCompare(b.face) || a.t0 - b.t0,
      )
      cycles.push({
        id: roomId,
        referencePolygon,
        holes: [],
        spans,
        polygon,
        boundaryFaces: simpleCycleEdgeIds.flatMap((id) => {
          const edge = halfEdges.get(id)
          if (!edge || wallById.get(edge.wallId)?.type !== 'wall') return []
          return [
            {
              wallId: edge.wallId as WallNode['id'],
              face: edge.face,
              points: edge.points.map(pointToTuple),
            },
          ]
        }),
      })
    }
  }

  const shells = rooms
    .map((room) => ({
      room,
      area: Math.abs(polygonArea(room.referencePolygon.map(pointFromTuple))),
      bbox: bboxOf(room.referencePolygon.map(pointFromTuple)),
    }))
    .sort((a, b) => a.area - b.area || a.room.id.localeCompare(b.room.id))
  for (const cycle of innerCycles) {
    const ring = cycle.referencePolygon
    const cycleArea = Math.abs(polygonArea(ring.map(pointFromTuple)))
    const bounds = bboxOf(ring.map(pointFromTuple))
    const containing = shells.find(
      (shell) =>
        shell.area > cycleArea + 1e-6 &&
        // The reverse walk of the same boundary is the exterior, even when
        // snapped endpoints give it a slightly smaller numerical area.
        !shell.room.spans.some((outer) =>
          cycle.spans.some(
            (inner) =>
              outer.boundaryId === inner.boundaryId &&
              Math.min(outer.t1, inner.t1) - Math.max(outer.t0, inner.t0) > 1e-8,
          ),
        ) &&
        shell.bbox.minX <= bounds.minX &&
        shell.bbox.minY <= bounds.minY &&
        shell.bbox.maxX >= bounds.maxX &&
        shell.bbox.maxY >= bounds.maxY &&
        area(difference(ring, shell.room.referencePolygon)) < 1e-6,
    )?.room
    if (!containing) continue
    containing.holes.push(ring)
    containing.boundaryFaces.push(...cycle.boundaryFaces)
    containing.spans.push(...cycle.spans.map((span) => ({ ...span, roomId: containing.id })))
  }
  for (const room of rooms) {
    room.holes.sort((a, b) =>
      polygonSignature(a.map(pointFromTuple)).localeCompare(
        polygonSignature(b.map(pointFromTuple)),
      ),
    )
    room.spans.sort(
      (a, b) =>
        a.boundaryId.localeCompare(b.boundaryId) || a.face.localeCompare(b.face) || a.t0 - b.t0,
    )
  }

  rooms.sort((a, b) => Math.abs(polygonArea(b.polygon)) - Math.abs(polygonArea(a.polygon)))
  return {
    rooms,
    bodyJoints: changed,
    openEnds: openEnds.filter((end) => {
      const point = junctions.get(pointKey(pointFromTuple(end.point))) ?? pointFromTuple(end.point)
      const node = graph.get(pointKey(point))
      return !node || new Set(node.outgoing.map((id) => halfEdges.get(id)!.wallId)).size < 2
    }),
  }
}

export type RoomFace = {
  /** Canonical face id (the extracted room id), stable across callers' face order. */
  key: string
  polygon: Ring
  holes: Ring[]
  boundaryWallIds: WallNode['id'][]
  boundarySeparatorIds: SeparatorNode['id'][]
}

export function detectRoomFaces(
  levelWalls: WallNode[],
  levelSeparators: SeparatorNode[] = [],
): RoomFace[] {
  return extractRooms(
    [...levelWalls, ...levelSeparators].sort((a, b) => a.id.localeCompare(b.id)),
  ).map((room) => ({
    key: room.id,
    polygon: room.referencePolygon,
    holes: room.holes,
    boundaryWallIds: [
      ...new Set(
        room.spans
          .filter((span) => span.kind === 'wall')
          .map((span) => span.boundaryId as WallNode['id']),
      ),
    ].sort(),
    boundarySeparatorIds: [
      ...new Set(
        room.spans
          .filter((span) => span.kind === 'separator')
          .map((span) => span.boundaryId as SeparatorNode['id']),
      ),
    ].sort(),
  }))
}
