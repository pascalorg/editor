import type { AnyNode, CeilingNode, SlabNode, WallNode, ZoneNode } from '../schema'
import { sampleWallCenterline } from '../systems/wall/wall-curve'
import { DEFAULT_WALL_HEIGHT } from '../systems/wall/wall-footprint'
import { detectSpacesForLevel } from './space-detection'

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

function polygonPerimeter(polygon: readonly Point2D[]): number {
  let perimeter = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!(start && end)) continue
    perimeter += pointDistance(start, end)
  }
  return perimeter
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

function polygonSurfaceArea(
  polygon: readonly Point2D[],
  holes: readonly (readonly Point2D[])[] = [],
): number {
  return Math.max(0, polygonArea(polygon) - holes.reduce((sum, hole) => sum + polygonArea(hole), 0))
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

function wallForBoundarySegment(
  start: Point2D,
  end: Point2D,
  walls: readonly WallNode[],
): WallNode | null {
  const midpoint: Point2D = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  let best: { wall: WallNode; distance: number } | null = null

  for (const wall of walls) {
    const centerline = sampleWallCenterline(wall, 32).map((point) => [point.x, point.y] as Point2D)
    const distances = [start, midpoint, end].map((point) =>
      pointToPolylineDistance(point, centerline),
    )
    if (distances.some((distance) => distance > BOUNDARY_TOLERANCE)) continue

    const distance = distances.reduce((sum, value) => sum + value, 0)
    if (!best || distance < best.distance) best = { wall, distance }
  }

  return best?.wall ?? null
}

function matchingSurfaceNodes<T extends SlabNode | CeilingNode>(
  zone: ZoneNode,
  nodes: readonly T[],
): T[] {
  return nodes.filter((node) => polygonsDescribeSameRegion(zone.polygon, node.polygon))
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
  const slabs = matchingSurfaceNodes(
    zone,
    levelNodes.filter((node): node is SlabNode => node.type === 'slab'),
  )
  const ceilings = matchingSurfaceNodes(
    zone,
    levelNodes.filter((node): node is CeilingNode => node.type === 'ceiling'),
  )

  const edgeLengths = zone.polygon.map((start, index) => {
    const end = zone.polygon[(index + 1) % zone.polygon.length]
    return end ? pointDistance(start, end) : 0
  })
  const footprintArea = polygonArea(zone.polygon)
  const perimeter = edgeLengths.reduce((sum, length) => sum + length, 0)

  const matchingRoom = levelId
    ? detectSpacesForLevel(levelId, walls).roomPolygons.find((polygon) =>
        polygonsDescribeSameRegion(
          zone.polygon,
          polygon.map((point) => [point.x, point.y]),
        ),
      )
    : undefined

  const wallMatches = matchingRoom?.map((start, index) => {
    const end = matchingRoom[(index + 1) % matchingRoom.length]
    if (!end) return null
    const tupleStart: Point2D = [start.x, start.y]
    const tupleEnd: Point2D = [end.x, end.y]
    const wall = wallForBoundarySegment(tupleStart, tupleEnd, walls)
    if (!wall) return null
    return { wall, length: pointDistance(tupleStart, tupleEnd) }
  })
  const allWallsProven = !!wallMatches && wallMatches.length > 0 && wallMatches.every(Boolean)
  const boundaryWallIds = allWallsProven
    ? [...new Set(wallMatches.map((match) => match!.wall.id))]
    : []

  const wallSurface = allWallsProven
    ? {
        status: 'available' as const,
        value: wallMatches.reduce(
          (sum, match) => sum + match!.length * (match!.wall.height ?? DEFAULT_WALL_HEIGHT),
          0,
        ),
        note: 'Gross interior wall face before openings.',
      }
    : unavailable(
        matchingRoom
          ? 'The closed boundary could not be assigned to every wall segment.'
          : 'No matching closed wall loop was detected.',
      )

  const matchingSlab = slabs.length === 1 ? slabs[0] : undefined
  const floorSurface = matchingSlab
    ? {
        status: 'available' as const,
        value: polygonSurfaceArea(matchingSlab.polygon, matchingSlab.holes),
        note: 'Matching slab surface after openings.',
      }
    : unavailable(
        slabs.length > 1
          ? 'More than one slab matches this boundary.'
          : 'No slab matches this zone boundary.',
      )

  const matchingCeiling = ceilings.length === 1 ? ceilings[0] : undefined
  let volume: ZoneQuantityValue
  if (!matchingRoom) {
    volume = unavailable('No matching closed wall loop was detected.')
  } else if (!matchingSlab) {
    volume = unavailable(floorSurface.status === 'unavailable' ? floorSurface.reason : 'No floor.')
  } else if (!matchingCeiling) {
    volume = unavailable(
      ceilings.length > 1
        ? 'More than one ceiling matches this boundary.'
        : 'No ceiling matches this zone boundary.',
    )
  } else {
    const clearHeight = matchingCeiling.height - matchingSlab.elevation
    volume =
      Number.isFinite(clearHeight) && clearHeight > 0
        ? {
            status: 'available',
            value: polygonSurfaceArea(matchingSlab.polygon, matchingSlab.holes) * clearHeight,
            note: 'Matching slab area multiplied by clear ceiling height.',
          }
        : unavailable('The matching ceiling is not above the slab surface.')
  }

  return {
    classification: matchingRoom ? 'enclosed-room' : 'footprint',
    footprintArea,
    perimeter,
    edgeLengths,
    boundaryWallIds,
    wallSurface,
    floorSurface,
    volume,
  }
}
