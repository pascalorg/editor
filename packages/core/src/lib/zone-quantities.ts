import type { AnyNode, CeilingNode, SlabNode, WallNode, ZoneNode } from '../schema'
import type { AnyNodeId } from '../schema/types'
import { DEFAULT_LEVEL_HEIGHT, resolveCeilingHeight } from '../services/level-height'
import { getWallPlaneTop } from '../services/storey'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { sampleWallCenterline } from '../systems/wall/wall-curve'
import { DEFAULT_WALL_THICKNESS } from '../systems/wall/wall-footprint'
import { resolveWallEffectiveHeight } from '../systems/wall/wall-top'
import { detectSpacesForLevel, type Space } from './space-detection'

type Point2D = readonly [number, number]

export type ZoneQuantityValue =
  | { status: 'available'; value: number; note?: string }
  | { status: 'unavailable'; reason: string }

export type ZoneQuantityReport = {
  classification: 'footprint' | 'enclosed-room'
  footprintArea: number
  perimeter: number
  edgeLengths: number[]
  boundaryWallIds: string[]
  wallSurface: ZoneQuantityValue
  floorSurface: ZoneQuantityValue
  volume: ZoneQuantityValue
}

const BOUNDARY_TOLERANCE = 0.08
const SURFACE_COVERAGE_THRESHOLD = 0.95
const SPACE_CONTAINMENT_THRESHOLD = 0.95
const COVERAGE_SAMPLE_STEPS = 24
const SURFACE_DATUM_EPSILON = 1e-4

function pointDistance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function pointToSegmentDistance(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-12) return pointDistance(point, start)

  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  )
  return pointDistance(point, [start[0] + t * dx, start[1] + t * dy])
}

function pointToPolygonBoundaryDistance(point: Point2D, polygon: readonly Point2D[]): number {
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!(start && end)) continue
    best = Math.min(best, pointToSegmentDistance(point, start, end))
  }
  return best
}

function signedPolygonArea(polygon: readonly Point2D[]): number {
  let area = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!(start && end)) continue
    area += start[0] * end[1] - end[0] * start[1]
  }
  return area / 2
}

function polygonArea(polygon: readonly Point2D[]): number {
  return Math.abs(signedPolygonArea(polygon))
}

function polygonsDescribeSameRegion(a: readonly Point2D[], b: readonly Point2D[]): boolean {
  if (a.length < 3 || b.length < 3) return false

  const aArea = polygonArea(a)
  const bArea = polygonArea(b)
  const areaTolerance = Math.max(0.02, Math.max(aArea, bArea) * 0.01)
  if (Math.abs(aArea - bArea) > areaTolerance) return false

  return (
    a.every((point) => pointToPolygonBoundaryDistance(point, b) <= BOUNDARY_TOLERANCE) &&
    b.every((point) => pointToPolygonBoundaryDistance(point, a) <= BOUNDARY_TOLERANCE)
  )
}

function pointInPolygon(point: Point2D, polygon: readonly Point2D[], includeBoundary = true) {
  if (polygon.length < 3) return false
  if (pointToPolygonBoundaryDistance(point, polygon) <= 1e-6) return includeBoundary

  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]!
    const previousPoint = polygon[previous]!
    if (
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

function segmentsCrossProperly(a: Point2D, b: Point2D, c: Point2D, d: Point2D) {
  const cross = (start: Point2D, end: Point2D, point: Point2D) =>
    (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  return abC * abD < -1e-12 && cdA * cdB < -1e-12
}

function polygonContainsRegion(outer: readonly Point2D[], inner: readonly Point2D[]): boolean {
  if (outer.length < 3 || inner.length < 3) return false
  if (polygonsDescribeSameRegion(outer, inner)) return true
  if (
    !inner.every(
      (point) =>
        pointInPolygon(point, outer) ||
        pointToPolygonBoundaryDistance(point, outer) <= BOUNDARY_TOLERANCE,
    )
  ) {
    return false
  }

  for (let innerIndex = 0; innerIndex < inner.length; innerIndex += 1) {
    const innerStart = inner[innerIndex]!
    const innerEnd = inner[(innerIndex + 1) % inner.length]!
    for (let outerIndex = 0; outerIndex < outer.length; outerIndex += 1) {
      if (
        segmentsCrossProperly(
          innerStart,
          innerEnd,
          outer[outerIndex]!,
          outer[(outerIndex + 1) % outer.length]!,
        )
      ) {
        return false
      }
    }
  }

  return inner.some((start, index) => {
    const end = inner[(index + 1) % inner.length]!
    const midpoint: Point2D = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    return pointInPolygon(start, outer, false) || pointInPolygon(midpoint, outer, false)
  })
}

function polygonsHaveInteriorOverlap(a: readonly Point2D[], b: readonly Point2D[]): boolean {
  if (polygonsDescribeSameRegion(a, b)) return true
  if (
    a.some((point, index) => {
      const end = a[(index + 1) % a.length]!
      return (
        pointInPolygon(point, b, false) ||
        pointInPolygon([(point[0] + end[0]) / 2, (point[1] + end[1]) / 2], b, false)
      )
    })
  ) {
    return true
  }
  if (
    b.some((point, index) => {
      const end = b[(index + 1) % b.length]!
      return (
        pointInPolygon(point, a, false) ||
        pointInPolygon([(point[0] + end[0]) / 2, (point[1] + end[1]) / 2], a, false)
      )
    })
  ) {
    return true
  }
  for (let aIndex = 0; aIndex < a.length; aIndex += 1) {
    for (let bIndex = 0; bIndex < b.length; bIndex += 1) {
      if (
        segmentsCrossProperly(
          a[aIndex]!,
          a[(aIndex + 1) % a.length]!,
          b[bIndex]!,
          b[(bIndex + 1) % b.length]!,
        )
      ) {
        return true
      }
    }
  }
  return false
}

function polygonCoverageRatio(subject: readonly Point2D[], covers: readonly Point2D[][]): number {
  if (subject.length < 3 || covers.length === 0) return 0

  const xs = subject.map((point) => point[0])
  const ys = subject.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  if (maxX - minX <= 1e-9 || maxY - minY <= 1e-9) return 0

  let inside = 0
  let covered = 0
  for (let xIndex = 0; xIndex < COVERAGE_SAMPLE_STEPS; xIndex += 1) {
    for (let yIndex = 0; yIndex < COVERAGE_SAMPLE_STEPS; yIndex += 1) {
      const point: Point2D = [
        minX + ((xIndex + 0.5) / COVERAGE_SAMPLE_STEPS) * (maxX - minX),
        minY + ((yIndex + 0.5) / COVERAGE_SAMPLE_STEPS) * (maxY - minY),
      ]
      if (!pointInPolygon(point, subject)) continue
      inside += 1
      if (covers.some((cover) => pointInPolygon(point, cover))) covered += 1
    }
  }

  return inside > 0 ? covered / inside : 0
}

function pointToPolylineDistance(point: Point2D, polyline: readonly Point2D[]): number {
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index]
    const end = polyline[index + 1]
    if (!(start && end)) continue
    best = Math.min(best, pointToSegmentDistance(point, start, end))
  }
  return best
}

type WallPath = { wall: WallNode; points: Point2D[] }
type BoundaryWallSpan = { wall: WallNode; length: number }

function wallForBoundarySegment(
  start: Point2D,
  end: Point2D,
  wallPaths: readonly WallPath[],
): WallNode | null {
  const midpoint: Point2D = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  let best: { wall: WallNode; distance: number } | null = null

  for (const { wall, points } of wallPaths) {
    const distances = [start, midpoint, end].map((point) => pointToPolylineDistance(point, points))
    if (distances.some((distance) => distance > BOUNDARY_TOLERANCE)) continue

    const distance = distances.reduce((sum, value) => sum + value, 0)
    if (!best || distance < best.distance) best = { wall, distance }
  }

  return best?.wall ?? null
}

function wallPathsFor(walls: readonly WallNode[]): WallPath[] {
  return walls.map((wall) => ({
    wall,
    points: sampleWallCenterline(wall, 32).map((point) => [point.x, point.y] as Point2D),
  }))
}

function pointAlongSegment(start: Point2D, end: Point2D, t: number): Point2D {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
}

function segmentParameter(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  return lengthSquared <= 1e-12
    ? 0
    : ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared
}

function segmentLengthInsideOrNearPolygon(
  start: Point2D,
  end: Point2D,
  polygon: readonly Point2D[],
  tolerance: number,
): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  if (length <= 1e-9) return 0

  const breaks = [0, 1]
  for (let index = 0; index < polygon.length; index += 1) {
    const polygonStart = polygon[index]!
    const polygonEnd = polygon[(index + 1) % polygon.length]!
    const edgeX = polygonEnd[0] - polygonStart[0]
    const edgeY = polygonEnd[1] - polygonStart[1]
    const denominator = dx * edgeY - dy * edgeX
    if (Math.abs(denominator) > 1e-12) {
      const t =
        ((polygonStart[0] - start[0]) * edgeY - (polygonStart[1] - start[1]) * edgeX) / denominator
      const edgeT =
        ((polygonStart[0] - start[0]) * dy - (polygonStart[1] - start[1]) * dx) / denominator
      if (t > 0 && t < 1 && edgeT >= -1e-9 && edgeT <= 1 + 1e-9) breaks.push(t)
    }

    if (pointToSegmentDistance(polygonStart, start, end) <= tolerance) {
      const projected = segmentParameter(polygonStart, start, end)
      if (projected > 0 && projected < 1) breaks.push(projected)
    }
  }

  breaks.sort((a, b) => a - b)
  const uniqueBreaks = breaks.filter(
    (value, index) => index === 0 || value - breaks[index - 1]! > 1e-7,
  )
  let insideLength = 0
  for (let index = 0; index < uniqueBreaks.length - 1; index += 1) {
    const t0 = uniqueBreaks[index]!
    const t1 = uniqueBreaks[index + 1]!
    const midpoint = pointAlongSegment(start, end, (t0 + t1) / 2)
    if (
      pointInPolygon(midpoint, polygon) ||
      pointToPolygonBoundaryDistance(midpoint, polygon) <= tolerance
    ) {
      insideLength += length * (t1 - t0)
    }
  }
  return insideLength
}

function boundaryFaceKey(boundary: Space['boundaryFaces'][number]): string {
  const pointKey = (point: Point2D) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`
  const forward = boundary.points.map(pointKey).join('|')
  const reverse = [...boundary.points].reverse().map(pointKey).join('|')
  return `${boundary.wallId}:${boundary.face}:${forward < reverse ? forward : reverse}`
}

function spansFromSpaces(
  spaces: readonly Space[],
  zone: ZoneNode,
  wallsById: ReadonlyMap<string, WallNode>,
) {
  const spans: BoundaryWallSpan[] = []
  const seen = new Set<string>()
  for (const space of spaces) {
    for (const boundary of space.boundaryFaces) {
      const key = boundaryFaceKey(boundary)
      if (seen.has(key)) continue
      seen.add(key)

      const wall = wallsById.get(boundary.wallId)
      if (!wall) return null
      const tolerance = (wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2 + BOUNDARY_TOLERANCE
      let length = 0
      for (let index = 0; index < boundary.points.length - 1; index += 1) {
        length += segmentLengthInsideOrNearPolygon(
          boundary.points[index]!,
          boundary.points[index + 1]!,
          zone.polygon,
          tolerance,
        )
      }
      if (length > 1e-6) spans.push({ wall, length })
    }
  }
  return spans.length > 0 ? spans : null
}

function spansFromZoneBoundary(zone: ZoneNode, wallPaths: readonly WallPath[]) {
  const spans: BoundaryWallSpan[] = []
  for (let edgeIndex = 0; edgeIndex < zone.polygon.length; edgeIndex += 1) {
    const start = zone.polygon[edgeIndex]!
    const end = zone.polygon[(edgeIndex + 1) % zone.polygon.length]!
    const edgeLength = pointDistance(start, end)
    if (edgeLength <= 1e-6) continue

    const breaks = [0, 1]
    for (const path of wallPaths) {
      for (const point of path.points) {
        if (pointToSegmentDistance(point, start, end) > BOUNDARY_TOLERANCE) continue
        const t = segmentParameter(point, start, end)
        if (t > 0 && t < 1) breaks.push(t)
      }
    }
    breaks.sort((a, b) => a - b)
    const uniqueBreaks = breaks.filter(
      (value, index) => index === 0 || value - breaks[index - 1]! > 1e-6,
    )

    for (let index = 0; index < uniqueBreaks.length - 1; index += 1) {
      const t0 = uniqueBreaks[index]!
      const t1 = uniqueBreaks[index + 1]!
      if (t1 - t0 <= 1e-6) continue
      const spanStart = pointAlongSegment(start, end, t0)
      const spanEnd = pointAlongSegment(start, end, t1)
      const wall = wallForBoundarySegment(spanStart, spanEnd, wallPaths)
      if (!wall) return null
      spans.push({ wall, length: edgeLength * (t1 - t0) })
    }
  }
  return spans.length > 0 ? spans : null
}

type SurfaceCoverage<T extends SlabNode | CeilingNode> =
  | { status: 'available'; area: number; datum: number }
  | { status: 'unavailable'; reason: string }

function proveSurfaceCoverage<T extends SlabNode | CeilingNode>(
  zone: ZoneNode,
  nodes: readonly T[],
  getDatum: (node: T) => number,
  labels: { singular: string; plural: string; datum: string },
): SurfaceCoverage<T> {
  const candidates = nodes.filter(
    (node) =>
      polygonsHaveInteriorOverlap(zone.polygon, node.polygon) &&
      polygonCoverageRatio(zone.polygon, [node.polygon]) > 0,
  )
  if (
    candidates.length === 0 ||
    polygonCoverageRatio(
      zone.polygon,
      candidates.map((node) => node.polygon),
    ) < SURFACE_COVERAGE_THRESHOLD
  ) {
    return { status: 'unavailable', reason: `No ${labels.singular} coverage proves this zone.` }
  }

  const datum = getDatum(candidates[0]!)
  if (
    !Number.isFinite(datum) ||
    candidates.some((node) => Math.abs(getDatum(node) - datum) > SURFACE_DATUM_EPSILON)
  ) {
    return {
      status: 'unavailable',
      reason: `${labels.plural} covering this zone have different ${labels.datum}.`,
    }
  }

  let area = polygonArea(zone.polygon)
  const seenHoles = new Set<string>()
  for (const node of candidates) {
    for (const hole of node.holes) {
      const forward = hole.map((point) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`).join('|')
      const reverse = [...hole]
        .reverse()
        .map((point) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`)
        .join('|')
      const key = forward < reverse ? forward : reverse
      if (seenHoles.has(key)) continue
      seenHoles.add(key)

      if (polygonContainsRegion(hole, zone.polygon)) {
        return { status: 'unavailable', reason: 'A surface opening removes this zone.' }
      }
      if (polygonContainsRegion(zone.polygon, hole)) {
        area -= polygonArea(hole)
      } else if (polygonsHaveInteriorOverlap(zone.polygon, hole)) {
        return { status: 'unavailable', reason: 'A surface opening crosses the zone boundary.' }
      }
    }
  }

  return { status: 'available', area: Math.max(0, area), datum }
}

function unavailable(reason: string): ZoneQuantityValue {
  return { status: 'unavailable', reason }
}

export function deriveZoneQuantityReport(
  zone: ZoneNode,
  sceneNodes: Readonly<Record<string, AnyNode>>,
): ZoneQuantityReport {
  const levelId = zone.parentId
  const levelNodes = levelId
    ? Object.values(sceneNodes).filter((node) => node.parentId === levelId)
    : []
  const walls = levelNodes.filter((node): node is WallNode => node.type === 'wall')
  const slabs = levelNodes.filter((node): node is SlabNode => node.type === 'slab')
  const wallEffectiveHeight = (wall: WallNode) => {
    const support = computeWallSlabSupport(wall, slabs, walls, wall.supportSlabId)
    const planeTop = levelId ? getWallPlaneTop(wall, levelId, sceneNodes) : DEFAULT_LEVEL_HEIGHT
    return resolveWallEffectiveHeight(wall, planeTop, support.elevation)
  }
  const edgeLengths = zone.polygon.map((start, index) => {
    const end = zone.polygon[(index + 1) % zone.polygon.length]
    return end ? pointDistance(start, end) : 0
  })
  const footprintArea = polygonArea(zone.polygon)
  const perimeter = edgeLengths.reduce((sum, length) => sum + length, 0)
  const slabCoverage = proveSurfaceCoverage(
    zone,
    levelNodes.filter((node): node is SlabNode => node.type === 'slab'),
    (node) => node.elevation,
    { singular: 'slab', plural: 'Slabs', datum: 'elevations' },
  )
  const ceilingCoverage = proveSurfaceCoverage(
    zone,
    levelNodes.filter((node): node is CeilingNode => node.type === 'ceiling'),
    (node) => resolveCeilingHeight(node, sceneNodes as Record<AnyNodeId, AnyNode>),
    { singular: 'ceiling', plural: 'Ceilings', datum: 'heights' },
  )

  const spaces = levelId ? detectSpacesForLevel(levelId, walls).spaces : []
  const overlappingSpaces = spaces.filter((space) =>
    polygonsHaveInteriorOverlap(zone.polygon, space.polygon),
  )
  const topologyEnclosesZone =
    overlappingSpaces.length > 0 &&
    polygonCoverageRatio(
      zone.polygon,
      overlappingSpaces.map((space) => space.polygon),
    ) >= SPACE_CONTAINMENT_THRESHOLD &&
    overlappingSpaces.every(
      (space) => polygonCoverageRatio(space.polygon, [zone.polygon]) >= SPACE_CONTAINMENT_THRESHOLD,
    )
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const wallPaths = wallPathsFor(walls)
  const topologyWallSpans = spansFromSpaces(overlappingSpaces, zone, wallsById)
  const boundaryWallSpans = spansFromZoneBoundary(zone, wallPaths)
  const wallSpans = topologyWallSpans ?? boundaryWallSpans
  const allWallsProven = Boolean(wallSpans)
  const boundaryWallIds = wallSpans ? [...new Set(wallSpans.map((span) => span.wall.id))] : []

  const wallSurface = allWallsProven
    ? {
        status: 'available' as const,
        value: wallSpans!.reduce(
          (sum, span) => sum + span.length * wallEffectiveHeight(span.wall),
          0,
        ),
        note: 'Gross indoor-facing wall surface within this zone, including both sides of interior partitions.',
      }
    : unavailable('No indoor-facing wall surface is proven within this zone.')

  const floorSurface =
    slabCoverage.status === 'available'
      ? {
          status: 'available' as const,
          value: slabCoverage.area,
          note: 'Zone floor surface proven by compatible slab coverage, after openings.',
        }
      : unavailable(slabCoverage.reason)

  let volume: ZoneQuantityValue
  if (slabCoverage.status === 'unavailable') {
    volume = unavailable(slabCoverage.reason)
  } else if (ceilingCoverage.status === 'unavailable') {
    volume = unavailable(ceilingCoverage.reason)
  } else {
    const clearHeight = ceilingCoverage.datum - slabCoverage.datum
    volume =
      Number.isFinite(clearHeight) && clearHeight > 0
        ? {
            status: 'available',
            value: slabCoverage.area * clearHeight,
            note: 'Proven zone floor area multiplied by clear ceiling height.',
          }
        : unavailable('The matching ceiling is not above the slab surface.')
  }

  return {
    classification: topologyEnclosesZone || boundaryWallSpans ? 'enclosed-room' : 'footprint',
    footprintArea,
    perimeter,
    edgeLengths,
    boundaryWallIds,
    wallSurface,
    floorSurface,
    volume,
  }
}
