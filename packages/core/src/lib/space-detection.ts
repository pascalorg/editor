import {
  type AnyNodeId,
  CeilingNode,
  type CeilingNode as CeilingNodeType,
  type LevelNode,
  SlabNode,
  type SlabNode as SlabNodeType,
  type WallNode,
  ZoneNode,
  type ZoneNode as ZoneNodeType,
} from '../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../services/level-height'
import {
  CEILING_CLAMP_MARGIN,
  getCeilingClampBound,
  getLevelBelow,
  getStoredLevelHeight,
} from '../services/storey'
import {
  pauseSceneHistory,
  resumeSceneHistory,
  type SceneCommit,
  subscribeSceneCommits,
} from '../store/history-control'
import {
  getClampedWallCurveOffset,
  getWallCurveFrameAt,
  isCurvedWall,
} from '../systems/wall/wall-curve'
import { simplifyClosedPolygon } from './polygon-geometry'

type Point2D = { x: number; y: number }

export type SpaceBoundaryFace = {
  wallId: WallNode['id']
  face: 'front' | 'back'
  points: Array<[number, number]>
}

export type Space = {
  id: string
  levelId: string
  polygon: Array<[number, number]>
  wallIds: Array<WallNode['id']>
  boundaryFaces: SpaceBoundaryFace[]
  isExterior: boolean
}

type ExtractedRoom = {
  polygon: Point2D[]
  boundaryFaces: SpaceBoundaryFace[]
}

type WallSideUpdate = {
  wallId: string
  frontSide: 'interior' | 'exterior' | 'unknown'
  backSide: 'interior' | 'exterior' | 'unknown'
}

type DetectedRoom = {
  poly: Point2D[]
  sig: string
  centroid: Point2D
  area: number
  bbox: ReturnType<typeof bboxOf>
}

export type AutoSlabSyncPlan = {
  create: SlabNodeType[]
  update: Array<{ id: SlabNodeType['id']; data: Partial<SlabNodeType> }>
  delete: Array<SlabNodeType['id']>
}

export type AutoCeilingSyncPlan = {
  create: CeilingNodeType[]
  update: Array<{ id: CeilingNodeType['id']; data: Partial<CeilingNodeType> }>
  delete: Array<CeilingNodeType['id']>
}

export type AutoZoneSyncPlan = {
  update: Array<{ id: ZoneNodeType['id']; data: Partial<ZoneNodeType> }>
}

const DEFAULT_AUTO_SLAB_ELEVATION = 0.05
const CEILING_HEIGHT_EPSILON = 1e-6
const ROOM_CURVE_TOLERANCE = 0.04
const MAX_CURVE_SUBDIVISION_DEPTH = 6
const AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE = 0.08
const WALL_ROOM_BOUNDARY_TOLERANCE = 0.08
// A wall endpoint within this distance of another wall's interior is treated as a
// T-junction and splits that wall (see `splitStraightWallAtVertices`).
const WALL_JUNCTION_TOLERANCE = 0.08
// An unmatched auto slab/ceiling whose polygon is still substantially covered
// by a detected room was absorbed by a room merge — the surviving auto surface
// owns that area, so keeping it would z-fight and it is deleted. Below this
// coverage the room genuinely ceased to exist (e.g. an enclosing wall was
// deleted) and the node is demoted to manual so user data survives.
const ORPHAN_MERGE_COVERAGE_THRESHOLD = 0.6
const COVERAGE_SAMPLE_STEPS = 12

// Auto ceilings are created height-less (follows-mode: they track the
// clamp bound live through `resolveCeilingHeight`), so the planner needs
// no wall/slab inputs anymore — only the bound for the explicit-height
// reactive re-clamp below.
export type AutoCeilingPlanningContext = {
  /** Stored storey height of the level being planned (floor-to-floor). */
  storeyHeight?: number
  /**
   * Stage 3-B clamp-bound resolver for a polygon on the planned level:
   * `min(storey plane, lowest covering-slab underside from the level
   * above) - CEILING_CLAMP_MARGIN` (see `getCeilingClampBound`). Absent
   * (pure-planner callers without a nodes record), the bound degrades to
   * the plane-only `storeyHeight - CEILING_CLAMP_MARGIN`.
   */
  ceilingClampBound?: (polygon: Array<[number, number]>) => number
}

function pointFromTuple(point: [number, number]): Point2D {
  return { x: point[0], y: point[1] }
}

function pointToTuple(point: Point2D): [number, number] {
  return [point.x, point.y]
}

function pointKey(point: Point2D) {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`
}

function polygonArea(points: Point2D[]) {
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

function polygonSignature(points: Point2D[]) {
  const keys = points.map(pointKey)
  const forward = minRotationSignature(keys)
  const reversed = minRotationSignature([...keys].reverse())
  return forward < reversed ? forward : reversed
}

function samePointWithinTolerance(a: Point2D, b: Point2D, tolerance = 1e-4) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance
}

function dedupeSequentialPoints(points: Point2D[], tolerance = 1e-4) {
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

function pointInAnyPolygon(point: Point2D, polygons: Point2D[][]) {
  return polygons.some((polygon) => pointInPolygon(point, polygon))
}

function polygonCentroid(points: Point2D[]) {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  })

  return {
    x: sum.x / Math.max(points.length, 1),
    y: sum.y / Math.max(points.length, 1),
  }
}

function bboxOf(points: Point2D[]) {
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

function bboxOverlapArea(a: ReturnType<typeof bboxOf>, b: ReturnType<typeof bboxOf>) {
  const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
  const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY))
  return ix * iy
}

// Fraction of `subject`'s area lying inside any of `covers`, estimated by
// sampling a grid of cell centers over the subject's bbox. Cheap and robust
// enough for the merge-vs-demote decision; exact polygon clipping would be a
// heavy dependency for a 60% threshold.
function polygonCoverageRatio(subject: Point2D[], covers: Point2D[][]) {
  if (subject.length < 3 || covers.length === 0) return 0

  const bbox = bboxOf(subject)
  const width = bbox.maxX - bbox.minX
  const height = bbox.maxY - bbox.minY

  let inside = 0
  let covered = 0
  for (let i = 0; i < COVERAGE_SAMPLE_STEPS; i += 1) {
    for (let j = 0; j < COVERAGE_SAMPLE_STEPS; j += 1) {
      const point = {
        x: bbox.minX + ((i + 0.5) / COVERAGE_SAMPLE_STEPS) * width,
        y: bbox.minY + ((j + 0.5) / COVERAGE_SAMPLE_STEPS) * height,
      }
      if (!pointInPolygon(point, subject)) continue
      inside += 1
      if (pointInAnyPolygon(point, covers)) covered += 1
    }
  }

  if (inside === 0) {
    return pointInAnyPolygon(polygonCentroid(subject), covers) ? 1 : 0
  }

  return covered / inside
}

// Demoted auto surfaces keep their polygon untouched, so a re-closed room
// usually hits the exact-signature manual check. Coverage handles the rest:
// a room split across multiple manual surfaces AND a single manual surface
// spanning multiple rooms both suppress a replacement auto surface — what
// matters is that the ROOM is already substantially covered, not that any
// one manual surface belongs to it (a per-surface "mostly inside the room"
// filter dropped multi-room slabs and resurrected deleted auto slabs).
function matchesManualFootprint(roomPolygon: Point2D[], manualPolygons: Point2D[][]) {
  return polygonCoverageRatio(roomPolygon, manualPolygons) >= ORPHAN_MERGE_COVERAGE_THRESHOLD
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

function wallBoundsRoom(wall: WallNode, roomPolygon: Point2D[]) {
  const sampled = sampleWallPointsForRoomDetection(wall)
  if (sampled.length === 0) return false

  const candidates =
    sampled.length === 2
      ? [
          sampled[0]!,
          {
            x: (sampled[0]!.x + sampled[1]!.x) / 2,
            y: (sampled[0]!.y + sampled[1]!.y) / 2,
          },
          sampled[1]!,
        ]
      : sampled

  const matchingPoints = candidates.filter(
    (point) => pointDistanceToPolygonBoundary(point, roomPolygon) <= WALL_ROOM_BOUNDARY_TOLERANCE,
  )

  return matchingPoints.length >= 2
}

/**
 * The clamp bound for a ceiling polygon under this planning context —
 * the context's cross-level resolver when provided, else the plane-only
 * `storeyHeight - CEILING_CLAMP_MARGIN` degradation.
 */
function resolveCeilingClampBound(
  polygon: Array<[number, number]>,
  context: AutoCeilingPlanningContext,
) {
  if (context.ceilingClampBound) return context.ceilingClampBound(polygon)
  return (context.storeyHeight ?? DEFAULT_LEVEL_HEIGHT) - CEILING_CLAMP_MARGIN
}

function getWallDirection(wall: Pick<WallNode, 'start' | 'end'>) {
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)

  if (length < 1e-9) {
    return {
      point: pointFromTuple(wall.start),
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
    }
  }

  const tangent = { x: dx / length, y: dy / length }
  return {
    point: {
      x: (wall.start[0] + wall.end[0]) / 2,
      y: (wall.start[1] + wall.end[1]) / 2,
    },
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
  }
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

function sampleWallPointsForRoomDetection(
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

function extractRooms(walls: WallNode[]): ExtractedRoom[] {
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
  const vertexByKey = new Map<string, Point2D>()
  for (const wall of walls) {
    for (const tuple of [wall.start, wall.end]) {
      const point = pointFromTuple(tuple)
      const key = pointKey(point)
      if (!vertexByKey.has(key)) vertexByKey.set(key, point)
    }
  }
  const vertices = [...vertexByKey.values()]

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
  const rooms: ExtractedRoom[] = []
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
      if (signedArea <= 0) continue

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

function extractRoomPolygons(walls: WallNode[]): Point2D[][] {
  return extractRooms(walls).map((room) => room.polygon)
}

/**
 * True when `wall` lies on the boundary of a room enclosed by `walls`, using the
 * same planar room graph the auto slab/ceiling sync uses. The wall builder's
 * "Room (auto-close)" mode calls this so drafting stops the moment a segment
 * closes a room — whether the chain loops back to its own start or seals a bay
 * against the middle of an existing wall (a T-junction). Sharing one graph means
 * auto-close and auto-slab detection can never disagree about what is "closed".
 */
export function wallClosesRoom(walls: WallNode[], wall: WallNode): boolean {
  const roomPolygons = extractRoomPolygons(walls)
  if (roomPolygons.length === 0) return false
  return roomPolygons.some((polygon) => wallBoundsRoom(wall, polygon))
}

export function resolveWallSurfaceSides(
  wall: Pick<WallNode, 'start' | 'end' | 'thickness' | 'frontSide' | 'backSide'>,
  roomPolygons: Point2D[][],
): Pick<WallSideUpdate, 'frontSide' | 'backSide'> {
  if (roomPolygons.length === 0) {
    return {
      frontSide: 'unknown' as const,
      backSide: 'unknown' as const,
    }
  }

  const frame = getWallDirection(wall)
  const normalLength = Math.hypot(frame.normal.x, frame.normal.y)
  if (normalLength < 1e-9) {
    return {
      frontSide: wall.frontSide,
      backSide: wall.backSide,
    }
  }

  const normalX = frame.normal.x / normalLength
  const normalY = frame.normal.y / normalLength
  const sampleDistance = Math.max((wall.thickness ?? 0.2) / 2 + 0.08, 0.16)

  const frontPoint = {
    x: frame.point.x + normalX * sampleDistance,
    y: frame.point.y + normalY * sampleDistance,
  }
  const backPoint = {
    x: frame.point.x - normalX * sampleDistance,
    y: frame.point.y - normalY * sampleDistance,
  }

  const frontInside = pointInAnyPolygon(frontPoint, roomPolygons)
  const backInside = pointInAnyPolygon(backPoint, roomPolygons)

  if (frontInside === backInside) {
    return {
      frontSide: wall.frontSide,
      backSide: wall.backSide,
    }
  }

  return {
    frontSide: frontInside ? 'interior' : 'exterior',
    backSide: backInside ? 'interior' : 'exterior',
  }
}

function nextAutoRoomName(
  nodes: Array<{
    name?: string
  }>,
  suffix: 'Slab' | 'Ceiling',
) {
  let maxIndex = 0

  for (const node of nodes) {
    const match = /^Room\s+(\d+)(?:\s+(?:Slab|Ceiling))?$/i.exec((node.name ?? '').trim())
    if (!match) continue
    const index = Number(match[1])
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index)
    }
  }

  return `Room ${maxIndex + 1} ${suffix}`
}

function sameTuplePolygon(current: Array<[number, number]>, next: Array<[number, number]>) {
  return (
    current.length === next.length &&
    current.every((point, index) => point[0] === next[index]?.[0] && point[1] === next[index]?.[1])
  )
}

function sameTuplePolygons(
  current: Array<Array<[number, number]>>,
  next: Array<Array<[number, number]>>,
) {
  return (
    current.length === next.length &&
    current.every((polygon, index) => {
      const nextPolygon = next[index]
      return nextPolygon ? sameTuplePolygon(polygon, nextPolygon) : false
    })
  )
}

type SurfaceWithOpenings = {
  id: string
  holes: Array<Array<[number, number]>>
  holeMetadata: SlabNodeType['holeMetadata']
}

function crossProduct(a: Point2D, b: Point2D, c: Point2D) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function lineIntersection(start: Point2D, end: Point2D, clipStart: Point2D, clipEnd: Point2D) {
  const segment = { x: end.x - start.x, y: end.y - start.y }
  const clip = { x: clipEnd.x - clipStart.x, y: clipEnd.y - clipStart.y }
  const denominator = segment.x * clip.y - segment.y * clip.x
  if (Math.abs(denominator) < 1e-9) return end
  const offset = { x: clipStart.x - start.x, y: clipStart.y - start.y }
  const t = (offset.x * clip.y - offset.y * clip.x) / denominator
  return { x: start.x + segment.x * t, y: start.y + segment.y * t }
}

function clipPolygonToConvex(subject: Point2D[], clipPolygon: Point2D[]) {
  if (subject.length < 3 || clipPolygon.length < 3) return []
  const orientation = polygonArea(clipPolygon) >= 0 ? 1 : -1
  let output = [...subject]

  for (let index = 0; index < clipPolygon.length; index += 1) {
    const clipStart = clipPolygon[index]!
    const clipEnd = clipPolygon[(index + 1) % clipPolygon.length]!
    const input = output
    output = []
    if (input.length === 0) break

    let previous = input[input.length - 1]!
    let previousInside = orientation * crossProduct(clipStart, clipEnd, previous) >= -1e-8
    for (const current of input) {
      const currentInside = orientation * crossProduct(clipStart, clipEnd, current) >= -1e-8
      if (currentInside !== previousInside) {
        output.push(lineIntersection(previous, current, clipStart, clipEnd))
      }
      if (currentInside) output.push(current)
      previous = current
      previousInside = currentInside
    }
    output = dedupeSequentialPoints(output, 1e-7)
  }

  return output.length >= 3 && Math.abs(polygonArea(output)) > 1e-8 ? output : []
}

function isConvexPolygon(polygon: Point2D[]) {
  let direction = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const cross = crossProduct(
      polygon[index]!,
      polygon[(index + 1) % polygon.length]!,
      polygon[(index + 2) % polygon.length]!,
    )
    if (Math.abs(cross) < 1e-8) continue
    const nextDirection = Math.sign(cross)
    if (direction !== 0 && nextDirection !== direction) return false
    direction = nextDirection
  }
  return true
}

function pointInTriangle(point: Point2D, a: Point2D, b: Point2D, c: Point2D) {
  return (
    crossProduct(a, b, point) >= -1e-8 &&
    crossProduct(b, c, point) >= -1e-8 &&
    crossProduct(c, a, point) >= -1e-8
  )
}

function triangulatePolygon(polygon: Point2D[]) {
  const points = polygonArea(polygon) >= 0 ? [...polygon] : [...polygon].reverse()
  const indices = points.map((_, index) => index)
  const triangles: Point2D[][] = []
  let attempts = 0

  while (indices.length > 3 && attempts < points.length * points.length) {
    let clippedEar = false
    for (let index = 0; index < indices.length; index += 1) {
      const previousIndex = indices[(index - 1 + indices.length) % indices.length]!
      const currentIndex = indices[index]!
      const nextIndex = indices[(index + 1) % indices.length]!
      const previous = points[previousIndex]!
      const current = points[currentIndex]!
      const next = points[nextIndex]!
      if (crossProduct(previous, current, next) <= 1e-8) continue
      if (
        indices.some(
          (candidateIndex) =>
            candidateIndex !== previousIndex &&
            candidateIndex !== currentIndex &&
            candidateIndex !== nextIndex &&
            pointInTriangle(points[candidateIndex]!, previous, current, next),
        )
      ) {
        continue
      }
      triangles.push([previous, current, next])
      indices.splice(index, 1)
      clippedEar = true
      break
    }
    if (!clippedEar) break
    attempts += 1
  }

  if (indices.length === 3) {
    triangles.push(indices.map((index) => points[index]!))
  }
  return triangles
}

function clipOpeningToRoom(opening: Point2D[], room: Point2D[]) {
  const openingIsInside = opening.every(
    (point) => pointInPolygon(point, room) || pointDistanceToPolygonBoundary(point, room) <= 1e-7,
  )
  if (openingIsInside) return [opening]

  const clipRegions = isConvexPolygon(room) ? [room] : triangulatePolygon(room)
  return clipRegions
    .map((region) => clipPolygonToConvex(opening, region))
    .filter((polygon) => polygon.length >= 3)
}

function partitionSurfaceOpenings(
  surface: SurfaceWithOpenings,
  roomIndices: number[],
  detected: DetectedRoom[],
) {
  const assignments = new Map<
    number,
    {
      holes: Array<Array<[number, number]>>
      holeMetadata: SlabNodeType['holeMetadata']
    }
  >()
  for (const roomIndex of roomIndices) {
    assignments.set(roomIndex, { holes: [], holeMetadata: [] })
  }

  surface.holes.forEach((hole, holeIndex) => {
    const holePolygon = hole.map(pointFromTuple)
    for (const roomIndex of roomIndices) {
      const room = detected[roomIndex]
      if (!room) continue
      const assignment = assignments.get(roomIndex)
      if (!assignment) continue
      const clippedOpenings = clipOpeningToRoom(holePolygon, room.poly)
      for (const clipped of clippedOpenings) {
        assignment.holes.push(clipped.map(pointToTuple))
        assignment.holeMetadata.push(surface.holeMetadata[holeIndex] ?? { source: 'manual' })
      }
    }
  })

  return assignments
}

function sameHoleMetadata(
  current: SlabNodeType['holeMetadata'],
  next: SlabNodeType['holeMetadata'],
) {
  return (
    current.length === next.length &&
    current.every((metadata, index) => {
      const candidate = next[index]
      return (
        candidate?.source === metadata.source &&
        candidate.stairId === metadata.stairId &&
        candidate.elevatorId === metadata.elevatorId
      )
    })
  )
}

function mergedSurfaceOpenings(surfaces: SurfaceWithOpenings[]) {
  const holes: Array<Array<[number, number]>> = []
  const holeMetadata: SlabNodeType['holeMetadata'] = []
  const seen = new Set<string>()

  for (const surface of surfaces) {
    surface.holes.forEach((hole, index) => {
      const metadata = surface.holeMetadata[index] ?? { source: 'manual' }
      const key = JSON.stringify([hole, metadata])
      if (seen.has(key)) return
      seen.add(key)
      holes.push(hole)
      holeMetadata.push(metadata)
    })
  }

  return { holes, holeMetadata }
}

function slabMergeSettingsSignature(slab: SlabNodeType) {
  return JSON.stringify([
    slab.elevation,
    slab.thickness,
    slab.recessed,
    slab.material ?? null,
    slab.materialPreset ?? null,
    slab.slots ?? null,
    slab.visible,
  ])
}

function ceilingMergeSettingsSignature(ceiling: CeilingNodeType) {
  return JSON.stringify([
    ceiling.height ?? null,
    ceiling.material ?? null,
    ceiling.materialPreset ?? null,
    ceiling.slots ?? null,
    ceiling.visible,
  ])
}

function wallGeometrySignature(wall: WallNode) {
  return [
    wall.id,
    wall.start[0].toFixed(4),
    wall.start[1].toFixed(4),
    wall.end[0].toFixed(4),
    wall.end[1].toFixed(4),
    getClampedWallCurveOffset(wall).toFixed(4),
  ].join('|')
}

function buildSpace(levelId: string, room: ExtractedRoom): Space {
  const signature = polygonSignature(room.polygon)
  return {
    id: `space-${levelId}-${signature.slice(0, 12)}`,
    levelId,
    polygon: room.polygon.map(pointToTuple),
    wallIds: [...new Set(room.boundaryFaces.map((boundary) => boundary.wallId))],
    boundaryFaces: room.boundaryFaces,
    isExterior: false,
  }
}

function sameStringSet(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false
  const right = new Set(b)
  return a.every((value) => right.has(value))
}

export function planAutoZonesForLevel(
  spaces: readonly Space[],
  existingZones: readonly ZoneNodeType[],
): AutoZoneSyncPlan {
  const update: AutoZoneSyncPlan['update'] = []

  for (const zone of existingZones) {
    const storedSignature = polygonSignature(zone.polygon.map(pointFromTuple))
    const matchingSpace =
      zone.autoFromWalls && zone.boundaryWallIds.length >= 3
        ? spaces.find((space) => sameStringSet(space.wallIds, zone.boundaryWallIds))
        : spaces.find(
            (space) => polygonSignature(space.polygon.map(pointFromTuple)) === storedSignature,
          )
    if (!matchingSpace) continue

    const data: Partial<ZoneNodeType> = {}
    if (!zone.autoFromWalls) data.autoFromWalls = true
    if (!sameStringSet(zone.boundaryWallIds, matchingSpace.wallIds)) {
      data.boundaryWallIds = matchingSpace.wallIds
    }
    if (!sameTuplePolygon(zone.polygon, matchingSpace.polygon)) {
      data.polygon = matchingSpace.polygon
    }
    if (Object.keys(data).length > 0) update.push({ id: zone.id, data })
  }

  return { update }
}

export function resolveAutoZonePolygon(
  zone: Pick<ZoneNodeType, 'autoFromWalls' | 'boundaryWallIds' | 'polygon'>,
  resolve: (id: AnyNodeId) => unknown,
): ZoneNodeType['polygon'] {
  if (!zone.autoFromWalls || zone.boundaryWallIds.length < 3) return zone.polygon
  const walls = zone.boundaryWallIds.flatMap((id) => {
    const node = resolve(id)
    return node && typeof node === 'object' && 'type' in node && node.type === 'wall'
      ? [node as WallNode]
      : []
  })
  if (walls.length !== zone.boundaryWallIds.length) return zone.polygon
  const room = extractRooms(walls).find((candidate) =>
    sameStringSet(
      [...new Set(candidate.boundaryFaces.map((boundary) => boundary.wallId))],
      zone.boundaryWallIds,
    ),
  )
  return room ? room.polygon.map(pointToTuple) : zone.polygon
}

export function planAutoSlabsForLevel(
  roomPolygons: Point2D[][],
  existingSlabs: SlabNodeType[],
  namingSlabs: Array<{ name?: string }> = existingSlabs,
): AutoSlabSyncPlan {
  const manualSlabs = existingSlabs.filter((slab) => !slab.autoFromWalls)
  const manualSignatures = new Set(
    manualSlabs.map((slab) => polygonSignature(slab.polygon.map(pointFromTuple))),
  )
  const manualPolygons = manualSlabs.map((slab) => slab.polygon.map(pointFromTuple))

  const detectedAll: DetectedRoom[] = roomPolygons
    .map((poly) => ({
      poly: simplifyClosedPolygon(poly.map(pointToTuple), AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE).map(
        pointFromTuple,
      ),
      sig: '',
      centroid: { x: 0, y: 0 },
      area: 0,
      bbox: bboxOf([]),
    }))
    .map((room) => ({
      ...room,
      sig: polygonSignature(room.poly),
      centroid: polygonCentroid(room.poly),
      area: Math.abs(polygonArea(room.poly)),
      bbox: bboxOf(room.poly),
    }))

  const detected = detectedAll.filter(
    ({ sig, poly }) => !manualSignatures.has(sig) && !matchesManualFootprint(poly, manualPolygons),
  )

  const existingAuto = existingSlabs.filter((slab) => slab.autoFromWalls)
  const existingAutoMeta = existingAuto.map((slab) => {
    const poly = slab.polygon.map(pointFromTuple)
    return {
      slab,
      sig: polygonSignature(poly),
      centroid: polygonCentroid(poly),
      area: Math.abs(polygonArea(poly)),
      bbox: bboxOf(poly),
    }
  })

  const conflictingMergeSlabIds = new Set<string>()
  const conflictingMergeSlabRoomIndices = new Set<number>()
  const compatibleMergeSlabsByRoomIndex = new Map<number, SlabNodeType[]>()
  detected.forEach((room, roomIndex) => {
    const contributors = existingAuto.filter(
      (slab) =>
        polygonCoverageRatio(slab.polygon.map(pointFromTuple), [room.poly]) >=
        ORPHAN_MERGE_COVERAGE_THRESHOLD,
    )
    if (contributors.length < 2) return

    const signatures = new Set(contributors.map(slabMergeSettingsSignature))
    if (signatures.size > 1) {
      conflictingMergeSlabRoomIndices.add(roomIndex)
      for (const slab of contributors) conflictingMergeSlabIds.add(slab.id)
      return
    }
    compatibleMergeSlabsByRoomIndex.set(roomIndex, contributors)
  })

  const matchedSlabIds = new Set<string>()
  const matchedDetectedIdx = new Set<number>()
  const roomIndexBySlabId = new Map<string, number>()
  const sourceSlabIdByRoomIndex = new Map<number, string>()

  const autoBySignature = new Map<string, Array<(typeof existingAutoMeta)[number]>>()
  for (const entry of existingAutoMeta) {
    const bucket = autoBySignature.get(entry.sig) ?? []
    bucket.push(entry)
    autoBySignature.set(entry.sig, bucket)
  }

  detected.forEach((room, index) => {
    if (conflictingMergeSlabRoomIndices.has(index)) {
      matchedDetectedIdx.add(index)
      return
    }
    const existing = autoBySignature.get(room.sig)?.shift()
    if (!existing) return

    matchedDetectedIdx.add(index)
    matchedSlabIds.add(existing.slab.id)
    roomIndexBySlabId.set(existing.slab.id, index)
    sourceSlabIdByRoomIndex.set(index, existing.slab.id)
  })

  const remainingDetected = detected
    .map((room, index) => ({ room, index }))
    .filter(({ index }) => !matchedDetectedIdx.has(index))
    .sort((a, b) => b.room.area - a.room.area)

  const remainingAuto = existingAutoMeta.filter((entry) => !matchedSlabIds.has(entry.slab.id))

  for (const { room, index } of remainingDetected) {
    let bestMatch: { entry: (typeof remainingAuto)[number]; score: number } | null = null

    for (const entry of remainingAuto) {
      if (matchedSlabIds.has(entry.slab.id)) continue

      const dx = room.centroid.x - entry.centroid.x
      const dy = room.centroid.y - entry.centroid.y
      const dist = Math.hypot(dx, dy)
      const areaRatio = entry.area > 1e-6 ? room.area / entry.area : 999
      const areaPenalty = Math.abs(Math.log(Math.max(1e-6, areaRatio)))
      const overlap = bboxOverlapArea(room.bbox, entry.bbox)

      if (overlap <= 0.0001 && dist > 1.5) continue

      const score = dist + areaPenalty * 0.35
      if (!bestMatch || score < bestMatch.score) {
        bestMatch = { entry, score }
      }
    }

    if (!bestMatch) continue

    matchedDetectedIdx.add(index)
    matchedSlabIds.add(bestMatch.entry.slab.id)
    roomIndexBySlabId.set(bestMatch.entry.slab.id, index)
    sourceSlabIdByRoomIndex.set(index, bestMatch.entry.slab.id)
  }

  detected.forEach((room, index) => {
    if (sourceSlabIdByRoomIndex.has(index)) return
    let bestSource: { id: string; coverage: number } | null = null
    for (const entry of existingAutoMeta) {
      const coverage = polygonCoverageRatio(room.poly, [entry.slab.polygon.map(pointFromTuple)])
      if (coverage <= 0 || (bestSource && coverage <= bestSource.coverage)) continue
      bestSource = { id: entry.slab.id, coverage }
    }
    if (bestSource) sourceSlabIdByRoomIndex.set(index, bestSource.id)
  })

  const detectedRoomPolygons = detectedAll.map((room) => room.poly)
  const slabsToDelete: Array<SlabNodeType['id']> = []
  const slabDemotions: AutoSlabSyncPlan['update'] = []
  for (const slab of existingAuto) {
    if (roomIndexBySlabId.has(slab.id)) continue

    if (conflictingMergeSlabIds.has(slab.id)) {
      slabDemotions.push({ id: slab.id, data: { autoFromWalls: false } })
      continue
    }

    const coverage = polygonCoverageRatio(slab.polygon.map(pointFromTuple), detectedRoomPolygons)
    if (coverage >= ORPHAN_MERGE_COVERAGE_THRESHOLD) {
      slabsToDelete.push(slab.id)
    } else {
      // Render offsets derive from level context at geometry build time, so
      // demotion leaves the stored polygon untouched (same as ceilings).
      slabDemotions.push({ id: slab.id, data: { autoFromWalls: false } })
    }
  }

  const openingAssignmentsBySlabId = new Map<string, ReturnType<typeof partitionSurfaceOpenings>>()
  for (const slab of existingAuto) {
    const roomIndices = [...sourceSlabIdByRoomIndex.entries()]
      .filter(([, slabId]) => slabId === slab.id)
      .map(([roomIndex]) => roomIndex)
    if (roomIndices.length === 0) continue
    openingAssignmentsBySlabId.set(slab.id, partitionSurfaceOpenings(slab, roomIndices, detected))
  }

  const slabsToUpdate = existingAuto.flatMap((slab) => {
    const roomIndex = roomIndexBySlabId.get(slab.id)
    if (roomIndex == null) return []
    const room = detected[roomIndex]
    if (!room) return []
    const polygon = room.poly.map(pointToTuple)
    const openings = compatibleMergeSlabsByRoomIndex.has(roomIndex)
      ? mergedSurfaceOpenings(compatibleMergeSlabsByRoomIndex.get(roomIndex) ?? [])
      : (openingAssignmentsBySlabId.get(slab.id)?.get(roomIndex) ?? {
          holes: [],
          holeMetadata: [],
        })
    const data: Partial<SlabNodeType> = {}
    if (!sameTuplePolygon(slab.polygon, polygon)) data.polygon = polygon
    if (!sameTuplePolygons(slab.holes, openings.holes)) data.holes = openings.holes
    if (!sameHoleMetadata(slab.holeMetadata, openings.holeMetadata)) {
      data.holeMetadata = openings.holeMetadata
    }
    return Object.keys(data).length > 0 ? [{ id: slab.id, data }] : []
  })
  slabsToUpdate.push(...slabDemotions)

  const plannedSlabsForNaming: Array<{ name?: string }> = [...namingSlabs]
  const slabsToCreate: SlabNodeType[] = []
  for (let index = 0; index < detected.length; index += 1) {
    if (matchedDetectedIdx.has(index)) continue

    const room = detected[index]
    if (!room) continue

    const name = nextAutoRoomName(plannedSlabsForNaming, 'Slab')
    plannedSlabsForNaming.push({ name })
    const sourceId = sourceSlabIdByRoomIndex.get(index)
    const source = sourceId ? existingAuto.find((slab) => slab.id === sourceId) : undefined
    const openings = sourceId ? openingAssignmentsBySlabId.get(sourceId)?.get(index) : undefined

    slabsToCreate.push(
      SlabNode.parse({
        name,
        polygon: room.poly.map(pointToTuple),
        holes: openings?.holes ?? [],
        holeMetadata: openings?.holeMetadata ?? [],
        elevation: source?.elevation ?? DEFAULT_AUTO_SLAB_ELEVATION,
        thickness: source?.thickness,
        recessed: source?.recessed,
        material: source?.material,
        materialPreset: source?.materialPreset,
        slots: source?.slots,
        visible: source?.visible,
        autoFromWalls: true,
      }),
    )
  }

  return {
    create: slabsToCreate,
    update: slabsToUpdate,
    delete: slabsToDelete,
  }
}

function syncAutoSlabsForLevel(
  levelId: string,
  roomPolygons: Point2D[][],
  existingSlabs: SlabNodeType[],
  sceneStore: any,
  namingSlabs: Array<{ name?: string }> = existingSlabs,
) {
  const plan = planAutoSlabsForLevel(roomPolygons, existingSlabs, namingSlabs)

  if (plan.delete.length > 0) {
    sceneStore.getState().deleteNodes(plan.delete)
  }

  if (plan.update.length > 0) {
    sceneStore.getState().updateNodes(plan.update)
  }

  if (plan.create.length > 0) {
    sceneStore.getState().createNodes(plan.create.map((node) => ({ node, parentId: levelId })))
  }

  return plan
}

export function planAutoCeilingsForLevel(
  roomPolygons: Point2D[][],
  existingCeilings: CeilingNodeType[],
  context: AutoCeilingPlanningContext = {},
  namingCeilings: Array<{ name?: string }> = existingCeilings,
): AutoCeilingSyncPlan {
  const manualCeilings = existingCeilings.filter((ceiling) => !ceiling.autoFromWalls)
  const manualSignatures = new Set(
    manualCeilings.map((ceiling) => polygonSignature(ceiling.polygon.map(pointFromTuple))),
  )
  const manualPolygons = manualCeilings.map((ceiling) => ceiling.polygon.map(pointFromTuple))

  const detectedAll: DetectedRoom[] = roomPolygons
    .map((poly) => ({
      poly: simplifyClosedPolygon(poly.map(pointToTuple), AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE).map(
        pointFromTuple,
      ),
      sig: '',
      centroid: { x: 0, y: 0 },
      area: 0,
      bbox: bboxOf([]),
    }))
    .map((room) => ({
      ...room,
      sig: polygonSignature(room.poly),
      centroid: polygonCentroid(room.poly),
      area: Math.abs(polygonArea(room.poly)),
      bbox: bboxOf(room.poly),
    }))

  const detected = detectedAll.filter(
    ({ sig, poly }) => !manualSignatures.has(sig) && !matchesManualFootprint(poly, manualPolygons),
  )

  const existingAuto = existingCeilings.filter((ceiling) => ceiling.autoFromWalls)
  const existingAutoMeta = existingAuto.map((ceiling) => {
    const poly = ceiling.polygon.map(pointFromTuple)
    return {
      ceiling,
      sig: polygonSignature(poly),
      centroid: polygonCentroid(poly),
      area: Math.abs(polygonArea(poly)),
      bbox: bboxOf(poly),
    }
  })

  const conflictingMergeCeilingIds = new Set<string>()
  const conflictingMergeCeilingRoomIndices = new Set<number>()
  const compatibleMergeCeilingsByRoomIndex = new Map<number, CeilingNodeType[]>()
  detected.forEach((room, roomIndex) => {
    const contributors = existingAuto.filter(
      (ceiling) =>
        polygonCoverageRatio(ceiling.polygon.map(pointFromTuple), [room.poly]) >=
        ORPHAN_MERGE_COVERAGE_THRESHOLD,
    )
    if (contributors.length < 2) return

    const signatures = new Set(contributors.map(ceilingMergeSettingsSignature))
    if (signatures.size > 1) {
      conflictingMergeCeilingRoomIndices.add(roomIndex)
      for (const ceiling of contributors) conflictingMergeCeilingIds.add(ceiling.id)
      return
    }
    compatibleMergeCeilingsByRoomIndex.set(roomIndex, contributors)
  })

  const matchedCeilingIds = new Set<string>()
  const matchedDetectedIdx = new Set<number>()
  const roomIndexByCeilingId = new Map<string, number>()
  const sourceCeilingIdByRoomIndex = new Map<number, string>()

  const autoBySignature = new Map<string, Array<(typeof existingAutoMeta)[number]>>()
  for (const entry of existingAutoMeta) {
    const bucket = autoBySignature.get(entry.sig) ?? []
    bucket.push(entry)
    autoBySignature.set(entry.sig, bucket)
  }

  detected.forEach((room, index) => {
    if (conflictingMergeCeilingRoomIndices.has(index)) {
      matchedDetectedIdx.add(index)
      return
    }
    const existing = autoBySignature.get(room.sig)?.shift()
    if (!existing) return

    matchedDetectedIdx.add(index)
    matchedCeilingIds.add(existing.ceiling.id)
    roomIndexByCeilingId.set(existing.ceiling.id, index)
    sourceCeilingIdByRoomIndex.set(index, existing.ceiling.id)
  })

  const remainingDetected = detected
    .map((room, index) => ({ room, index }))
    .filter(({ index }) => !matchedDetectedIdx.has(index))
    .sort((a, b) => b.room.area - a.room.area)

  const remainingAuto = existingAutoMeta.filter((entry) => !matchedCeilingIds.has(entry.ceiling.id))

  for (const { room, index } of remainingDetected) {
    let bestMatch: { entry: (typeof remainingAuto)[number]; score: number } | null = null

    for (const entry of remainingAuto) {
      if (matchedCeilingIds.has(entry.ceiling.id)) continue

      const dx = room.centroid.x - entry.centroid.x
      const dy = room.centroid.y - entry.centroid.y
      const dist = Math.hypot(dx, dy)
      const areaRatio = entry.area > 1e-6 ? room.area / entry.area : 999
      const areaPenalty = Math.abs(Math.log(Math.max(1e-6, areaRatio)))
      const overlap = bboxOverlapArea(room.bbox, entry.bbox)

      if (overlap <= 0.0001 && dist > 1.5) continue

      const score = dist + areaPenalty * 0.35
      if (!bestMatch || score < bestMatch.score) {
        bestMatch = { entry, score }
      }
    }

    if (!bestMatch) continue

    matchedDetectedIdx.add(index)
    matchedCeilingIds.add(bestMatch.entry.ceiling.id)
    roomIndexByCeilingId.set(bestMatch.entry.ceiling.id, index)
    sourceCeilingIdByRoomIndex.set(index, bestMatch.entry.ceiling.id)
  }

  detected.forEach((room, index) => {
    if (sourceCeilingIdByRoomIndex.has(index)) return
    let bestSource: { id: string; coverage: number } | null = null
    for (const entry of existingAutoMeta) {
      const coverage = polygonCoverageRatio(room.poly, [entry.ceiling.polygon.map(pointFromTuple)])
      if (coverage <= 0 || (bestSource && coverage <= bestSource.coverage)) continue
      bestSource = { id: entry.ceiling.id, coverage }
    }
    if (bestSource) sourceCeilingIdByRoomIndex.set(index, bestSource.id)
  })

  const detectedRoomPolygons = detectedAll.map((room) => room.poly)
  const ceilingsToDelete: Array<CeilingNodeType['id']> = []
  const ceilingDemotions: AutoCeilingSyncPlan['update'] = []
  for (const ceiling of existingAuto) {
    if (roomIndexByCeilingId.has(ceiling.id)) continue

    if (conflictingMergeCeilingIds.has(ceiling.id)) {
      ceilingDemotions.push({ id: ceiling.id, data: { autoFromWalls: false } })
      continue
    }

    const coverage = polygonCoverageRatio(ceiling.polygon.map(pointFromTuple), detectedRoomPolygons)
    if (coverage >= ORPHAN_MERGE_COVERAGE_THRESHOLD) {
      ceilingsToDelete.push(ceiling.id)
    } else {
      ceilingDemotions.push({ id: ceiling.id, data: { autoFromWalls: false } })
    }
  }

  // Stage 3-B reactive re-clamp (clamp-never-ask): a covering slab
  // created, moved, or thickened on the level above can leave an EXISTING
  // manual explicit-height ceiling poking into its solid. Clamp explicit
  // heights down to the bound; never raise them — a user-lowered ceiling
  // is intent, only an over-bound one is a conflict. Follows-mode
  // ceilings (absent height) derive under the bound by construction and
  // are skipped, so the clamp can never convert one to an explicit
  // height.
  const manualClamps: AutoCeilingSyncPlan['update'] = manualCeilings.flatMap((ceiling) => {
    if (ceiling.height == null) return []
    const bound = resolveCeilingClampBound(ceiling.polygon, context)
    if (!Number.isFinite(bound)) return []
    return ceiling.height > bound + CEILING_HEIGHT_EPSILON
      ? [{ id: ceiling.id, data: { height: bound } }]
      : []
  })

  const openingAssignmentsByCeilingId = new Map<
    string,
    ReturnType<typeof partitionSurfaceOpenings>
  >()
  for (const ceiling of existingAuto) {
    const roomIndices = [...sourceCeilingIdByRoomIndex.entries()]
      .filter(([, ceilingId]) => ceilingId === ceiling.id)
      .map(([roomIndex]) => roomIndex)
    if (roomIndices.length === 0) continue
    openingAssignmentsByCeilingId.set(
      ceiling.id,
      partitionSurfaceOpenings(ceiling, roomIndices, detected),
    )
  }

  const ceilingsToUpdate = existingAuto.flatMap((ceiling) => {
    const roomIndex = roomIndexByCeilingId.get(ceiling.id)
    if (roomIndex == null) return []
    const room = detected[roomIndex]
    if (!room) return []
    const polygon = room.poly.map(pointToTuple)
    const openings = compatibleMergeCeilingsByRoomIndex.has(roomIndex)
      ? mergedSurfaceOpenings(compatibleMergeCeilingsByRoomIndex.get(roomIndex) ?? [])
      : (openingAssignmentsByCeilingId.get(ceiling.id)?.get(roomIndex) ?? {
          holes: [],
          holeMetadata: [],
        })
    const data: Partial<CeilingNodeType> = {}
    if (!sameTuplePolygon(ceiling.polygon, polygon)) data.polygon = polygon
    if (!sameTuplePolygons(ceiling.holes, openings.holes)) data.holes = openings.holes
    if (!sameHoleMetadata(ceiling.holeMetadata, openings.holeMetadata)) {
      data.holeMetadata = openings.holeMetadata
    }
    if (ceiling.height != null) {
      const bound = resolveCeilingClampBound(polygon, context)
      if (Number.isFinite(bound) && ceiling.height > bound + CEILING_HEIGHT_EPSILON) {
        data.height = bound
      }
    }
    return Object.keys(data).length > 0 ? [{ id: ceiling.id, data }] : []
  })
  ceilingsToUpdate.push(...ceilingDemotions, ...manualClamps)

  const plannedCeilingsForNaming: Array<{ name?: string }> = [...namingCeilings]
  const ceilingsToCreate: CeilingNodeType[] = []
  for (let index = 0; index < detected.length; index += 1) {
    if (matchedDetectedIdx.has(index)) continue

    const room = detected[index]
    if (!room) continue

    const name = nextAutoRoomName(plannedCeilingsForNaming, 'Ceiling')
    plannedCeilingsForNaming.push({ name })
    const sourceId = sourceCeilingIdByRoomIndex.get(index)
    const source = sourceId ? existingAuto.find((ceiling) => ceiling.id === sourceId) : undefined
    const openings = sourceId ? openingAssignmentsByCeilingId.get(sourceId)?.get(index) : undefined
    const inheritedHeight =
      source?.height == null
        ? {}
        : {
            height: Math.min(
              source.height,
              resolveCeilingClampBound(room.poly.map(pointToTuple), context),
            ),
          }

    // Uncustomized auto ceilings stay height-less so they continue to follow
    // the level top; an inherited explicit height is clamped to the new room.
    ceilingsToCreate.push(
      CeilingNode.parse({
        name,
        polygon: room.poly.map(pointToTuple),
        holes: openings?.holes ?? [],
        holeMetadata: openings?.holeMetadata ?? [],
        material: source?.material,
        materialPreset: source?.materialPreset,
        slots: source?.slots,
        visible: source?.visible,
        ...inheritedHeight,
        autoFromWalls: true,
      }),
    )
  }

  return {
    create: ceilingsToCreate,
    update: ceilingsToUpdate,
    delete: ceilingsToDelete,
  }
}

function syncAutoCeilingsForLevel(
  levelId: string,
  roomPolygons: Point2D[][],
  existingCeilings: CeilingNodeType[],
  sceneStore: any,
  context: AutoCeilingPlanningContext = {},
  namingCeilings: Array<{ name?: string }> = existingCeilings,
) {
  const plan = planAutoCeilingsForLevel(roomPolygons, existingCeilings, context, namingCeilings)

  if (plan.delete.length > 0) {
    sceneStore.getState().deleteNodes(plan.delete)
  }

  if (plan.update.length > 0) {
    sceneStore.getState().updateNodes(plan.update)
  }

  if (plan.create.length > 0) {
    sceneStore.getState().createNodes(plan.create.map((node) => ({ node, parentId: levelId })))
  }
}

function detectSpacesFromWalls(levelId: string, walls: WallNode[]) {
  const rooms = extractRooms(walls)
  const roomPolygons = rooms.map((room) => room.polygon)
  const wallUpdates: WallSideUpdate[] = walls.map((wall) => ({
    wallId: wall.id,
    ...(resolveWallSurfaceSides(wall, roomPolygons) satisfies Pick<
      WallSideUpdate,
      'frontSide' | 'backSide'
    >),
  }))

  return {
    roomPolygons,
    spaces: rooms.map((room) => buildSpace(levelId, room)),
    wallUpdates,
  }
}

export function detectSpacesForLevel(levelId: string, walls: WallNode[]) {
  return detectSpacesFromWalls(levelId, walls)
}

type SceneNodes = SceneCommit['current']['nodes']

function wallsForLevel(nodes: SceneNodes, levelId: string) {
  return Object.values(nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && node.parentId === levelId,
  )
}

function levelChildren(nodes: SceneNodes, levelId: string) {
  const level = nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') return []
  return level.children.flatMap((id) => {
    const node = nodes[id as AnyNodeId]
    return node ? [node] : []
  })
}

function changedWallIdsByLevel(
  before: SceneNodes,
  current: SceneNodes,
  candidateIds?: ReadonlySet<AnyNodeId>,
) {
  const changes = new Map<string, Set<string>>()
  const wallIds = new Set<string>(candidateIds)
  if (!candidateIds) {
    for (const node of Object.values(before)) {
      if (node?.type === 'wall') wallIds.add(node.id)
    }
    for (const node of Object.values(current)) {
      if (node?.type === 'wall') wallIds.add(node.id)
    }
  }

  const markChanged = (levelId: string | null | undefined, wallId: string) => {
    if (!levelId) return
    const ids = changes.get(levelId) ?? new Set<string>()
    ids.add(wallId)
    changes.set(levelId, ids)
  }

  for (const wallId of wallIds) {
    const beforeWall = before[wallId as AnyNodeId]
    const currentWall = current[wallId as AnyNodeId]
    const previous = beforeWall?.type === 'wall' ? beforeWall : null
    const next = currentWall?.type === 'wall' ? currentWall : null
    const unchanged =
      previous &&
      next &&
      previous.parentId === next.parentId &&
      wallGeometrySignature(previous) === wallGeometrySignature(next)
    if (unchanged) continue
    markChanged(previous?.parentId, wallId)
    markChanged(next?.parentId, wallId)
  }

  return changes
}

const TOPOLOGY_INDEX_CELL_SIZE = 2
const TOPOLOGY_INDEX_QUERY_MARGIN = WALL_JUNCTION_TOLERANCE + 0.02

type IndexedLevelTopology = {
  walls: Map<string, WallNode>
  rooms: ExtractedRoom[]
  wallIdsByCell: Map<string, Set<string>>
  cellKeysByWallId: Map<string, string[]>
}

export type SpaceTopologyReconcileEvent = {
  levelId: string
  strategy: 'indexed' | 'fallback'
  examinedWallIds: string[]
  affectedBeforeRoomCount: number
  affectedCurrentRoomCount: number
}

export type SpaceDetectionSyncOptions = {
  onTopologyReconcile?: (event: SpaceTopologyReconcileEvent) => void
}

type IndexedTopologyDelta = {
  strategy: SpaceTopologyReconcileEvent['strategy']
  beforeRooms: ExtractedRoom[]
  currentRooms: ExtractedRoom[]
  allBeforeRooms: ExtractedRoom[]
  allCurrentRooms: ExtractedRoom[]
  currentWalls: WallNode[]
  examinedWallIds: string[]
}

function expandedBbox(box: ReturnType<typeof bboxOf>, margin: number) {
  return {
    minX: box.minX - margin,
    minY: box.minY - margin,
    maxX: box.maxX + margin,
    maxY: box.maxY + margin,
  }
}

function wallBbox(wall: WallNode) {
  return bboxOf(sampleWallPointsForRoomDetection(wall))
}

function topologyCellKey(x: number, y: number) {
  return `${x},${y}`
}

function cellKeysForBbox(box: ReturnType<typeof bboxOf>) {
  const minCellX = Math.floor(box.minX / TOPOLOGY_INDEX_CELL_SIZE)
  const maxCellX = Math.floor(box.maxX / TOPOLOGY_INDEX_CELL_SIZE)
  const minCellY = Math.floor(box.minY / TOPOLOGY_INDEX_CELL_SIZE)
  const maxCellY = Math.floor(box.maxY / TOPOLOGY_INDEX_CELL_SIZE)
  const keys: string[] = []

  for (let x = minCellX; x <= maxCellX; x += 1) {
    for (let y = minCellY; y <= maxCellY; y += 1) {
      keys.push(topologyCellKey(x, y))
    }
  }
  return keys
}

function createIndexedLevelTopology(walls: WallNode[]): IndexedLevelTopology {
  const level: IndexedLevelTopology = {
    walls: new Map(),
    rooms: extractRooms(walls),
    wallIdsByCell: new Map(),
    cellKeysByWallId: new Map(),
  }

  for (const wall of walls) {
    level.walls.set(wall.id, wall)
    const keys = cellKeysForBbox(expandedBbox(wallBbox(wall), TOPOLOGY_INDEX_QUERY_MARGIN))
    level.cellKeysByWallId.set(wall.id, keys)
    for (const key of keys) {
      const ids = level.wallIdsByCell.get(key) ?? new Set<string>()
      ids.add(wall.id)
      level.wallIdsByCell.set(key, ids)
    }
  }
  return level
}

function removeIndexedWall(level: IndexedLevelTopology, wallId: string) {
  for (const key of level.cellKeysByWallId.get(wallId) ?? []) {
    const ids = level.wallIdsByCell.get(key)
    ids?.delete(wallId)
    if (ids?.size === 0) level.wallIdsByCell.delete(key)
  }
  level.cellKeysByWallId.delete(wallId)
  level.walls.delete(wallId)
}

function setIndexedWall(level: IndexedLevelTopology, wall: WallNode) {
  removeIndexedWall(level, wall.id)
  level.walls.set(wall.id, wall)
  const keys = cellKeysForBbox(expandedBbox(wallBbox(wall), TOPOLOGY_INDEX_QUERY_MARGIN))
  level.cellKeysByWallId.set(wall.id, keys)
  for (const key of keys) {
    const ids = level.wallIdsByCell.get(key) ?? new Set<string>()
    ids.add(wall.id)
    level.wallIdsByCell.set(key, ids)
  }
}

function queryIndexedWalls(
  level: IndexedLevelTopology,
  box: ReturnType<typeof bboxOf>,
): Set<string> {
  const ids = new Set<string>()
  for (const key of cellKeysForBbox(expandedBbox(box, TOPOLOGY_INDEX_QUERY_MARGIN))) {
    for (const id of level.wallIdsByCell.get(key) ?? []) ids.add(id)
  }
  return ids
}

function roomContainsWallInterior(room: ExtractedRoom, wall: WallNode) {
  const points = sampleWallPointsForRoomDetection(wall)
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!
    const end = points[index + 1]!
    for (const t of [0.25, 0.5, 0.75]) {
      if (
        pointInPolygon(
          {
            x: start.x + (end.x - start.x) * t,
            y: start.y + (end.y - start.y) * t,
          },
          room.polygon,
        )
      ) {
        return true
      }
    }
  }
  return false
}

function roomIdsByWall(rooms: ExtractedRoom[]) {
  const result = new Map<string, Set<number>>()
  rooms.forEach((room, roomIndex) => {
    for (const wallId of roomWallIds(room)) {
      const indices = result.get(wallId) ?? new Set<number>()
      indices.add(roomIndex)
      result.set(wallId, indices)
    }
  })
  return result
}

function sameIndexedWall(left: WallNode | null | undefined, right: WallNode | null | undefined) {
  if (!(left && right)) return left === right
  return (
    left.parentId === right.parentId && wallGeometrySignature(left) === wallGeometrySignature(right)
  )
}

class RoomTopologyIndex {
  private readonly levels = new Map<string, IndexedLevelTopology>()

  rebuild(nodes: SceneNodes) {
    this.levels.clear()
    const wallsByLevel = new Map<string, WallNode[]>()
    for (const node of Object.values(nodes)) {
      if (node?.type !== 'wall' || !node.parentId) continue
      const walls = wallsByLevel.get(node.parentId) ?? []
      walls.push(node)
      wallsByLevel.set(node.parentId, walls)
    }
    for (const [levelId, walls] of wallsByLevel) {
      this.levels.set(levelId, createIndexedLevelTopology(walls))
    }
  }

  spaces() {
    return [...this.levels.entries()].flatMap(([levelId, level]) =>
      level.rooms.map((room) => buildSpace(levelId, room)),
    )
  }

  spacesForLevel(levelId: string) {
    return (this.levels.get(levelId)?.rooms ?? []).map((room) => buildSpace(levelId, room))
  }

  private rebuildLevel(levelId: string, nodes: SceneNodes) {
    const walls = wallsForLevel(nodes, levelId)
    const level = createIndexedLevelTopology(walls)
    this.levels.set(levelId, level)
    return level
  }

  private ensureBeforeLevel(
    levelId: string,
    changedWallIds: ReadonlySet<string>,
    beforeNodes: SceneNodes,
  ) {
    const cached = this.levels.get(levelId)
    if (!cached) return { level: this.rebuildLevel(levelId, beforeNodes), fallback: true }

    for (const wallId of changedWallIds) {
      const beforeNode = beforeNodes[wallId as AnyNodeId]
      const beforeWall =
        beforeNode?.type === 'wall' && beforeNode.parentId === levelId ? beforeNode : null
      if (!sameIndexedWall(cached.walls.get(wallId), beforeWall)) {
        return { level: this.rebuildLevel(levelId, beforeNodes), fallback: true }
      }
    }
    return { level: cached, fallback: false }
  }

  applyWallDelta(
    levelId: string,
    changedWallIds: ReadonlySet<string>,
    beforeNodes: SceneNodes,
    currentNodes: SceneNodes,
  ): IndexedTopologyDelta {
    const ensured = this.ensureBeforeLevel(levelId, changedWallIds, beforeNodes)
    const level = ensured.level
    const allBeforeRooms = [...level.rooms]
    const previousChangedWalls = [...changedWallIds].flatMap((wallId) => {
      const wall = level.walls.get(wallId)
      return wall ? [wall] : []
    })

    for (const wallId of changedWallIds) {
      const node = currentNodes[wallId as AnyNodeId]
      if (node?.type === 'wall' && node.parentId === levelId) setIndexedWall(level, node)
      else removeIndexedWall(level, wallId)
    }

    const currentChangedWalls = [...changedWallIds].flatMap((wallId) => {
      const wall = level.walls.get(wallId)
      return wall ? [wall] : []
    })
    const changedWalls = [...previousChangedWalls, ...currentChangedWalls]
    const affectedBeforeIndices = new Set<number>()
    allBeforeRooms.forEach((room, roomIndex) => {
      if (
        room.boundaryFaces.some((boundary) => changedWallIds.has(boundary.wallId)) ||
        changedWalls.some((wall) => roomContainsWallInterior(room, wall))
      ) {
        affectedBeforeIndices.add(roomIndex)
      }
    })

    const candidateWallIds = new Set<string>(changedWallIds)
    const relevantBeforeIndices = new Set(affectedBeforeIndices)
    const indexedRoomsByWall = roomIdsByWall(allBeforeRooms)

    if (affectedBeforeIndices.size > 0) {
      for (const roomIndex of affectedBeforeIndices) {
        const room = allBeforeRooms[roomIndex]
        if (!room) continue
        for (const wallId of roomWallIds(room)) candidateWallIds.add(wallId)
        for (const wallId of queryIndexedWalls(level, bboxOf(room.polygon))) {
          const wall = level.walls.get(wallId)
          if (wall && roomContainsWallInterior(room, wall)) candidateWallIds.add(wallId)
        }
      }
    } else {
      const queue = [...currentChangedWalls]
      const visited = new Set<string>(changedWallIds)
      while (queue.length > 0) {
        const wall = queue.pop()
        if (!wall) continue
        for (const neighborId of queryIndexedWalls(level, wallBbox(wall))) {
          if (visited.has(neighborId)) continue
          const neighbor = level.walls.get(neighborId)
          if (!(neighbor && wallTouchesOthers(wall, [neighbor]))) continue
          visited.add(neighborId)
          candidateWallIds.add(neighborId)
          const roomIndices = indexedRoomsByWall.get(neighborId)
          if (roomIndices && roomIndices.size > 0) {
            for (const roomIndex of roomIndices) relevantBeforeIndices.add(roomIndex)
          } else {
            queue.push(neighbor)
          }
        }
      }
      for (const roomIndex of relevantBeforeIndices) {
        const room = allBeforeRooms[roomIndex]
        if (!room) continue
        for (const wallId of roomWallIds(room)) candidateWallIds.add(wallId)
      }
    }

    const effectiveChangedWallIds = new Set(changedWallIds)
    for (const wallId of [...candidateWallIds]) {
      const beforeNode = beforeNodes[wallId as AnyNodeId]
      const currentNode = currentNodes[wallId as AnyNodeId]
      const beforeWall =
        beforeNode?.type === 'wall' && beforeNode.parentId === levelId ? beforeNode : null
      const currentWall =
        currentNode?.type === 'wall' && currentNode.parentId === levelId ? currentNode : null
      if (!sameIndexedWall(beforeWall, currentWall)) effectiveChangedWallIds.add(wallId)
      if (currentWall) setIndexedWall(level, currentWall)
      else removeIndexedWall(level, wallId)
    }

    const relevantBeforeRooms = [...relevantBeforeIndices]
      .map((roomIndex) => allBeforeRooms[roomIndex])
      .filter((room): room is ExtractedRoom => Boolean(room))
    const beforeCandidateWalls = [...candidateWallIds].flatMap((wallId) => {
      const node = beforeNodes[wallId as AnyNodeId]
      return node?.type === 'wall' && node.parentId === levelId ? [node] : []
    })
    const currentCandidateWalls = [...candidateWallIds].flatMap((wallId) => {
      const node = currentNodes[wallId as AnyNodeId]
      return node?.type === 'wall' && node.parentId === levelId ? [node] : []
    })

    if (relevantBeforeRooms.length === 0 && beforeCandidateWalls.length >= 3) {
      const localBeforeRooms = extractRooms(beforeCandidateWalls)
      localBeforeRooms.forEach((room) => {
        if (room.boundaryFaces.some((boundary) => effectiveChangedWallIds.has(boundary.wallId))) {
          relevantBeforeRooms.push(room)
        }
      })
    }

    const localCurrentRooms = extractRooms(currentCandidateWalls)
    const affected = affectedRoomsForWallDelta(
      relevantBeforeRooms,
      localCurrentRooms,
      effectiveChangedWallIds,
    )

    const affectedBeforeSignatures = new Set(
      affected.before.map((room) => polygonSignature(room.polygon)),
    )
    const affectedCurrentSignatures = new Set(
      affected.current.map((room) => polygonSignature(room.polygon)),
    )
    const allCurrentRooms = allBeforeRooms.filter(
      (room) => !affectedBeforeSignatures.has(polygonSignature(room.polygon)),
    )
    for (const room of affected.current) {
      const signature = polygonSignature(room.polygon)
      const existingIndex = allCurrentRooms.findIndex(
        (candidate) => polygonSignature(candidate.polygon) === signature,
      )
      if (existingIndex >= 0) allCurrentRooms.splice(existingIndex, 1)
      allCurrentRooms.push(room)
    }
    level.rooms = allCurrentRooms

    return {
      strategy: ensured.fallback ? 'fallback' : 'indexed',
      beforeRooms: affected.before,
      currentRooms: affected.current,
      allBeforeRooms,
      allCurrentRooms,
      currentWalls: currentCandidateWalls,
      examinedWallIds: [...candidateWallIds].sort(),
    }
  }
}

function zoneGeometrySignature(zone: ZoneNodeType) {
  return [
    zone.autoFromWalls ? 'auto' : 'manual',
    zone.boundaryWallIds.slice().sort().join(','),
    zone.polygon.map(([x, z]) => `${x.toFixed(4)},${z.toFixed(4)}`).join(';'),
  ].join('|')
}

function changedZoneIdsByLevel(
  before: SceneNodes,
  current: SceneNodes,
  candidateIds?: ReadonlySet<AnyNodeId>,
) {
  const changes = new Map<string, Set<string>>()
  const zoneIds = new Set<string>(candidateIds)
  if (!candidateIds) {
    for (const node of Object.values(before)) {
      if (node?.type === 'zone') zoneIds.add(node.id)
    }
    for (const node of Object.values(current)) {
      if (node?.type === 'zone') zoneIds.add(node.id)
    }
  }

  const markChanged = (levelId: string | null | undefined, zoneId: string) => {
    if (!levelId) return
    const ids = changes.get(levelId) ?? new Set<string>()
    ids.add(zoneId)
    changes.set(levelId, ids)
  }

  for (const zoneId of zoneIds) {
    const beforeNode = before[zoneId as AnyNodeId]
    const currentNode = current[zoneId as AnyNodeId]
    const previous = beforeNode?.type === 'zone' ? beforeNode : null
    const next = currentNode?.type === 'zone' ? currentNode : null
    const unchanged =
      previous &&
      next &&
      previous.parentId === next.parentId &&
      zoneGeometrySignature(previous) === zoneGeometrySignature(next)
    if (unchanged) continue
    markChanged(previous?.parentId, zoneId)
    markChanged(next?.parentId, zoneId)
  }

  return changes
}

function roomWallIds(room: ExtractedRoom) {
  return new Set(room.boundaryFaces.map((boundary) => boundary.wallId))
}

function roomsAreRelated(beforeRoom: ExtractedRoom, currentRoom: ExtractedRoom) {
  const beforeIds = roomWallIds(beforeRoom)
  const currentIds = roomWallIds(currentRoom)
  const sharedWallCount = [...currentIds].filter((wallId) => beforeIds.has(wallId)).length
  const smallerBoundarySize = Math.min(beforeIds.size, currentIds.size)
  if (sharedWallCount >= 2 && sharedWallCount >= Math.ceil(smallerBoundarySize / 2)) {
    return true
  }
  if (bboxOverlapArea(bboxOf(beforeRoom.polygon), bboxOf(currentRoom.polygon)) <= 1e-6) {
    return false
  }
  return (
    polygonCoverageRatio(beforeRoom.polygon, [currentRoom.polygon]) > 0 ||
    polygonCoverageRatio(currentRoom.polygon, [beforeRoom.polygon]) > 0
  )
}

function affectedRoomsForWallDelta(
  beforeRooms: ExtractedRoom[],
  currentRooms: ExtractedRoom[],
  changedWallIds: ReadonlySet<string>,
) {
  const beforeIndices = new Set<number>()
  const currentIndices = new Set<number>()

  beforeRooms.forEach((room, index) => {
    if (room.boundaryFaces.some((boundary) => changedWallIds.has(boundary.wallId))) {
      beforeIndices.add(index)
    }
  })
  currentRooms.forEach((room, index) => {
    if (room.boundaryFaces.some((boundary) => changedWallIds.has(boundary.wallId))) {
      currentIndices.add(index)
    }
  })

  let changed = true
  while (changed) {
    changed = false
    beforeRooms.forEach((beforeRoom, beforeIndex) => {
      currentRooms.forEach((currentRoom, currentIndex) => {
        if (!roomsAreRelated(beforeRoom, currentRoom)) return
        if (beforeIndices.has(beforeIndex) && !currentIndices.has(currentIndex)) {
          currentIndices.add(currentIndex)
          changed = true
        }
        if (currentIndices.has(currentIndex) && !beforeIndices.has(beforeIndex)) {
          beforeIndices.add(beforeIndex)
          changed = true
        }
      })
    })
  }

  return {
    before: [...beforeIndices].map((index) => beforeRooms[index]!).filter(Boolean),
    current: [...currentIndices].map((index) => currentRooms[index]!).filter(Boolean),
  }
}

type RoomSurface = SlabNodeType | CeilingNodeType

function surfaceTouchesRooms(surface: RoomSurface, rooms: ExtractedRoom[]) {
  const polygon = surface.polygon.map(pointFromTuple)
  return rooms.some(
    (room) =>
      polygonCoverageRatio(polygon, [room.polygon]) > 0 ||
      polygonCoverageRatio(room.polygon, [polygon]) > 0,
  )
}

function roomHasAutoSurface(room: ExtractedRoom, surfaces: RoomSurface[]) {
  return matchesManualFootprint(
    room.polygon,
    surfaces
      .filter((surface) => surface.autoFromWalls)
      .map((surface) => surface.polygon.map(pointFromTuple)),
  )
}

function roomsEligibleForAutoSurface(
  beforeRooms: ExtractedRoom[],
  currentRooms: ExtractedRoom[],
  currentSurfaces: RoomSurface[],
) {
  return currentRooms.filter((currentRoom) => {
    const related = beforeRooms.flatMap((beforeRoom) => {
      if (!roomsAreRelated(beforeRoom, currentRoom)) return []
      return [
        {
          room: beforeRoom,
          coverage: polygonCoverageRatio(currentRoom.polygon, [beforeRoom.polygon]),
        },
      ]
    })
    const maxCoverage = Math.max(0, ...related.map(({ coverage }) => coverage))
    const predecessors =
      currentRooms.length >= beforeRooms.length && maxCoverage > 0
        ? related.filter(({ coverage }) => coverage >= maxCoverage - 1e-6).map(({ room }) => room)
        : related.map(({ room }) => room)
    if (predecessors.length === 0) return true
    return predecessors.every((beforeRoom) => roomHasAutoSurface(beforeRoom, currentSurfaces))
  })
}

function updateSpacesForLevel(levelId: string, spaces: Space[], editorStore: any) {
  const existingSpaces = editorStore.getState().spaces as Record<string, Space>
  const nextSpaces: Record<string, Space> = {}
  for (const [spaceId, space] of Object.entries(existingSpaces)) {
    if (space.levelId !== levelId) nextSpaces[spaceId] = space
  }
  for (const space of spaces) nextSpaces[space.id] = space
  editorStore.getState().setSpaces(nextSpaces)
}

function replaceIndexedSpaces(spaces: Space[], editorStore: any) {
  editorStore.getState().setSpaces(Object.fromEntries(spaces.map((space) => [space.id, space])))
}

function reconcileChangedZones(
  levelId: string,
  changedZoneIds: ReadonlySet<string>,
  currentNodes: SceneNodes,
  sceneStore: any,
  spaces: Space[],
) {
  const zones = [...changedZoneIds].flatMap((id) => {
    const node = currentNodes[id as AnyNodeId]
    return node?.type === 'zone' && node.parentId === levelId ? [ZoneNode.parse(node)] : []
  })
  const plan = planAutoZonesForLevel(spaces, zones)
  if (plan.update.length > 0) sceneStore.getState().updateNodes(plan.update)
}

function reconcileWallTopologyDelta(
  levelId: string,
  topologyDelta: IndexedTopologyDelta,
  currentNodes: SceneNodes,
  sceneStore: any,
  editorStore: any,
): void {
  const { updateNodes } = sceneStore.getState()
  const scopedRooms = [...topologyDelta.beforeRooms, ...topologyDelta.currentRooms]
  const allCurrentRoomPolygons = topologyDelta.allCurrentRooms.map((room) => room.polygon)
  const changedWallUpdates = topologyDelta.currentWalls
    .map((wall) => ({
      wallId: wall.id,
      ...resolveWallSurfaceSides(wall, allCurrentRoomPolygons),
    }))
    .filter((update) => {
      const wall = currentNodes[update.wallId as AnyNodeId]
      return (
        wall?.type === 'wall' &&
        (wall.frontSide !== update.frontSide || wall.backSide !== update.backSide)
      )
    })
  if (changedWallUpdates.length > 0) {
    updateNodes(
      changedWallUpdates.map((update) => ({
        id: update.wallId,
        data: {
          frontSide: update.frontSide,
          backSide: update.backSide,
        },
      })),
    )
  }

  if (scopedRooms.length > 0 && topologyDelta.currentRooms.length > 0) {
    const unaffectedRooms = [
      ...topologyDelta.allBeforeRooms.filter((room) => !topologyDelta.beforeRooms.includes(room)),
      ...topologyDelta.allCurrentRooms.filter((room) => !topologyDelta.currentRooms.includes(room)),
    ]
    const allSlabs = levelChildren(currentNodes, levelId)
      .filter((node): node is SlabNodeType => node.type === 'slab')
      .map((slab) => SlabNode.parse(slab))
    const slabs = allSlabs.filter(
      (slab) =>
        surfaceTouchesRooms(slab, scopedRooms) && !surfaceTouchesRooms(slab, unaffectedRooms),
    )
    const allCeilings = levelChildren(currentNodes, levelId)
      .filter((node): node is CeilingNodeType => node.type === 'ceiling')
      .map((ceiling) => CeilingNode.parse(ceiling))
    const ceilings = allCeilings.filter(
      (ceiling) =>
        surfaceTouchesRooms(ceiling, scopedRooms) && !surfaceTouchesRooms(ceiling, unaffectedRooms),
    )
    const slabRooms = roomsEligibleForAutoSurface(
      topologyDelta.beforeRooms,
      topologyDelta.currentRooms,
      slabs,
    )
    const ceilingRooms = roomsEligibleForAutoSurface(
      topologyDelta.beforeRooms,
      topologyDelta.currentRooms,
      ceilings,
    )

    syncAutoSlabsForLevel(
      levelId,
      slabRooms.map((room) => room.polygon),
      slabs,
      sceneStore,
      allSlabs,
    )
    const levelNode = currentNodes[levelId as AnyNodeId]
    const storeyHeight =
      levelNode?.type === 'level'
        ? getStoredLevelHeight(levelNode as LevelNode)
        : DEFAULT_LEVEL_HEIGHT
    syncAutoCeilingsForLevel(
      levelId,
      ceilingRooms.map((room) => room.polygon),
      ceilings,
      sceneStore,
      {
        storeyHeight,
        ceilingClampBound: (polygon) => getCeilingClampBound(levelId, currentNodes, polygon),
      },
      allCeilings,
    )
  }

  const zones = levelChildren(currentNodes, levelId)
    .filter((node): node is ZoneNodeType => node.type === 'zone')
    .map((zone) => ZoneNode.parse(zone))
  const spaces = topologyDelta.allCurrentRooms.map((room) => buildSpace(levelId, room))
  const zonePlan = planAutoZonesForLevel(spaces, zones)
  if (zonePlan.update.length > 0) updateNodes(zonePlan.update)
  updateSpacesForLevel(levelId, spaces, editorStore)
}

function ceilingClampInputsChanged(
  before: SceneNodes,
  current: SceneNodes,
  candidateIds?: ReadonlySet<AnyNodeId>,
) {
  const ids =
    candidateIds ??
    new Set<AnyNodeId>([
      ...(Object.keys(before) as AnyNodeId[]),
      ...(Object.keys(current) as AnyNodeId[]),
    ])
  for (const id of ids) {
    const previous = before[id]
    const next = current[id]
    const relevant =
      previous?.type === 'slab' ||
      next?.type === 'slab' ||
      previous?.type === 'level' ||
      next?.type === 'level' ||
      previous?.type === 'building' ||
      next?.type === 'building'
    if (relevant && previous !== next) return true
  }
  return false
}

function reconcileLoweredCeilingBounds(
  beforeNodes: SceneNodes,
  currentNodes: SceneNodes,
  sceneStore: any,
  candidateLevelIds?: ReadonlySet<string>,
) {
  const liveNodes = sceneStore.getState().nodes as SceneNodes
  const updates: Array<{ id: CeilingNodeType['id']; data: Partial<CeilingNodeType> }> = []
  const candidates = candidateLevelIds
    ? [...candidateLevelIds].flatMap((levelId) => levelChildren(liveNodes, levelId))
    : Object.values(liveNodes)

  for (const node of candidates) {
    if (node?.type !== 'ceiling' || node.height == null || !node.parentId) continue
    const currentBound = getCeilingClampBound(node.parentId, currentNodes, node.polygon)
    const previousBound = getCeilingClampBound(node.parentId, beforeNodes, node.polygon)
    if (
      currentBound < previousBound - CEILING_HEIGHT_EPSILON &&
      node.height > currentBound + CEILING_HEIGHT_EPSILON
    ) {
      updates.push({ id: node.id, data: { height: currentBound } })
    }
  }

  if (updates.length > 0) sceneStore.getState().updateNodes(updates)
}

// Refcount of outstanding pause requests, matching the pauseSceneHistory
// pattern. The community editor flips this off while the AI is actively
// mutating the scene so the wall-driven auto slab/ceiling sync doesn't race
// `create_room`'s explicit slabs/ceilings (see plan
// `ai-pause-space-detection`).
let spaceDetectionPauseDepth = 0

/** Pause the wall-driven auto slab/ceiling sync. Refcounted — pair with `resumeSpaceDetection`. */
export function pauseSpaceDetection(): void {
  spaceDetectionPauseDepth += 1
}

/** Resume the wall-driven auto slab/ceiling sync. No-op if not currently paused. */
export function resumeSpaceDetection(): void {
  if (spaceDetectionPauseDepth === 0) return
  spaceDetectionPauseDepth -= 1
}

/** True iff the wall-driven auto slab/ceiling sync is currently paused. */
export function isSpaceDetectionPaused(): boolean {
  return spaceDetectionPauseDepth > 0
}

export function initSpaceDetectionSync(
  sceneStore: any,
  editorStore: any,
  options: SpaceDetectionSyncOptions = {},
): () => void {
  let isProcessing = false
  const topologyIndex = new RoomTopologyIndex()
  topologyIndex.rebuild(sceneStore.getState().nodes as SceneNodes)
  replaceIndexedSpaces(topologyIndex.spaces(), editorStore)
  const temporalState = sceneStore.temporal?.getState?.()
  let previousPastLength = temporalState?.pastStates?.length ?? 0
  let previousFutureLength = temporalState?.futureStates?.length ?? 0

  const processCommit = (commit: SceneCommit) => {
    if (isProcessing) return
    if (commit.origin === 'load') {
      topologyIndex.rebuild(commit.current.nodes)
      replaceIndexedSpaces(topologyIndex.spaces(), editorStore)
      return
    }
    const changedWalls = changedWallIdsByLevel(
      commit.before.nodes,
      commit.current.nodes,
      commit.changedNodeIds,
    )
    const changedZones = changedZoneIdsByLevel(
      commit.before.nodes,
      commit.current.nodes,
      commit.changedNodeIds,
    )
    const shouldReconcileCeilingBounds = ceilingClampInputsChanged(
      commit.before.nodes,
      commit.current.nodes,
      commit.changedNodeIds,
    )
    if (changedWalls.size === 0 && changedZones.size === 0 && !shouldReconcileCeilingBounds) return
    if (spaceDetectionPauseDepth > 0) {
      topologyIndex.rebuild(commit.current.nodes)
      replaceIndexedSpaces(topologyIndex.spaces(), editorStore)
      return
    }

    isProcessing = true
    pauseSceneHistory(sceneStore)
    try {
      for (const [levelId, wallIds] of changedWalls) {
        const topologyDelta = topologyIndex.applyWallDelta(
          levelId,
          wallIds,
          commit.before.nodes,
          commit.current.nodes,
        )
        reconcileWallTopologyDelta(
          levelId,
          topologyDelta,
          commit.current.nodes,
          sceneStore,
          editorStore,
        )
        options.onTopologyReconcile?.({
          levelId,
          strategy: topologyDelta.strategy,
          examinedWallIds: topologyDelta.examinedWallIds,
          affectedBeforeRoomCount: topologyDelta.beforeRooms.length,
          affectedCurrentRoomCount: topologyDelta.currentRooms.length,
        })
      }
      for (const [levelId, zoneIds] of changedZones) {
        if (changedWalls.has(levelId)) continue
        reconcileChangedZones(
          levelId,
          zoneIds,
          commit.current.nodes,
          sceneStore,
          topologyIndex.spacesForLevel(levelId),
        )
      }
      if (shouldReconcileCeilingBounds) {
        reconcileLoweredCeilingBounds(commit.before.nodes, sceneStore.getState().nodes, sceneStore)
      } else if (changedWalls.size > 0) {
        const liveNodes = sceneStore.getState().nodes as SceneNodes
        const lowerLevelIds = new Set<string>()
        for (const levelId of changedWalls.keys()) {
          const lowerLevel = getLevelBelow(levelId, liveNodes)
          if (lowerLevel) lowerLevelIds.add(lowerLevel.id)
        }
        reconcileLoweredCeilingBounds(commit.before.nodes, liveNodes, sceneStore, lowerLevelIds)
      }
    } finally {
      resumeSceneHistory(sceneStore)
      isProcessing = false
    }
  }

  const unsubscribeCommits = subscribeSceneCommits(processCommit)
  const unsubscribeTemporal =
    sceneStore.temporal?.subscribe?.(
      (state: { pastStates?: unknown[]; futureStates?: unknown[] }) => {
        const pastLength = state.pastStates?.length ?? 0
        const futureLength = state.futureStates?.length ?? 0
        const didUndo = futureLength > previousFutureLength
        const didRedo = pastLength > previousPastLength && futureLength < previousFutureLength
        previousPastLength = pastLength
        previousFutureLength = futureLength
        if (!(didUndo || didRedo)) return

        queueMicrotask(() => {
          topologyIndex.rebuild(sceneStore.getState().nodes as SceneNodes)
          replaceIndexedSpaces(topologyIndex.spaces(), editorStore)
        })
      },
    ) ?? (() => {})

  return () => {
    unsubscribeCommits()
    unsubscribeTemporal()
  }
}

export function wallTouchesOthers(wall: WallNode, otherWalls: WallNode[]): boolean {
  const threshold = 0.1

  for (const other of otherWalls) {
    if (other.id === wall.id) continue

    if (
      distanceToSegment(wall.start, other.start, other.end) < threshold ||
      distanceToSegment(wall.end, other.start, other.end) < threshold ||
      distanceToSegment(other.start, wall.start, wall.end) < threshold ||
      distanceToSegment(other.end, wall.start, wall.end) < threshold
    ) {
      return true
    }
  }

  return false
}

function distanceToSegment(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
) {
  const [px, py] = point
  const [x1, y1] = segStart
  const [x2, y2] = segEnd

  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy

  if (lenSq < 0.0001) {
    return Math.hypot(px - x1, py - y1)
  }

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
  const projX = x1 + t * dx
  const projY = y1 + t * dy

  return Math.hypot(px - projX, py - projY)
}
