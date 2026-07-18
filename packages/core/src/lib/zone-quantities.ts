import type { AnyNode, CeilingNode, SlabNode, WallNode, ZoneNode } from '../schema'
import { sampleWallCenterline } from '../systems/wall/wall-curve'
import { DEFAULT_WALL_HEIGHT } from '../systems/wall/wall-footprint'
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
  return true
}

function polygonsHaveInteriorOverlap(a: readonly Point2D[], b: readonly Point2D[]): boolean {
  if (polygonsDescribeSameRegion(a, b)) return true
  if (a.some((point) => pointInPolygon(point, b, false))) return true
  if (b.some((point) => pointInPolygon(point, a, false))) return true
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

function spansFromSpace(space: Space, wallsById: ReadonlyMap<string, WallNode>) {
  const spans: BoundaryWallSpan[] = []
  for (const boundary of space.boundaryFaces) {
    const wall = wallsById.get(boundary.wallId)
    if (!wall) return null
    let length = 0
    for (let index = 0; index < boundary.points.length - 1; index += 1) {
      length += pointDistance(boundary.points[index]!, boundary.points[index + 1]!)
    }
    if (length <= 1e-6) return null
    spans.push({ wall, length })
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

type SurfaceCoverage<T extends SlabNode | CeilingNode> = {
  node: T
  area: number | null
  issue?: string
}

function coveringSurfaceNodes<T extends SlabNode | CeilingNode>(
  zone: ZoneNode,
  nodes: readonly T[],
): SurfaceCoverage<T>[] {
  const surfaces: SurfaceCoverage<T>[] = []
  for (const node of nodes) {
    if (!polygonContainsRegion(node.polygon, zone.polygon)) continue
    let area = polygonArea(zone.polygon)
    let issue: string | undefined
    for (const hole of node.holes) {
      if (polygonContainsRegion(hole, zone.polygon)) {
        issue = 'A surface opening removes this zone.'
        break
      } else if (polygonContainsRegion(zone.polygon, hole)) {
        area -= polygonArea(hole)
      } else if (polygonsHaveInteriorOverlap(zone.polygon, hole)) {
        issue = 'A surface opening crosses the zone boundary.'
        break
      }
    }
    surfaces.push(issue ? { node, area: null, issue } : { node, area: Math.max(0, area) })
  }
  return surfaces
}

function unavailable(reason: string): ZoneQuantityValue {
  return { status: 'unavailable', reason }
}

export function deriveZoneQuantityReport(
  zone: ZoneNode,
  sceneNodes: Record<string, AnyNode>,
): ZoneQuantityReport {
  const levelId = zone.parentId
  const levelNodes = levelId
    ? Object.values(sceneNodes).filter((node) => node.parentId === levelId)
    : []
  const walls = levelNodes.filter((node): node is WallNode => node.type === 'wall')
  const edgeLengths = zone.polygon.map((start, index) => {
    const end = zone.polygon[(index + 1) % zone.polygon.length]
    return end ? pointDistance(start, end) : 0
  })
  const footprintArea = polygonArea(zone.polygon)
  const perimeter = edgeLengths.reduce((sum, length) => sum + length, 0)
  const slabs = coveringSurfaceNodes(
    zone,
    levelNodes.filter((node): node is SlabNode => node.type === 'slab'),
  )
  const ceilings = coveringSurfaceNodes(
    zone,
    levelNodes.filter((node): node is CeilingNode => node.type === 'ceiling'),
  )

  const spaces = levelId ? detectSpacesForLevel(levelId, walls).spaces : []
  const matchingSpace = spaces.find((space) =>
    polygonsDescribeSameRegion(zone.polygon, space.polygon),
  )
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const wallPaths = wallPathsFor(walls)
  const wallSpans =
    (matchingSpace ? spansFromSpace(matchingSpace, wallsById) : null) ??
    spansFromZoneBoundary(zone, wallPaths)
  const allWallsProven = Boolean(wallSpans)
  const boundaryWallIds = wallSpans ? [...new Set(wallSpans.map((span) => span.wall.id))] : []

  const wallSurface = allWallsProven
    ? {
        status: 'available' as const,
        value: wallSpans!.reduce(
          (sum, span) => sum + span.length * (span.wall.height ?? DEFAULT_WALL_HEIGHT),
          0,
        ),
        note: "Gross interior wall face using each boundary wall's height.",
      }
    : unavailable('The zone boundary is not fully backed by walls.')

  const matchingSlab = slabs.length === 1 ? slabs[0] : undefined
  const floorSurface =
    matchingSlab && matchingSlab.area !== null
      ? {
          status: 'available' as const,
          value: matchingSlab.area,
          note: 'Zone floor surface covered by one slab, after openings.',
        }
      : unavailable(
          slabs.length > 1
            ? 'More than one slab covers this zone.'
            : (matchingSlab?.issue ?? 'No slab covers this zone.'),
        )

  const matchingCeiling = ceilings.length === 1 ? ceilings[0] : undefined
  let volume: ZoneQuantityValue
  if (!wallSpans) {
    volume = unavailable('The zone boundary is not fully backed by walls.')
  } else if (!matchingSlab || matchingSlab.area === null) {
    volume = unavailable(floorSurface.status === 'unavailable' ? floorSurface.reason : 'No floor.')
  } else if (!matchingCeiling || matchingCeiling.area === null) {
    volume = unavailable(
      ceilings.length > 1
        ? 'More than one ceiling covers this zone.'
        : (matchingCeiling?.issue ?? 'No ceiling covers this zone.'),
    )
  } else {
    const clearHeight = matchingCeiling.node.height - matchingSlab.node.elevation
    volume =
      Number.isFinite(clearHeight) && clearHeight > 0
        ? {
            status: 'available',
            value: matchingSlab.area * clearHeight,
            note: 'Covered zone floor area multiplied by clear ceiling height.',
          }
        : unavailable('The matching ceiling is not above the slab surface.')
  }

  return {
    classification: wallSpans ? 'enclosed-room' : 'footprint',
    footprintArea,
    perimeter,
    edgeLengths,
    boundaryWallIds,
    wallSurface,
    floorSurface,
    volume,
  }
}
