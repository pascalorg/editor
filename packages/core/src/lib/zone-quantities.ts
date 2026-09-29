import type { AnyNode, CeilingNode, SlabNode, WallNode, ZoneNode } from '../schema'
import type { AnyNodeId } from '../schema/types'
import { DEFAULT_LEVEL_HEIGHT, resolveCeilingHeight } from '../services/level-height'
import { getWallPlaneTop } from '../services/storey'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { sampleWallCenterline } from '../systems/wall/wall-curve'
import { getWallLocalFaceZ } from '../systems/wall/wall-frame'
import { resolveWallEffectiveHeight } from '../systems/wall/wall-top'
import { levelWallCover } from './plate-surface'
import {
  area,
  containsPoint,
  difference,
  distanceToBoundary,
  intersection,
  type Polygon,
  type Ring,
  union,
} from './polygon-boolean'
import { roomFloorPlate } from './room-floor-plate'
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
  polygon: Polygon,
  tolerance: number,
): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  if (length <= 1e-9) return 0

  const breaks = [0, 1]
  for (const ring of [polygon.outer, ...polygon.holes]) {
    for (let index = 0; index < ring.length; index += 1) {
      const polygonStart = ring[index]!
      const polygonEnd = ring[(index + 1) % ring.length]!
      const edgeX = polygonEnd[0] - polygonStart[0]
      const edgeY = polygonEnd[1] - polygonStart[1]
      const denominator = dx * edgeY - dy * edgeX
      if (Math.abs(denominator) > 1e-12) {
        const t =
          ((polygonStart[0] - start[0]) * edgeY - (polygonStart[1] - start[1]) * edgeX) /
          denominator
        const edgeT =
          ((polygonStart[0] - start[0]) * dy - (polygonStart[1] - start[1]) * dx) / denominator
        if (t > 0 && t < 1 && edgeT >= -1e-9 && edgeT <= 1 + 1e-9) breaks.push(t)
      }

      if (pointToSegmentDistance(polygonStart, start, end) <= tolerance) {
        const projected = segmentParameter(polygonStart, start, end)
        if (projected > 0 && projected < 1) breaks.push(projected)
      }
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
      containsPoint([polygon], [midpoint[0], midpoint[1]]) ||
      distanceToBoundary([polygon], [midpoint[0], midpoint[1]]) <= tolerance
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
      const tolerance =
        getWallLocalFaceZ(wall, boundary.face === 'front' ? 'a' : 'b') *
          (boundary.face === 'front' ? 1 : -1) +
        BOUNDARY_TOLERANCE
      let length = 0
      for (let index = 0; index < boundary.points.length - 1; index += 1) {
        length += segmentLengthInsideOrNearPolygon(
          boundary.points[index]!,
          boundary.points[index + 1]!,
          { outer: zone.polygon, holes: zone.holes ?? [] },
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
  for (const ring of [zone.polygon, ...(zone.holes ?? [])]) {
    for (let edgeIndex = 0; edgeIndex < ring.length; edgeIndex += 1) {
      const start = ring[edgeIndex]!
      const end = ring[(edgeIndex + 1) % ring.length]!
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
  footprint = [{ outer: zone.polygon, holes: zone.holes ?? [] }],
): SurfaceCoverage<T> {
  const footprintArea = area(footprint)
  const candidates = nodes.filter((node) => area(intersection(footprint, node.polygon)) > 1e-6)
  if (
    !footprintArea ||
    area(intersection(footprint, union(candidates.map((node) => node.polygon)))) / footprintArea <
      SURFACE_COVERAGE_THRESHOLD
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

  const openings: Ring[] = []
  for (const node of candidates) {
    for (const hole of node.holes ?? []) {
      const overlap = area(intersection(footprint, hole))
      if (overlap <= 1e-6) continue
      if (area(difference(footprint, hole)) <= 1e-6) {
        return { status: 'unavailable', reason: 'A surface opening removes this zone.' }
      }
      if (Math.abs(overlap - area([{ outer: hole, holes: [] }])) > 1e-6) {
        return { status: 'unavailable', reason: 'A surface opening crosses the zone boundary.' }
      }
      openings.push(hole)
    }
  }
  return { status: 'available', area: area(difference(footprint, union(openings))), datum }
}

function unavailable(reason: string): ZoneQuantityValue {
  return { status: 'unavailable', reason }
}

export function deriveZoneQuantityReport(
  zone: ZoneNode,
  sceneNodes: Readonly<Record<string, AnyNode>>,
): ZoneQuantityReport {
  if (zone.autoFromWalls && zone.enclosureStatus === 'open') {
    const missing = unavailable('The room enclosure is open.')
    return {
      classification: 'footprint',
      footprintArea: 0,
      perimeter: 0,
      edgeLengths: [],
      boundaryWallIds: [],
      wallSurface: missing,
      floorSurface: missing,
      volume: missing,
    }
  }
  const levelId = zone.parentId
  const levelNodes = levelId
    ? Object.values(sceneNodes).filter((node) => node.parentId === levelId)
    : []
  const walls = levelNodes.filter((node): node is WallNode => node.type === 'wall')
  const slabs = levelNodes.filter((node): node is SlabNode => node.type === 'slab')
  const wallEffectiveHeight = (wall: WallNode) => {
    const support = computeWallSlabSupport(
      wall,
      slabs,
      walls,
      wall.supportSlabId,
      undefined,
      0,
      sceneNodes,
    )
    const planeTop = levelId ? getWallPlaneTop(wall, levelId, sceneNodes) : DEFAULT_LEVEL_HEIGHT
    return resolveWallEffectiveHeight(wall, planeTop, support.elevation)
  }
  const edgeLengths = [zone.polygon, ...(zone.holes ?? [])].flatMap((ring) =>
    ring.map((start, index) => {
      const end = ring[(index + 1) % ring.length]
      return end ? pointDistance(start, end) : 0
    }),
  )
  const footprint = { outer: zone.polygon, holes: zone.holes ?? [] }
  const footprintArea = area([footprint])
  const perimeter = edgeLengths.reduce((sum, length) => sum + length, 0)
  const floorPlate = roomFloorPlate(slabs, zone.id)
  const clearFootprint = floorPlate?.plateRole
    ? difference(footprint, levelWallCover(walls))
    : [footprint]
  const slabCoverage = proveSurfaceCoverage(
    zone,
    slabs.filter((slab) => {
      if (zone.floor?.support === 'open') return slab.zoneIds?.includes(zone.id)
      if (slab.support === 'open') return false
      return (
        !floorPlate?.plateRole ||
        !slab.plateRole ||
        (slab.plateRole === floorPlate.plateRole && slab.zoneIds?.includes(zone.id))
      )
    }),
    (node) => node.elevation,
    { singular: 'slab', plural: 'Slabs', datum: 'elevations' },
    clearFootprint,
  )
  const ceilingCoverage = proveSurfaceCoverage(
    zone,
    levelNodes.filter((node): node is CeilingNode => node.type === 'ceiling'),
    (node) => resolveCeilingHeight(node, sceneNodes as Record<AnyNodeId, AnyNode>),
    { singular: 'ceiling', plural: 'Ceilings', datum: 'heights' },
    clearFootprint,
  )

  const spaces = levelId ? detectSpacesForLevel(levelId, walls).spaces : []
  const spaceFootprint = (space: Space) => ({ outer: space.polygon, holes: space.holes ?? [] })
  const overlappingSpaces = spaces.filter(
    (space) => area(intersection(footprint, spaceFootprint(space))) > 1e-6,
  )
  const topologyEnclosesZone =
    footprintArea > 0 &&
    overlappingSpaces.length > 0 &&
    area(intersection(footprint, union(overlappingSpaces.map(spaceFootprint)))) / footprintArea >=
      SPACE_CONTAINMENT_THRESHOLD &&
    overlappingSpaces.every(
      (space) =>
        area(intersection(spaceFootprint(space), footprint)) / area([spaceFootprint(space)]) >=
        SPACE_CONTAINMENT_THRESHOLD,
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
