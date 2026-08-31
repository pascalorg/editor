import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  type ItemNode,
  pointInPolygon2D,
  pointOnSegment,
  type SlabNode,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'

type Point2D = [number, number]

const POINT_TOLERANCE = 0.5
const COLLINEAR_TOLERANCE = 1e-6
const SURFACE_POLYGON_TOLERANCE = 0.15

function getPointToSegmentDistance(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq === 0) return Math.hypot(point[0] - start[0], point[1] - start[1])

  const rawT = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSq
  const t = Math.max(0, Math.min(1, rawT))
  const projected: Point2D = [start[0] + t * dx, start[1] + t * dz]
  return Math.hypot(point[0] - projected[0], point[1] - projected[1])
}

function pointInPolygonWithTolerance(point: Point2D, polygon: Point2D[]): boolean {
  if (pointInPolygon2D(point, polygon, { includeBoundary: true })) return true
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length]
    return end ? getPointToSegmentDistance(point, start, end) <= POINT_TOLERANCE : false
  })
}

function polygonContainsWithTolerance(
  outer: Point2D[],
  inner: Point2D[],
  tolerance: number,
): boolean {
  return inner.every((point) => {
    if (pointInPolygon2D(point, outer, { includeBoundary: true })) return true
    return outer.some((start, index) => {
      const end = outer[(index + 1) % outer.length]
      return end ? getPointToSegmentDistance(point, start, end) <= tolerance : false
    })
  })
}

function polygonMatchesZoneFootprint(surfacePolygon: Point2D[], footprint: Point2D[]): boolean {
  if (surfacePolygon.length < 3) return false
  return (
    polygonContainsWithTolerance(footprint, surfacePolygon, SURFACE_POLYGON_TOLERANCE) &&
    polygonContainsWithTolerance(surfacePolygon, footprint, SURFACE_POLYGON_TOLERANCE)
  )
}

function areSegmentsCollinear(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const abx = b[0] - a[0]
  const abz = b[1] - a[1]
  const acx = c[0] - a[0]
  const acz = c[1] - a[1]
  const adx = d[0] - a[0]
  const adz = d[1] - a[1]
  const crossC = abx * acz - abz * acx
  const crossD = abx * adz - abz * adx
  return Math.abs(crossC) <= COLLINEAR_TOLERANCE && Math.abs(crossD) <= COLLINEAR_TOLERANCE
}

function segmentsOverlap(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const useX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])
  const a0 = useX ? a[0] : a[1]
  const a1 = useX ? b[0] : b[1]
  const c0 = useX ? c[0] : c[1]
  const c1 = useX ? d[0] : d[1]
  const minA = Math.min(a0, a1)
  const maxA = Math.max(a0, a1)
  const minC = Math.min(c0, c1)
  const maxC = Math.max(c0, c1)
  return Math.max(minA, minC) <= Math.min(maxA, maxC) + COLLINEAR_TOLERANCE
}

function wallLiesOnZoneBoundary(wall: WallNode, polygon: Point2D[]): boolean {
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length]
    if (!end) return false
    return (
      areSegmentsCollinear(wall.start, wall.end, start, end) &&
      segmentsOverlap(wall.start, wall.end, start, end) &&
      pointOnSegment(wall.start, start, end, POINT_TOLERANCE) &&
      pointOnSegment(wall.end, start, end, POINT_TOLERANCE)
    )
  })
}

export function collectZoneContentIds(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  zone: ZoneNode,
): AnyNodeId[] {
  const levelId = zone.parentId
  if (!levelId) return []

  const footprint = zone.polygon.map((point) => [point[0], point[1]] as Point2D)
  const boundaryWalls = Object.values(nodes)
    .filter((node): node is WallNode => node.type === 'wall' && node.parentId === levelId)
    .filter((wall) => wallLiesOnZoneBoundary(wall, footprint))
  const surfaces = Object.values(nodes)
    .filter(
      (node): node is SlabNode | CeilingNode =>
        (node.type === 'slab' || node.type === 'ceiling') && node.parentId === levelId,
    )
    .filter((surface) => {
      const polygon = surface.polygon.map((point) => [point[0], point[1]] as Point2D)
      return polygonMatchesZoneFootprint(polygon, footprint)
    })
  const floorItems = Object.values(nodes)
    .filter((node): node is ItemNode => node.type === 'item' && node.parentId === levelId)
    .filter((item) => pointInPolygonWithTolerance([item.position[0], item.position[2]], footprint))

  return Array.from(
    new Set<AnyNodeId>([
      ...boundaryWalls.map((wall) => wall.id as AnyNodeId),
      ...surfaces.map((surface) => surface.id as AnyNodeId),
      ...floorItems.map((item) => item.id as AnyNodeId),
    ]),
  )
}
