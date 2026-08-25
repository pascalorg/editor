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

/**
 * The objects standing inside a zone, whatever kind they are.
 *
 * Separate from `collectZoneContentIds`, which answers a different question.
 * That one gathers the fabric a zone is made of — its boundary walls and the
 * slab and ceiling that match its footprint — plus `item` nodes, and it drives
 * "Delete with contents". This one answers "what is standing in here", which is
 * what a contents list shows.
 *
 * Kind-agnostic on purpose. `collectZoneContentIds` tests `node.type === 'item'`
 * and so sees none of the objects a plugin contributes — a rack is
 * `warehouse:pallet-rack`, not `item` — which is why a zone full of racking
 * reported nothing inside it. Anything parented to the zone's level that has a
 * position and is not part of the zone's own fabric is tested here, so a kind
 * added later is included without this function being touched again.
 *
 * Containment is `pointInPolygonWithTolerance`, the same predicate the delete
 * path uses for items. The repo has several point-in-polygon implementations
 * with different boundary rules; reusing this one keeps the list agreeing with
 * the action the user reaches for next.
 */
export function collectZoneObjectIds(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  zone: ZoneNode,
): AnyNodeId[] {
  const levelId = zone.parentId
  if (!levelId) return []

  const footprint = zone.polygon.map((point) => [point[0], point[1]] as Point2D)

  // The zone's own fabric, not things standing in it. Walls, slabs and ceilings
  // are matched by shape rather than by a point, and a zone never contains
  // another zone.
  const fabric = new Set(['wall', 'slab', 'ceiling', 'zone'])

  return Object.values(nodes)
    .filter((node) => {
      if (node.parentId !== levelId) return false
      if (fabric.has(node.type)) return false
      const position = (node as { position?: unknown }).position
      if (!Array.isArray(position) || position.length < 3) return false
      const [x, , z] = position as number[]
      if (typeof x !== 'number' || typeof z !== 'number') return false
      return pointInPolygonWithTolerance([x, z], footprint)
    })
    .map((node) => node.id as AnyNodeId)
}

/**
 * Display labels of everything standing in a zone, one entry per node.
 *
 * Labels rather than `{ label, count }` pairs, and counting left to the caller,
 * because this is read through `useShallow`: that compares array elements with
 * `Object.is`, so a freshly built object is never equal to its predecessor and
 * the subscription reports a change on every single render. Strings compare by
 * value, so an unchanged zone yields an unchanged snapshot and the render
 * settles. Returning objects here once took the editor down with a React 185
 * render loop the moment a zone's panel opened.
 */
export function collectZoneObjectLabels(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  zone: ZoneNode,
  displayName: (node: AnyNode, nodes: Readonly<Record<AnyNodeId, AnyNode>>) => string,
): string[] {
  const labels: string[] = []
  for (const id of collectZoneObjectIds(nodes, zone)) {
    const node = nodes[id]
    if (!node) continue
    labels.push(displayName(node, nodes) || node.type)
  }
  return labels
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
