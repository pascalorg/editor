import type { WallNode } from '../schema'
import { isCurvedWall } from '../systems/wall/wall-curve'
import {
  dedupeSequentialPoints,
  type Point2D,
  pointFromTuple,
  pointToTuple,
  polygonArea,
  polygonSignature,
  type SpaceBoundaryFace,
  sampleWallPointsForRoomDetection,
} from './room-graph'
import { distanceToSegment } from './room-topology-index'

/**
 * The outside of a storey's walls: the unbounded faces of the planar wall
 * graph, walked the other way round from rooms. Facades fill these loops and
 * the wall tool selects them. Kept apart from the room kernel (`room-graph`),
 * which only ever wants the bounded faces.
 */

type WallFace = {
  polygon: Point2D[]
  boundaryFaces: SpaceBoundaryFace[]
}

const WALL_JUNCTION_TOLERANCE = 0.08
// Endpoints closer than this are one graph node, whatever their rounding: a millimetre, as the
// room kernel's keys (a wall posed by hand 0.65 mm short of its neighbour left the loop open).
// A gap past it stays open, as a real opening may; a caller may join wider (`joinTolerance`).
const WALL_ENDPOINT_TOLERANCE = 1e-3

function samePointWithinTolerance(a: Point2D, b: Point2D, tolerance = 1e-4) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance
}

function pointInPolygon(point: Point2D, polygon: Point2D[]) {
  if (polygon.length < 3) return false

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]?.x ?? 0
    const yi = polygon[i]?.y ?? 0
    const xj = polygon[j]?.x ?? 0
    const yj = polygon[j]?.y ?? 0

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }

  return inside
}

function pointDistanceToPolygonBoundary(point: Point2D, polygon: Point2D[]) {
  let minDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!(start && end)) continue
    minDistance = Math.min(
      minDistance,
      distanceToSegment(pointToTuple(point), pointToTuple(start), pointToTuple(end)),
    )
  }
  return minDistance
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

function splitStraightWallAtVertices(start: Point2D, end: Point2D, vertices: Point2D[]) {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length < 1e-9) return [start, end]

  const interior: Array<{ point: Point2D; t: number }> = []
  for (const vertex of vertices) {
    const { t, distance } = segmentProjection(vertex, start, end)
    if (distance > WALL_JUNCTION_TOLERANCE) continue
    const along = t * length
    if (along <= WALL_JUNCTION_TOLERANCE || along >= length - WALL_JUNCTION_TOLERANCE) continue
    interior.push({ point: vertex, t })
  }
  interior.sort((a, b) => a.t - b.t)

  const ordered: Point2D[] = [start]
  for (const { point } of interior) {
    if (samePointWithinTolerance(point, ordered[ordered.length - 1]!, WALL_ENDPOINT_TOLERANCE))
      continue
    ordered.push(point)
  }
  if (!samePointWithinTolerance(ordered[ordered.length - 1]!, end, WALL_ENDPOINT_TOLERANCE))
    ordered.push(end)
  return ordered
}

function exteriorFaces(walls: WallNode[], joinTolerance: number): WallFace[] {
  if (walls.length < 3) return []

  type HalfEdge = {
    id: string
    reverseId: string
    fromKey: string
    toKey: string
    angle: number
    points: Point2D[]
    wallId: WallNode['id']
    face: 'front' | 'back'
  }
  type Node = { point: Point2D; outgoing: string[] }

  const graph = new Map<string, Node>()
  const halfEdges = new Map<string, HalfEdge>()
  const endpointBuckets = new Map<string, string[]>()

  const upsertNode = (point: Point2D) => {
    // Rounded coordinate strings can split coincident SVG endpoints on a cell
    // boundary. Buckets only narrow the search; distance establishes identity.
    const x = Math.floor(point.x / joinTolerance)
    const y = Math.floor(point.y / joinTolerance)
    let nearest: string | undefined
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const key of endpointBuckets.get(`${x + dx},${y + dy}`) ?? []) {
          const candidate = graph.get(key)!.point
          const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y)
          if (distance <= joinTolerance && distance < nearestDistance) {
            nearest = key
            nearestDistance = distance
          }
        }
      }
    }
    if (nearest !== undefined) return nearest
    const key = String(graph.size)
    graph.set(key, { point: { ...point }, outgoing: [] })
    const bucketKey = `${x},${y}`
    const bucket = endpointBuckets.get(bucketKey) ?? []
    bucket.push(key)
    endpointBuckets.set(bucketKey, bucket)
    return key
  }

  // Planarize first: collect every wall endpoint as a candidate graph vertex so
  // straight walls can be split at T-junctions where another wall ends mid-span.
  // Without this the touching wall's endpoint is a dangling degree-1 node and the
  // enclosed area (e.g. a room added against the middle of an existing wall)
  // never forms a cycle.
  for (const wall of walls) {
    upsertNode(pointFromTuple(wall.start))
    upsertNode(pointFromTuple(wall.end))
  }
  const vertices = [...graph.values()].map((node) => node.point)

  for (const wall of walls) {
    const start = pointFromTuple(wall.start)
    const end = pointFromTuple(wall.end)
    if (samePointWithinTolerance(start, end)) continue

    // Curved walls keep their sampled polyline as one edge; straight walls split
    // into consecutive sub-edges at their interior junction vertices.
    const subPolylines: Point2D[][] = isCurvedWall(wall)
      ? [sampleWallPointsForRoomDetection(wall)]
      : (() => {
          const ordered = splitStraightWallAtVertices(start, end, vertices)
          const parts: Point2D[][] = []
          for (let index = 0; index < ordered.length - 1; index += 1) {
            parts.push([ordered[index]!, ordered[index + 1]!])
          }
          return parts
        })()

    subPolylines.forEach((points, subIndex) => {
      const from = points[0]!
      const to = points[points.length - 1]!
      const fromKey = upsertNode(from)
      const toKey = upsertNode(to)
      if (fromKey === toKey) return

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
    })
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
  const rooms: WallFace[] = []
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
      const polygon = dedupeSequentialPoints(
        simpleCycleEdgeIds.flatMap((id, index) => {
          const points = halfEdges.get(id)?.points ?? []
          return index === simpleCycleEdgeIds.length - 1 ? points : points.slice(0, -1)
        }),
      )

      if (polygon.length < 3) continue

      const signedArea = polygonArea(polygon)
      // Rooms wind one way; the outside of the walls is walked the other.
      if (signedArea >= -1e-6) continue

      const signature = polygonSignature(polygon)
      if (rooms.some((room) => polygonSignature(room.polygon) === signature)) continue

      rooms.push({
        polygon,
        boundaryFaces: simpleCycleEdgeIds.flatMap((id) => {
          const edge = halfEdges.get(id)
          if (!edge) return []
          return [
            {
              wallId: edge.wallId,
              face: edge.face,
              points: edge.points.map(pointToTuple),
            },
          ]
        }),
      })
    }
  }

  rooms.sort((a, b) => Math.abs(polygonArea(b.polygon)) - Math.abs(polygonArea(a.polygon)))
  return rooms
}

/**
 * The outside loops of a storey's walls. Wall ends within `joinTolerance` metres are one corner: a
 * millimetre by default; a vectorised plan's near-miss corners may need a few centimetres.
 */
export function exteriorWallLoops(
  walls: WallNode[],
  joinTolerance = WALL_ENDPOINT_TOLERANCE,
): SpaceBoundaryFace[][] {
  return outerFaces(walls, joinTolerance).map((loop) => loop.boundaryFaces)
}

/** The outlines of a storey's walls: each outside loop as a polygon on the walls' centrelines. */
export function exteriorWallOutlines(
  walls: WallNode[],
  joinTolerance = WALL_ENDPOINT_TOLERANCE,
): [number, number][][] {
  return outerFaces(walls, joinTolerance).map((loop) => loop.polygon.map(pointToTuple))
}

function outerFaces(walls: WallNode[], joinTolerance: number) {
  const loops = exteriorFaces(walls, Math.max(WALL_ENDPOINT_TOLERANCE, joinTolerance))
  return loops.filter(
    (loop, index) =>
      !loops.some((other, otherIndex) => {
        if (
          otherIndex === index ||
          Math.abs(polygonArea(other.polygon)) <= Math.abs(polygonArea(loop.polygon))
        )
          return false
        // Use boundary points, not the centroid: concave footprints may have a centroid outside.
        return loop.polygon.every(
          (point) =>
            pointInPolygon(point, other.polygon) ||
            pointDistanceToPolygonBoundary(point, other.polygon) < 1e-4,
        )
      }),
  )
}

/** A wall end that joins nothing: no other end at it, no other wall's body under it. */
export type FreeWallEnd = {
  wallId: WallNode['id']
  point: [number, number]
  /** The nearest end of another wall, and how far. */
  nearest: { wallId: WallNode['id']; distance: number } | null
}

/**
 * The wall ends that keep a storey's outside loop open, with the nearest end of another wall: what
 * to close for a facade. A gap stays open, however small past a millimetre: it may be a real
 * opening (2026-10-03, a vectorised plan left 3 and 8 cm gaps the agent had to find).
 */
export function freeWallEnds(
  walls: WallNode[],
  joinTolerance = WALL_ENDPOINT_TOLERANCE,
): FreeWallEnd[] {
  const join = Math.max(WALL_ENDPOINT_TOLERANCE, joinTolerance)
  const ends = walls.flatMap((wall) =>
    [wall.start, wall.end].map((tuple) => ({ wall, point: pointFromTuple(tuple) })),
  )
  const free: FreeWallEnd[] = []
  for (const end of ends) {
    const others = ends.filter((other) => other.wall !== end.wall)
    if (others.some((other) => samePointWithinTolerance(other.point, end.point, join))) continue
    const onBody = walls.some((other) => {
      if (other === end.wall) return false
      const { t, distance } = segmentProjection(
        end.point,
        pointFromTuple(other.start),
        pointFromTuple(other.end),
      )
      return t > 0 && t < 1 && distance <= WALL_JUNCTION_TOLERANCE
    })
    if (onBody) continue
    let nearest: FreeWallEnd['nearest'] = null
    for (const other of others) {
      const distance = Math.hypot(other.point.x - end.point.x, other.point.y - end.point.y)
      if (!nearest || distance < nearest.distance) nearest = { wallId: other.wall.id, distance }
    }
    free.push({ wallId: end.wall.id, point: pointToTuple(end.point), nearest })
  }
  return free
}
