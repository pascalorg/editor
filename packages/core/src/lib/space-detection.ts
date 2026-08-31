import { GROUND_SUPPORT_ID } from '../hooks/spatial-grid/support-host-id'
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
  findLevelAboveId,
  getCeilingClampBound,
  getLevelBelow,
  getLevelElevations,
  getStoredLevelHeight,
} from '../services/storey'
import {
  activeSceneCommitNodeIds,
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resumeSceneHistory,
  subscribeSceneCommits,
} from '../store/history-control'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import {
  getClampedWallCurveOffset,
  getWallCurveFrameAt,
  isCurvedWall,
} from '../systems/wall/wall-curve'
import { resolveWallTop } from '../systems/wall/wall-top'
import { simplifyClosedPolygon } from './polygon-geometry'
import {
  distanceToSegment,
  type IndexedTopologyDelta,
  RoomTopologyIndex,
} from './room-topology-index'
import { levelBaseElevationAt } from './terrain-support'

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

export type AutoSlabPlanningContext = {
  elevationForRoom?: (polygon: Array<[number, number]>) => number | undefined
  previousElevationForRoom?: (polygon: Array<[number, number]>) => number | undefined
}

export type AutoCeilingSyncPlan = {
  create: CeilingNodeType[]
  update: Array<{ id: CeilingNodeType['id']; data: Partial<CeilingNodeType> }>
  delete: Array<CeilingNodeType['id']>
  reparent: Array<{ id: AnyNodeId; parentId: CeilingNodeType['id'] }>
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
// Rewrite deadband for an existing auto surface's elevation/height: below this
// the derived plane is the same plane and writing it would churn history.
const ROOM_VERTICAL_PLANE_EPSILON = 1e-3

// Pure planner callers omit `heightForRoom`, so auto ceilings keep their
// height-less level-following behavior. The live room sync supplies a height
// derived from the enclosing walls' own bases and tops.
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
  heightForRoom?: (polygon: Array<[number, number]>) => number | undefined
  previousHeightForRoom?: (polygon: Array<[number, number]>) => number | undefined
  childPosition?: (childId: AnyNodeId) => [number, number] | undefined
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

/**
 * The base a boundary wall actually stands on, in level-local metres.
 *
 * Resolved the same way the wall renderer resolves it — the level base under
 * the wall's own start point (sculpted ground or the flat plane), the slab
 * election on top of that, plus the wall's stored `supportOffset`. Reading the
 * ground for `GROUND_SUPPORT_ID` walls only is what left stamped room presets
 * flat: `resolveWallSupportSlabPatch` writes no host at all for a wall on bare
 * terrain, so the sentinel is a hint about pointer intent, never a precondition
 * for standing on the ground.
 */
function boundaryWallBase(
  wall: WallNode,
  walls: WallNode[],
  supportSlabs: readonly SlabNodeType[],
  nodes: Record<string, any>,
  levelId: string,
): number {
  const levelBase = levelBaseElevationAt(nodes, levelId, wall.start[0], wall.start[1])
  const offset = wall.supportOffset ?? 0
  if (wall.supportSlabId === GROUND_SUPPORT_ID) return levelBase + offset
  return (
    computeWallSlabSupport(wall, supportSlabs, walls, wall.supportSlabId ?? null, null, levelBase)
      .elevation + offset
  )
}

/**
 * The plane an auto floor/ceiling takes when its enclosing walls disagree.
 *
 * `floor` takes the HIGHEST wall base and `ceiling` the LOWEST wall top —
 * the only pair that cannot open a hole: a floor at the lowest base would
 * leave daylight under every wall standing higher, and a ceiling at the
 * highest top would poke out through the shortest wall. Both surfaces stay
 * flat (a slab is one scalar elevation by schema; see `vertical-model.md`),
 * so a room on a slope is a level room cut into the hillside — the walls on
 * the low side extend down to meet it, which is what their `baseSegments`
 * fill-down already does.
 *
 * Non-finite inputs are the one abstain: a broken graph should keep the
 * existing placement rather than move a surface to NaN.
 */
function roomFloorPlane(wallBases: number[]): number | undefined {
  if (wallBases.length === 0 || wallBases.some((value) => !Number.isFinite(value))) return undefined
  return Math.max(...wallBases)
}

function roomCeilingPlane(wallTops: number[]): number | undefined {
  if (wallTops.length === 0 || wallTops.some((value) => !Number.isFinite(value))) return undefined
  return Math.min(...wallTops)
}

function autoRoomVerticalPlacements(
  spaces: readonly Space[],
  walls: WallNode[],
  supportSlabs: readonly SlabNodeType[],
  nodes: Record<string, any>,
  storeyHeight: number,
) {
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const placements = new Map<string, { slabElevation: number; ceilingHeight: number }>()

  for (const space of spaces) {
    const boundaryWalls = space.wallIds.flatMap((id) => {
      const wall = wallsById.get(id)
      return wall ? [wall] : []
    })
    if (boundaryWalls.length !== space.wallIds.length) continue

    const wallBases = boundaryWalls.map((wall) =>
      boundaryWallBase(wall, walls, supportSlabs, nodes, space.levelId),
    )
    const base = roomFloorPlane(wallBases)
    if (base === undefined) continue

    const wallTops = boundaryWalls.map((wall, index) =>
      resolveWallTop(wall, storeyHeight, wallBases[index] ?? base),
    )
    const top = roomCeilingPlane(wallTops)
    if (top === undefined) continue

    placements.set(polygonSignature(space.polygon.map(pointFromTuple)), {
      slabElevation: base + DEFAULT_AUTO_SLAB_ELEVATION,
      ceilingHeight: top - CEILING_CLAMP_MARGIN,
    })
  }

  return placements
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
      if (signedArea < 0.5 || signedArea > 10_000) continue

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

  if (indices.length === 3) triangles.push(indices.map((index) => points[index]!))
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
    { holes: Array<Array<[number, number]>>; holeMetadata: SlabNodeType['holeMetadata'] }
  >()
  for (const roomIndex of roomIndices) {
    assignments.set(roomIndex, { holes: [], holeMetadata: [] })
  }

  surface.holes.forEach((hole, holeIndex) => {
    const holePolygon = hole.map(pointFromTuple)
    for (const roomIndex of roomIndices) {
      const room = detected[roomIndex]
      const assignment = assignments.get(roomIndex)
      if (!(room && assignment)) continue
      for (const clipped of clipOpeningToRoom(holePolygon, room.poly)) {
        assignment.holes.push(clipped.map(pointToTuple))
        assignment.holeMetadata.push(surface.holeMetadata[holeIndex] ?? { source: 'manual' })
      }
    }
  })

  return assignments
}

function partitionCeilingChildren(
  ceiling: CeilingNodeType,
  roomIndices: number[],
  detected: DetectedRoom[],
  fallbackRoomIndex: number | undefined,
  childPosition: AutoCeilingPlanningContext['childPosition'],
) {
  const assignments = new Map<number, CeilingNodeType['children']>()
  for (const roomIndex of roomIndices) assignments.set(roomIndex, [])

  for (const childId of ceiling.children) {
    const tuple = childPosition?.(childId)
    const point = tuple ? pointFromTuple(tuple) : undefined
    const boundaryRoomIndices = point
      ? roomIndices.filter((roomIndex) => {
          const room = detected[roomIndex]
          return room ? pointDistanceToPolygonBoundary(point, room.poly) <= 1e-7 : false
        })
      : []
    const interiorRoomIndex =
      point && boundaryRoomIndices.length === 0
        ? roomIndices.find((roomIndex) => {
            const room = detected[roomIndex]
            return room ? pointInPolygon(point, room.poly) : false
          })
        : undefined
    const roomIndex =
      interiorRoomIndex ??
      (fallbackRoomIndex !== undefined && boundaryRoomIndices.includes(fallbackRoomIndex)
        ? fallbackRoomIndex
        : boundaryRoomIndices[0]) ??
      fallbackRoomIndex ??
      roomIndices[0]
    if (roomIndex !== undefined) assignments.get(roomIndex)?.push(childId)
  }

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

function ceilingMergeSettingsSignature(ceiling: CeilingNodeType) {
  return JSON.stringify([
    ceiling.height ?? null,
    ceiling.material ?? null,
    ceiling.materialPreset ?? null,
    ceiling.slots ?? null,
    ceiling.visible,
  ])
}

function slabMergeSettingsSignature(slab: SlabNodeType) {
  return JSON.stringify([
    slab.elevation,
    slab.thickness,
    slab.recessed,
    slab.recessedRimElevation ?? null,
    slab.fillToTerrain ?? null,
    slab.material ?? null,
    slab.materialPreset ?? null,
    slab.slots ?? null,
    slab.visible,
  ])
}

function slabElevationForReconciledRoom(
  source: SlabNodeType,
  polygon: Array<[number, number]>,
  context: AutoSlabPlanningContext,
) {
  const currentDerived = context.elevationForRoom?.(polygon)
  if (!context.previousElevationForRoom) return currentDerived ?? source.elevation

  const previousDerived = context.previousElevationForRoom(source.polygon)
  const sourceWasDerived =
    previousDerived !== undefined &&
    Math.abs(source.elevation - previousDerived) <= ROOM_VERTICAL_PLANE_EPSILON
  return sourceWasDerived ? (currentDerived ?? source.elevation) : source.elevation
}

function ceilingHeightForReconciledRoom(
  source: CeilingNodeType,
  polygon: Array<[number, number]>,
  context: AutoCeilingPlanningContext,
) {
  if (source.height === undefined) return undefined

  const currentDerived = context.heightForRoom?.(polygon)
  if (!context.previousHeightForRoom) return currentDerived ?? source.height

  const previousDerived = context.previousHeightForRoom(source.polygon)
  const sourceWasDerived =
    previousDerived !== undefined &&
    Math.abs(source.height - previousDerived) <= ROOM_VERTICAL_PLANE_EPSILON
  return sourceWasDerived ? (currentDerived ?? source.height) : source.height
}

function wallGeometrySignature(wall: WallNode, nodes: Record<string, any>, levelId: string) {
  return [
    wall.id,
    wall.start[0].toFixed(4),
    wall.start[1].toFixed(4),
    wall.end[0].toFixed(4),
    wall.end[1].toFixed(4),
    (wall.thickness ?? 0.2).toFixed(4),
    // Plane-bound (no stored height) is a distinct state, not a default
    // value: it resolves to the storey plane, so it must not alias an
    // explicit height of the same magnitude in the trigger signature.
    wall.height == null ? 'plane' : wall.height.toFixed(4),
    wall.supportSlabId ?? 'elected',
    (wall.supportOffset ?? 0).toFixed(4),
    getClampedWallCurveOffset(wall).toFixed(4),
    // The ground under this wall, sampled at the SAME point
    // `boundaryWallBase` samples it. Sculpting changes only `site.terrain`,
    // so without a terrain term here every signature stays byte-identical
    // and the sync early-exits — a room's floor and ceiling could never
    // follow ground that moved beneath its walls.
    //
    // The sample, not the field, and not the resolved base: hashing the
    // heightfield would re-trigger every level for a stroke on the far side
    // of the lot, and resolving the full slab election would fold slab
    // POLYGONS into the signature, which is exactly the delete/recreate
    // feedback the comment below is about. Sampling where the placement
    // samples means the two cannot disagree in either direction — no missed
    // re-run, no spurious one.
    //
    // Granularity is per stroke, not per dab: live dabs publish to
    // `useLiveTerrain` and never touch the scene store, so this runs once on
    // release — inside the stroke's own `runAsSingleSceneHistoryStep`, which
    // is what puts the moved floor and the terrain that moved it in the same
    // undo step. Mid-drag the ground-hosted walls follow the brush while the
    // floor waits for release; re-deriving per dab would mean a scene write
    // per dab and a floor that jitters under the cursor.
    levelBaseElevationAt(nodes, levelId, wall.start[0], wall.start[1]).toFixed(4),
  ].join('|')
}

function levelWallSnapshot(walls: WallNode[], nodes: Record<string, any>, levelId: string) {
  return walls
    .map((wall) => wallGeometrySignature(wall, nodes, levelId))
    .sort()
    .join('||')
}

function zoneGeometrySignature(zone: ZoneNodeType) {
  return [
    zone.id,
    zone.autoFromWalls ? 'auto' : 'manual',
    zone.boundaryWallIds.slice().sort().join(','),
    zone.polygon.map(([x, z]) => `${x.toFixed(4)},${z.toFixed(4)}`).join(';'),
  ].join('|')
}

// Slab/ceiling POLYGONS stay out of the trigger signature: including
// generated footprints caused delete/recreate feedback. Zones are included
// only so a newly traced room footprint can adopt its enclosing walls
// without waiting for the next remodel. Slab ELEVATIONS and the level's
// stored storey height ARE included — both feed the explicit-ceiling
// re-clamp bound (the storey plane), and neither is rewritten by
// the sync, so regeneration triggers when they change without feedback.
// Stage 3-B adds the LEVEL-ABOVE's covering-slab undersides (elevation −
// thickness, recessed pools excluded): a deck created, lowered, or
// thickened above must re-run the sync below so ceilings re-clamp under
// it. Same polygon exclusion applies — the level-above's own auto sync
// rewrites its slab footprints, and hashing them here would re-trigger
// this level on every remodel above.
function levelStructureSnapshots(nodes: Record<string, any>) {
  const wallsByLevel = new Map<string, WallNode[]>()
  const zonesByLevel = new Map<string, ZoneNodeType[]>()
  const slabElevationsByLevel = new Map<string, string[]>()
  const coveringUndersidesByLevel = new Map<string, string[]>()

  for (const node of Object.values(nodes)) {
    if (!(node && typeof node === 'object' && 'parentId' in node && node.parentId)) continue
    const levelId = (node as any).parentId as string
    if ((node as any).type === 'wall') {
      const walls = wallsByLevel.get(levelId) ?? []
      walls.push(node as WallNode)
      wallsByLevel.set(levelId, walls)
    } else if ((node as any).type === 'zone') {
      const zones = zonesByLevel.get(levelId) ?? []
      zones.push(ZoneNode.parse(node))
      zonesByLevel.set(levelId, zones)
    } else if ((node as any).type === 'slab') {
      const elevations = slabElevationsByLevel.get(levelId) ?? []
      elevations.push(
        `${(node as any).id}:${(((node as any).elevation as number | undefined) ?? DEFAULT_AUTO_SLAB_ELEVATION).toFixed(4)}`,
      )
      slabElevationsByLevel.set(levelId, elevations)
      if ((node as any).recessed !== true) {
        const undersides = coveringUndersidesByLevel.get(levelId) ?? []
        const elevation = ((node as any).elevation as number | undefined) ?? 0.05
        const thickness = ((node as any).thickness as number | undefined) ?? 0.05
        undersides.push(`${(node as any).id}:${(elevation - thickness).toFixed(4)}`)
        coveringUndersidesByLevel.set(levelId, undersides)
      }
    }
  }

  const levelElevations = getLevelElevations(nodes as Record<AnyNodeId, any>)
  const snapshots = new Map<string, string>()
  const levelIds = new Set([...wallsByLevel.keys(), ...zonesByLevel.keys()])
  for (const levelId of levelIds) {
    const walls = wallsByLevel.get(levelId) ?? []
    const zones = zonesByLevel.get(levelId) ?? []
    const level = nodes[levelId]
    const storeyKey =
      level?.type === 'level' && typeof level.height === 'number' ? level.height.toFixed(4) : ''
    const slabKey = (slabElevationsByLevel.get(levelId) ?? []).sort().join(';')
    const aboveId = findLevelAboveId(levelId, levelElevations)
    const aboveSlabKey = aboveId
      ? (coveringUndersidesByLevel.get(aboveId) ?? []).sort().join(';')
      : ''
    snapshots.set(
      levelId,
      `${storeyKey}#${levelWallSnapshot(walls, nodes, levelId)}##${zones.map(zoneGeometrySignature).sort().join('||')}##${slabKey}##${aboveSlabKey}`,
    )
  }

  return snapshots
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

type RoomSurface = SlabNodeType | CeilingNodeType

function surfaceTouchesRooms(surface: RoomSurface, rooms: ExtractedRoom[]) {
  const polygon = surface.polygon.map(pointFromTuple)
  return rooms.some(
    (room) =>
      polygonCoverageRatio(polygon, [room.polygon]) > 0 ||
      polygonCoverageRatio(room.polygon, [polygon]) > 0,
  )
}

function roomsAreRelated(beforeRoom: ExtractedRoom, currentRoom: ExtractedRoom) {
  const beforeIds = new Set(beforeRoom.boundaryFaces.map((boundary) => boundary.wallId))
  const currentIds = new Set(currentRoom.boundaryFaces.map((boundary) => boundary.wallId))
  const sharedWallCount = [...currentIds].filter((wallId) => beforeIds.has(wallId)).length
  const smallerBoundarySize = Math.min(beforeIds.size, currentIds.size)
  if (sharedWallCount >= 2 && sharedWallCount >= Math.ceil(smallerBoundarySize / 2)) return true
  if (bboxOverlapArea(bboxOf(beforeRoom.polygon), bboxOf(currentRoom.polygon)) <= 1e-6) return false
  return (
    polygonCoverageRatio(beforeRoom.polygon, [currentRoom.polygon]) > 0 ||
    polygonCoverageRatio(currentRoom.polygon, [beforeRoom.polygon]) > 0
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

function detectedRoomsByLevel(nodes: Record<string, any>) {
  const wallsByLevel = new Map<string, WallNode[]>()
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'wall' || !node.parentId) continue
    const walls = wallsByLevel.get(node.parentId) ?? []
    walls.push(node)
    wallsByLevel.set(node.parentId, walls)
  }
  return new Map(
    [...wallsByLevel].map(([levelId, walls]) => [levelId, extractRooms(walls)] as const),
  )
}

type SceneNodes = Record<string, any>

function levelChildren(nodes: SceneNodes, levelId: string) {
  const level = nodes[levelId]
  if (level?.type !== 'level') return []
  return level.children.flatMap((id: string) => {
    const node = nodes[id]
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
    const previous = before[wallId]?.type === 'wall' ? (before[wallId] as WallNode) : null
    const next = current[wallId]?.type === 'wall' ? (current[wallId] as WallNode) : null
    if (previous === next) continue
    markChanged(previous?.parentId, wallId)
    markChanged(next?.parentId, wallId)
  }

  return changes
}

function descendantLevelIds(nodes: SceneNodes, rootId: string) {
  const levelIds = new Set<string>()
  const queue = [rootId]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const id = queue.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const node = nodes[id]
    if (!node) continue
    if (node.type === 'level') levelIds.add(node.id)
    if ('children' in node && Array.isArray(node.children)) queue.push(...node.children)
  }
  return levelIds
}

function fallbackLevelIdsForCandidates(
  before: SceneNodes,
  current: SceneNodes,
  candidateIds: ReadonlySet<AnyNodeId>,
) {
  const levelIds = new Set<string>()
  const addLevelAndLower = (levelId: string | null | undefined, nodes: SceneNodes) => {
    if (!levelId) return
    levelIds.add(levelId)
    const lower = getLevelBelow(levelId, nodes)
    if (lower) levelIds.add(lower.id)
  }

  for (const id of candidateIds) {
    for (const nodes of [before, current]) {
      const node = nodes[id]
      if (!node) continue
      if (node.type === 'level' || node.type === 'building' || node.type === 'site') {
        for (const levelId of descendantLevelIds(nodes, node.id)) levelIds.add(levelId)
      } else if (node.type === 'slab') {
        addLevelAndLower(node.parentId, nodes)
      } else if (node.type === 'zone') {
        if (node.parentId) levelIds.add(node.parentId)
      }
    }
  }
  return levelIds
}

function sameStringSet(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false
  const right = new Set(b)
  return a.every((value) => right.has(value))
}

type AutoSurfaceMatch<TSurface extends RoomSurface> = {
  detectedAll: DetectedRoom[]
  detected: DetectedRoom[]
  existingAuto: TSurface[]
  compatibleMergesByRoomIndex: Map<number, TSurface[]>
  matchedDetectedIndices: Set<number>
  roomIndexBySurfaceId: Map<string, number>
  sourceSurfaceIdByRoomIndex: Map<number, string>
  polygonBySurfaceId: Map<string, Array<[number, number]>>
  delete: Array<TSurface['id']>
  demote: Array<{ id: TSurface['id']; data: Partial<TSurface> }>
}

function matchAutoSurfaces<TSurface extends RoomSurface>(
  roomPolygons: Point2D[][],
  existingSurfaces: TSurface[],
  mergeSettingsSignature: (surface: TSurface) => string,
): AutoSurfaceMatch<TSurface> {
  const manualSurfaces = existingSurfaces.filter((surface) => !surface.autoFromWalls)
  const manualSignatures = new Set(
    manualSurfaces.map((surface) => polygonSignature(surface.polygon.map(pointFromTuple))),
  )
  const manualPolygons = manualSurfaces.map((surface) => surface.polygon.map(pointFromTuple))
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
  const existingAuto = existingSurfaces.filter((surface) => surface.autoFromWalls)
  const metadata = existingAuto.map((surface) => {
    const poly = surface.polygon.map(pointFromTuple)
    return {
      surface,
      sig: polygonSignature(poly),
      centroid: polygonCentroid(poly),
      area: Math.abs(polygonArea(poly)),
      bbox: bboxOf(poly),
    }
  })

  const conflictingSurfaceIds = new Set<string>()
  const conflictingRoomIndices = new Set<number>()
  const compatibleMergesByRoomIndex = new Map<number, TSurface[]>()
  detected.forEach((room, roomIndex) => {
    const contributors = existingAuto.filter(
      (surface) =>
        polygonCoverageRatio(surface.polygon.map(pointFromTuple), [room.poly]) >=
        ORPHAN_MERGE_COVERAGE_THRESHOLD,
    )
    if (contributors.length < 2) return
    if (new Set(contributors.map(mergeSettingsSignature)).size > 1) {
      conflictingRoomIndices.add(roomIndex)
      for (const surface of contributors) conflictingSurfaceIds.add(surface.id)
      return
    }
    compatibleMergesByRoomIndex.set(roomIndex, contributors)
  })

  const matchedSurfaceIds = new Set<string>()
  const matchedDetectedIndices = new Set<number>()
  const roomIndexBySurfaceId = new Map<string, number>()
  const sourceSurfaceIdByRoomIndex = new Map<number, string>()
  const polygonBySurfaceId = new Map<string, Array<[number, number]>>()
  const autoBySignature = new Map<string, Array<(typeof metadata)[number]>>()
  for (const entry of metadata) {
    const bucket = autoBySignature.get(entry.sig) ?? []
    bucket.push(entry)
    autoBySignature.set(entry.sig, bucket)
  }

  detected.forEach((room, index) => {
    if (conflictingRoomIndices.has(index)) {
      matchedDetectedIndices.add(index)
      return
    }
    const existing = autoBySignature.get(room.sig)?.shift()
    if (!existing) return
    matchedDetectedIndices.add(index)
    matchedSurfaceIds.add(existing.surface.id)
    roomIndexBySurfaceId.set(existing.surface.id, index)
    sourceSurfaceIdByRoomIndex.set(index, existing.surface.id)
    polygonBySurfaceId.set(existing.surface.id, room.poly.map(pointToTuple))
  })

  const remainingDetected = detected
    .map((room, index) => ({ room, index }))
    .filter(({ index }) => !matchedDetectedIndices.has(index))
    .sort((left, right) => right.room.area - left.room.area)
  const remainingAuto = metadata.filter((entry) => !matchedSurfaceIds.has(entry.surface.id))

  for (const { room, index } of remainingDetected) {
    let bestMatch: { entry: (typeof remainingAuto)[number]; score: number } | null = null
    for (const entry of remainingAuto) {
      if (matchedSurfaceIds.has(entry.surface.id)) continue
      const distance = Math.hypot(
        room.centroid.x - entry.centroid.x,
        room.centroid.y - entry.centroid.y,
      )
      const areaRatio = entry.area > 1e-6 ? room.area / entry.area : 999
      const areaPenalty = Math.abs(Math.log(Math.max(1e-6, areaRatio)))
      if (bboxOverlapArea(room.bbox, entry.bbox) <= 0.0001 && distance > 1.5) continue
      const score = distance + areaPenalty * 0.35
      if (!bestMatch || score < bestMatch.score) bestMatch = { entry, score }
    }
    if (!bestMatch) continue
    matchedDetectedIndices.add(index)
    matchedSurfaceIds.add(bestMatch.entry.surface.id)
    roomIndexBySurfaceId.set(bestMatch.entry.surface.id, index)
    sourceSurfaceIdByRoomIndex.set(index, bestMatch.entry.surface.id)
    polygonBySurfaceId.set(bestMatch.entry.surface.id, room.poly.map(pointToTuple))
  }

  detected.forEach((room, index) => {
    if (sourceSurfaceIdByRoomIndex.has(index)) return
    let bestSource: { id: string; coverage: number } | null = null
    for (const entry of metadata) {
      const coverage = polygonCoverageRatio(room.poly, [entry.surface.polygon.map(pointFromTuple)])
      if (coverage <= 0 || (bestSource && coverage <= bestSource.coverage)) continue
      bestSource = { id: entry.surface.id, coverage }
    }
    if (bestSource) sourceSurfaceIdByRoomIndex.set(index, bestSource.id)
  })

  const detectedRoomPolygons = detectedAll.map((room) => room.poly)
  const deleted: Array<TSurface['id']> = []
  const demote: AutoSurfaceMatch<TSurface>['demote'] = []
  for (const surface of existingAuto) {
    if (polygonBySurfaceId.has(surface.id)) continue
    if (conflictingSurfaceIds.has(surface.id)) {
      demote.push({ id: surface.id, data: { autoFromWalls: false } as Partial<TSurface> })
      continue
    }
    const coverage = polygonCoverageRatio(surface.polygon.map(pointFromTuple), detectedRoomPolygons)
    if (coverage >= ORPHAN_MERGE_COVERAGE_THRESHOLD) deleted.push(surface.id)
    else demote.push({ id: surface.id, data: { autoFromWalls: false } as Partial<TSurface> })
  }

  return {
    detectedAll,
    detected,
    existingAuto,
    compatibleMergesByRoomIndex,
    matchedDetectedIndices,
    roomIndexBySurfaceId,
    sourceSurfaceIdByRoomIndex,
    polygonBySurfaceId,
    delete: deleted,
    demote,
  }
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
  context: AutoSlabPlanningContext = {},
  namingSlabs: Array<{ name?: string }> = existingSlabs,
): AutoSlabSyncPlan {
  const match = matchAutoSurfaces(roomPolygons, existingSlabs, slabMergeSettingsSignature)
  const {
    detected,
    existingAuto,
    compatibleMergesByRoomIndex: compatibleMergeSlabsByRoomIndex,
    matchedDetectedIndices: matchedDetectedIdx,
    roomIndexBySurfaceId: roomIndexBySlabId,
    sourceSurfaceIdByRoomIndex: sourceSlabIdByRoomIndex,
    delete: slabsToDelete,
    demote: slabDemotions,
  } = match
  const updatesById = new Map<
    string,
    { polygon: [number, number][]; elevation: number | undefined }
  >()
  for (const slab of existingAuto) {
    const polygon = match.polygonBySurfaceId.get(slab.id)
    if (!polygon) continue
    updatesById.set(slab.id, {
      polygon,
      elevation: slabElevationForReconciledRoom(slab, polygon, context),
    })
  }

  const openingAssignmentsBySlabId = new Map<string, ReturnType<typeof partitionSurfaceOpenings>>()
  for (const slab of existingAuto) {
    const roomIndices = [...sourceSlabIdByRoomIndex.entries()]
      .filter(([, slabId]) => slabId === slab.id)
      .map(([roomIndex]) => roomIndex)
    if (roomIndices.length === 0) continue
    openingAssignmentsBySlabId.set(slab.id, partitionSurfaceOpenings(slab, roomIndices, detected))
  }

  const slabsToUpdate = [
    ...existingAuto
      .filter((slab) => updatesById.has(slab.id))
      .flatMap((slab) => {
        const update = updatesById.get(slab.id)
        if (!update) return []
        const roomIndex = roomIndexBySlabId.get(slab.id)
        const openings =
          roomIndex == null
            ? { holes: slab.holes, holeMetadata: slab.holeMetadata }
            : compatibleMergeSlabsByRoomIndex.has(roomIndex)
              ? mergedSurfaceOpenings(compatibleMergeSlabsByRoomIndex.get(roomIndex) ?? [])
              : (openingAssignmentsBySlabId.get(slab.id)?.get(roomIndex) ?? {
                  holes: [],
                  holeMetadata: [],
                })
        const data: Partial<SlabNodeType> = {}
        if (!sameTuplePolygon(slab.polygon, update.polygon)) data.polygon = update.polygon
        if (!sameTuplePolygons(slab.holes, openings.holes)) data.holes = openings.holes
        if (!sameHoleMetadata(slab.holeMetadata, openings.holeMetadata)) {
          data.holeMetadata = openings.holeMetadata
        }
        if (
          update.elevation !== undefined &&
          Math.abs(slab.elevation - update.elevation) > ROOM_VERTICAL_PLANE_EPSILON
        ) {
          data.elevation = update.elevation
        }
        return Object.keys(data).length > 0 ? [{ id: slab.id, data }] : []
      }),
    ...slabDemotions,
  ]

  const plannedSlabsForNaming: Array<{ name?: string }> = [...namingSlabs]
  const slabsToCreate: SlabNodeType[] = []
  for (let index = 0; index < detected.length; index += 1) {
    if (matchedDetectedIdx.has(index)) continue

    const room = detected[index]
    if (!room) continue

    const name = nextAutoRoomName(plannedSlabsForNaming, 'Slab')
    plannedSlabsForNaming.push({ name })

    const polygon = room.poly.map(pointToTuple)
    const sourceId = sourceSlabIdByRoomIndex.get(index)
    const source = sourceId ? existingAuto.find((slab) => slab.id === sourceId) : undefined
    const openings = sourceId ? openingAssignmentsBySlabId.get(sourceId)?.get(index) : undefined
    const elevation = source
      ? slabElevationForReconciledRoom(source, polygon, context)
      : context.elevationForRoom?.(polygon)
    slabsToCreate.push(
      SlabNode.parse({
        name,
        polygon,
        holes: openings?.holes ?? [],
        holeMetadata: openings?.holeMetadata ?? [],
        elevation:
          elevation !== undefined && Number.isFinite(elevation)
            ? elevation
            : DEFAULT_AUTO_SLAB_ELEVATION,
        thickness: source?.thickness,
        recessed: source?.recessed,
        recessedRimElevation: source?.recessedRimElevation,
        fillToTerrain: source?.fillToTerrain,
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
  context: AutoSlabPlanningContext = {},
  namingSlabs: Array<{ name?: string }> = existingSlabs,
) {
  const plan = planAutoSlabsForLevel(roomPolygons, existingSlabs, context, namingSlabs)

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
  const match = matchAutoSurfaces(roomPolygons, existingCeilings, ceilingMergeSettingsSignature)
  const {
    detected,
    existingAuto,
    compatibleMergesByRoomIndex: compatibleMergeCeilingsByRoomIndex,
    matchedDetectedIndices: matchedDetectedIdx,
    roomIndexBySurfaceId: roomIndexByCeilingId,
    sourceSurfaceIdByRoomIndex: sourceCeilingIdByRoomIndex,
    delete: ceilingsToDelete,
    demote: ceilingDemotions,
  } = match
  const updatesById = new Map<string, { polygon: [number, number][]; height: number | undefined }>()
  for (const ceiling of existingAuto) {
    const polygon = match.polygonBySurfaceId.get(ceiling.id)
    if (!polygon) continue
    updatesById.set(ceiling.id, {
      polygon,
      height: ceilingHeightForReconciledRoom(ceiling, polygon, context),
    })
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
  const childAssignmentsByCeilingId = new Map<string, ReturnType<typeof partitionCeilingChildren>>()
  for (const ceiling of existingAuto) {
    const roomIndices = [...sourceCeilingIdByRoomIndex.entries()]
      .filter(([, ceilingId]) => ceilingId === ceiling.id)
      .map(([roomIndex]) => roomIndex)
    if (roomIndices.length === 0) continue
    openingAssignmentsByCeilingId.set(
      ceiling.id,
      partitionSurfaceOpenings(ceiling, roomIndices, detected),
    )
    childAssignmentsByCeilingId.set(
      ceiling.id,
      partitionCeilingChildren(
        ceiling,
        roomIndices,
        detected,
        roomIndexByCeilingId.get(ceiling.id),
        context.childPosition,
      ),
    )
  }

  const childReparents: AutoCeilingSyncPlan['reparent'] = []
  const ceilingsToUpdate = [
    ...existingAuto
      .filter((ceiling) => updatesById.has(ceiling.id))
      .flatMap((ceiling) => {
        const update = updatesById.get(ceiling.id)
        if (!update) return []
        const roomIndex = roomIndexByCeilingId.get(ceiling.id)
        const openings =
          roomIndex == null
            ? { holes: ceiling.holes, holeMetadata: ceiling.holeMetadata }
            : compatibleMergeCeilingsByRoomIndex.has(roomIndex)
              ? mergedSurfaceOpenings(compatibleMergeCeilingsByRoomIndex.get(roomIndex) ?? [])
              : (openingAssignmentsByCeilingId.get(ceiling.id)?.get(roomIndex) ?? {
                  holes: [],
                  holeMetadata: [],
                })
        const data: Partial<CeilingNodeType> = {}
        if (!sameTuplePolygon(ceiling.polygon, update.polygon)) data.polygon = update.polygon
        if (!sameTuplePolygons(ceiling.holes, openings.holes)) data.holes = openings.holes
        if (!sameHoleMetadata(ceiling.holeMetadata, openings.holeMetadata)) {
          data.holeMetadata = openings.holeMetadata
        }
        const mergeContributors =
          roomIndex == null ? undefined : compatibleMergeCeilingsByRoomIndex.get(roomIndex)
        const children = mergeContributors
          ? ([
              ...new Set(mergeContributors.flatMap((contributor) => contributor.children)),
            ] as CeilingNodeType['children'])
          : roomIndex == null
            ? ceiling.children
            : (childAssignmentsByCeilingId.get(ceiling.id)?.get(roomIndex) ?? ceiling.children)
        for (const contributor of mergeContributors ?? []) {
          if (contributor.id === ceiling.id) continue
          for (const childId of contributor.children) {
            childReparents.push({ id: childId, parentId: ceiling.id })
          }
        }
        if (!sameStringSet(ceiling.children, children)) data.children = children
        if (
          update.height !== undefined &&
          (ceiling.height === undefined ||
            Math.abs(ceiling.height - update.height) > ROOM_VERTICAL_PLANE_EPSILON)
        ) {
          data.height = update.height
        }
        return Object.keys(data).length > 0 ? [{ id: ceiling.id, data }] : []
      }),
    ...ceilingDemotions,
    ...manualClamps,
  ]

  const plannedCeilingsForNaming: Array<{ name?: string }> = [...namingCeilings]
  const ceilingsToCreate: CeilingNodeType[] = []
  for (let index = 0; index < detected.length; index += 1) {
    if (matchedDetectedIdx.has(index)) continue

    const room = detected[index]
    if (!room) continue

    const name = nextAutoRoomName(plannedCeilingsForNaming, 'Ceiling')
    plannedCeilingsForNaming.push({ name })

    const polygon = room.poly.map(pointToTuple)
    const sourceId = sourceCeilingIdByRoomIndex.get(index)
    const source = sourceId ? existingAuto.find((ceiling) => ceiling.id === sourceId) : undefined
    const openings = sourceId ? openingAssignmentsByCeilingId.get(sourceId)?.get(index) : undefined
    const children = sourceId ? childAssignmentsByCeilingId.get(sourceId)?.get(index) : undefined
    const height = source
      ? ceilingHeightForReconciledRoom(source, polygon, context)
      : context.heightForRoom?.(polygon)
    const created = CeilingNode.parse({
      name,
      polygon,
      children: children ?? [],
      holes: openings?.holes ?? [],
      holeMetadata: openings?.holeMetadata ?? [],
      material: source?.material,
      materialPreset: source?.materialPreset,
      slots: source?.slots,
      visible: source?.visible,
      ...(height !== undefined && Number.isFinite(height) ? { height } : {}),
      autoFromWalls: true,
    })
    ceilingsToCreate.push(created)
    for (const childId of children ?? []) {
      childReparents.push({ id: childId, parentId: created.id })
    }
  }

  return {
    create: ceilingsToCreate,
    update: ceilingsToUpdate,
    delete: ceilingsToDelete,
    reparent: childReparents,
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

  if (plan.update.length > 0) {
    sceneStore.getState().updateNodes(plan.update)
  }

  if (plan.create.length > 0) {
    sceneStore.getState().createNodes(plan.create.map((node) => ({ node, parentId: levelId })))
  }

  if (plan.reparent.length > 0) {
    sceneStore
      .getState()
      .updateNodes(plan.reparent.map(({ id, parentId }) => ({ id, data: { parentId } })))
  }

  if (plan.delete.length > 0) {
    sceneStore.getState().deleteNodes(plan.delete)
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
    rooms,
    roomPolygons,
    spaces: rooms.map((room) => buildSpace(levelId, room)),
    wallUpdates,
  }
}

export function detectSpacesForLevel(levelId: string, walls: WallNode[]) {
  return detectSpacesFromWalls(levelId, walls)
}

function runSpaceDetection(
  levelIds: string[],
  sceneStore: any,
  editorStore: any,
  nodes: any,
  previousNodes: any,
  previousRoomsByLevel: Map<string, ExtractedRoom[]>,
): void {
  const { updateNodes } = sceneStore.getState()
  const existingSpaces = editorStore.getState().spaces as Record<string, Space>
  const nextSpaces: Record<string, Space> = {}

  for (const [spaceId, space] of Object.entries(existingSpaces)) {
    if (!levelIds.includes(space.levelId)) {
      nextSpaces[spaceId] = space
    }
  }

  for (const levelId of levelIds) {
    const children = levelChildren(nodes, levelId)
    const walls = children.filter(
      (node: any): node is WallNode => node?.type === 'wall' && node.parentId === levelId,
    )
    const slabs = children.filter((node: any) => node?.type === 'slab')
    const ceilings = children.filter((node: any) => node?.type === 'ceiling')
    const zones = children.filter((node: any) => node?.type === 'zone')

    const { wallUpdates, spaces, rooms } = detectSpacesFromWalls(levelId, walls)

    const changedWallUpdates = wallUpdates.filter((update) => {
      const wall = nodes[update.wallId]
      return wall && (wall.frontSide !== update.frontSide || wall.backSide !== update.backSide)
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

    const levelNode = nodes[levelId]
    const storeyHeight =
      levelNode?.type === 'level'
        ? getStoredLevelHeight(levelNode as LevelNode)
        : DEFAULT_LEVEL_HEIGHT
    const parsedSlabs: SlabNodeType[] = slabs.map((slab: any) => SlabNode.parse(slab))
    const parsedCeilings: CeilingNodeType[] = ceilings.map((ceiling: any) =>
      CeilingNode.parse(ceiling),
    )
    const previousRooms = previousRoomsByLevel.get(levelId) ?? []
    const slabRooms = roomsEligibleForAutoSurface(previousRooms, rooms, parsedSlabs)
    const ceilingRooms = roomsEligibleForAutoSurface(previousRooms, rooms, parsedCeilings)
    const verticalPlacements = autoRoomVerticalPlacements(
      spaces,
      walls,
      // A derived floor cannot be evidence for its own next elevation: that
      // would lift unpinned walls, then lift the floor again on every pass.
      parsedSlabs.filter((slab) => !slab.autoFromWalls),
      nodes,
      storeyHeight,
    )
    const previousChildren = levelChildren(previousNodes, levelId)
    const previousWalls = previousChildren.filter(
      (node: any): node is WallNode => node?.type === 'wall' && node.parentId === levelId,
    )
    const previousSlabs: SlabNodeType[] = previousChildren
      .filter((node: any) => node?.type === 'slab')
      .map((slab: any) => SlabNode.parse(slab))
    const previousLevelNode = previousNodes[levelId]
    const previousStoreyHeight =
      previousLevelNode?.type === 'level'
        ? getStoredLevelHeight(previousLevelNode as LevelNode)
        : DEFAULT_LEVEL_HEIGHT
    const previousSpaces = detectSpacesFromWalls(levelId, previousWalls).spaces
    const previousVerticalPlacements = autoRoomVerticalPlacements(
      previousSpaces,
      previousWalls,
      previousSlabs.filter((slab) => !slab.autoFromWalls),
      previousNodes,
      previousStoreyHeight,
    )
    const placementFor = (polygon: Array<[number, number]>) =>
      verticalPlacements.get(polygonSignature(polygon.map(pointFromTuple)))
    const previousPlacementFor = (polygon: Array<[number, number]>) =>
      previousVerticalPlacements.get(polygonSignature(polygon.map(pointFromTuple)))
    syncAutoSlabsForLevel(
      levelId,
      slabRooms.map((room) => room.polygon),
      parsedSlabs,
      sceneStore,
      {
        elevationForRoom: (polygon) => placementFor(polygon)?.slabElevation,
        previousElevationForRoom: (polygon) => previousPlacementFor(polygon)?.slabElevation,
      },
    )
    syncAutoCeilingsForLevel(
      levelId,
      ceilingRooms.map((room) => room.polygon),
      parsedCeilings,
      sceneStore,
      {
        storeyHeight,
        ceilingClampBound: (polygon) => getCeilingClampBound(levelId, nodes, polygon),
        heightForRoom: (polygon) => placementFor(polygon)?.ceilingHeight,
        previousHeightForRoom: (polygon) => previousPlacementFor(polygon)?.ceilingHeight,
        childPosition: (childId) => {
          const child = nodes[childId]
          return child && Array.isArray(child.position)
            ? [child.position[0], child.position[2]]
            : undefined
        },
      },
    )
    const zonePlan = planAutoZonesForLevel(
      spaces,
      zones.map((zone: any) => ZoneNode.parse(zone)),
    )
    if (zonePlan.update.length > 0) updateNodes(zonePlan.update)

    for (const space of spaces) {
      nextSpaces[space.id] = space
    }
    previousRoomsByLevel.set(levelId, rooms)
  }

  editorStore.getState().setSpaces(nextSpaces)
}

function runIndexedSpaceDetection(
  levelId: string,
  topologyDelta: IndexedTopologyDelta<ExtractedRoom>,
  sceneStore: any,
  editorStore: any,
  nodes: SceneNodes,
  previousNodes: SceneNodes,
) {
  const { updateNodes } = sceneStore.getState()
  const allRoomPolygons = topologyDelta.allCurrentRooms.map((room) => room.polygon)
  const changedWallUpdates = topologyDelta.currentWalls
    .map((wall) => ({
      wallId: wall.id,
      ...resolveWallSurfaceSides(wall, allRoomPolygons),
    }))
    .filter((update) => {
      const wall = nodes[update.wallId]
      return (
        wall?.type === 'wall' &&
        (wall.frontSide !== update.frontSide || wall.backSide !== update.backSide)
      )
    })
  if (changedWallUpdates.length > 0) {
    updateNodes(
      changedWallUpdates.map((update) => ({
        id: update.wallId,
        data: { frontSide: update.frontSide, backSide: update.backSide },
      })),
    )
  }

  const scopedRooms = [...topologyDelta.beforeRooms, ...topologyDelta.currentRooms]
  if (scopedRooms.length > 0) {
    const unaffectedRooms = topologyDelta.allCurrentRooms.filter(
      (room) => !topologyDelta.currentRooms.includes(room),
    )
    const currentChildren = levelChildren(nodes, levelId)
    const allSlabs: SlabNodeType[] = currentChildren
      .filter((node: any): node is SlabNodeType => node.type === 'slab')
      .map((slab: SlabNodeType) => SlabNode.parse(slab))
    const allCeilings: CeilingNodeType[] = currentChildren
      .filter((node: any): node is CeilingNodeType => node.type === 'ceiling')
      .map((ceiling: CeilingNodeType) => CeilingNode.parse(ceiling))
    const slabs = allSlabs.filter(
      (slab) =>
        surfaceTouchesRooms(slab, scopedRooms) &&
        (!slab.autoFromWalls || !surfaceTouchesRooms(slab, unaffectedRooms)),
    )
    const ceilings = allCeilings.filter(
      (ceiling) =>
        surfaceTouchesRooms(ceiling, scopedRooms) &&
        (!ceiling.autoFromWalls || !surfaceTouchesRooms(ceiling, unaffectedRooms)),
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
    const levelNode = nodes[levelId]
    const storeyHeight =
      levelNode?.type === 'level'
        ? getStoredLevelHeight(levelNode as LevelNode)
        : DEFAULT_LEVEL_HEIGHT
    const currentSpaces = topologyDelta.currentRooms.map((room) => buildSpace(levelId, room))
    const verticalPlacements = autoRoomVerticalPlacements(
      currentSpaces,
      topologyDelta.currentWalls,
      allSlabs.filter((slab) => !slab.autoFromWalls),
      nodes,
      storeyHeight,
    )
    const previousChildren = levelChildren(previousNodes, levelId)
    const previousSlabs: SlabNodeType[] = previousChildren
      .filter((node: any): node is SlabNodeType => node.type === 'slab')
      .map((slab: SlabNodeType) => SlabNode.parse(slab))
    const previousLevelNode = previousNodes[levelId]
    const previousStoreyHeight =
      previousLevelNode?.type === 'level'
        ? getStoredLevelHeight(previousLevelNode as LevelNode)
        : DEFAULT_LEVEL_HEIGHT
    const previousSpaces = topologyDelta.beforeRooms.map((room) => buildSpace(levelId, room))
    const previousVerticalPlacements = autoRoomVerticalPlacements(
      previousSpaces,
      topologyDelta.previousWalls,
      previousSlabs.filter((slab) => !slab.autoFromWalls),
      previousNodes,
      previousStoreyHeight,
    )
    const placementFor = (polygon: Array<[number, number]>) =>
      verticalPlacements.get(polygonSignature(polygon.map(pointFromTuple)))
    const previousPlacementFor = (polygon: Array<[number, number]>) =>
      previousVerticalPlacements.get(polygonSignature(polygon.map(pointFromTuple)))

    syncAutoSlabsForLevel(
      levelId,
      slabRooms.map((room) => room.polygon),
      slabs,
      sceneStore,
      {
        elevationForRoom: (polygon) => placementFor(polygon)?.slabElevation,
        previousElevationForRoom: (polygon) => previousPlacementFor(polygon)?.slabElevation,
      },
      allSlabs,
    )
    syncAutoCeilingsForLevel(
      levelId,
      ceilingRooms.map((room) => room.polygon),
      ceilings,
      sceneStore,
      {
        storeyHeight,
        ceilingClampBound: (polygon) => getCeilingClampBound(levelId, nodes, polygon),
        heightForRoom: (polygon) => placementFor(polygon)?.ceilingHeight,
        previousHeightForRoom: (polygon) => previousPlacementFor(polygon)?.ceilingHeight,
        childPosition: (childId) => {
          const child = nodes[childId]
          return child && Array.isArray(child.position)
            ? [child.position[0], child.position[2]]
            : undefined
        },
      },
      allCeilings,
    )
  }

  const spaces = topologyDelta.allCurrentRooms.map((room) => buildSpace(levelId, room))
  const zones: ZoneNodeType[] = levelChildren(nodes, levelId)
    .filter((node: any): node is ZoneNodeType => node.type === 'zone')
    .map((zone: ZoneNodeType) => ZoneNode.parse(zone))
  const zonePlan = planAutoZonesForLevel(spaces, zones)
  if (zonePlan.update.length > 0) updateNodes(zonePlan.update)

  const existingSpaces = editorStore.getState().spaces as Record<string, Space>
  const nextSpaces: Record<string, Space> = {}
  for (const [spaceId, space] of Object.entries(existingSpaces)) {
    if (space.levelId !== levelId) nextSpaces[spaceId] = space
  }
  for (const space of spaces) nextSpaces[space.id] = space
  editorStore.getState().setSpaces(nextSpaces)
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
  // Baseline from whatever is already in the store. Detection reacts to wall
  // edits made IN-SESSION (create / move / delete); it must not re-litigate a
  // scene that merely loaded — rerunning on hydration resurrected auto slabs
  // the user had deleted in an earlier session.
  const initialNodes = sceneStore.getState().nodes
  const previousRoomsByLevel = new Map<string, ExtractedRoom[]>()
  const topologyIndex = new RoomTopologyIndex<ExtractedRoom>({
    detectRooms: extractRooms,
    sampleWall: (wall) => sampleWallPointsForRoomDetection(wall).map(pointToTuple),
    junctionTolerance: WALL_JUNCTION_TOLERANCE,
  })
  let previousNodes = initialNodes
  let isProcessing = false

  const adoptSceneBaseline = (nodes: SceneNodes) => {
    topologyIndex.rebuild(nodes)
    const roomsByLevel = detectedRoomsByLevel(nodes)
    previousRoomsByLevel.clear()
    const spaces: Record<string, Space> = {}
    for (const [levelId, rooms] of roomsByLevel) {
      previousRoomsByLevel.set(levelId, rooms)
      for (const room of rooms) {
        const space = buildSpace(levelId, room)
        spaces[space.id] = space
      }
    }
    editorStore.getState().setSpaces(spaces)
    previousNodes = nodes
  }

  adoptSceneBaseline(initialNodes)

  const unsubscribeCommits = subscribeSceneCommits((commit) => {
    if (commit.origin === 'local') return
    adoptSceneBaseline(commit.current.nodes)
  })

  const unsubscribe = sceneStore.subscribe((state: any) => {
    if (isProcessing) return
    if (getSceneHistoryPauseDepth() > 0) return

    const nodes = state.nodes
    const candidateIds = activeSceneCommitNodeIds()

    // Paused: roll the snapshot forward so we don't backfill (and re-duplicate)
    // every paused change once detection resumes. Whatever the AI built while
    // paused becomes the new baseline; only future changes will reconcile.
    if (spaceDetectionPauseDepth > 0) {
      adoptSceneBaseline(nodes)
      return
    }

    const changedWalls = changedWallIdsByLevel(previousNodes, nodes, candidateIds)
    if (candidateIds && changedWalls.size > 0) {
      const fallbackLevels = fallbackLevelIdsForCandidates(previousNodes, nodes, candidateIds)
      for (const levelId of changedWalls.keys()) fallbackLevels.delete(levelId)
      isProcessing = true
      pauseSceneHistory(sceneStore)
      try {
        for (const [levelId, wallIds] of changedWalls) {
          const topologyDelta = topologyIndex.applyWallDelta(levelId, wallIds, previousNodes, nodes)
          runIndexedSpaceDetection(
            levelId,
            topologyDelta,
            sceneStore,
            editorStore,
            nodes,
            previousNodes,
          )
          previousRoomsByLevel.set(levelId, topologyDelta.allCurrentRooms)
          options.onTopologyReconcile?.({
            levelId,
            strategy: topologyDelta.strategy,
            examinedWallIds: topologyDelta.examinedWallIds,
            affectedBeforeRoomCount: topologyDelta.beforeRooms.length,
            affectedCurrentRoomCount: topologyDelta.currentRooms.length,
          })
        }
        if (fallbackLevels.size > 0) {
          runSpaceDetection(
            [...fallbackLevels],
            sceneStore,
            editorStore,
            sceneStore.getState().nodes,
            previousNodes,
            previousRoomsByLevel,
          )
          const liveNodes = sceneStore.getState().nodes
          for (const levelId of fallbackLevels) topologyIndex.rebuildLevel(levelId, liveNodes)
        }
      } finally {
        resumeSceneHistory(sceneStore)
        previousNodes = sceneStore.getState().nodes
        isProcessing = false
      }
      return
    }

    const levelsToUpdate = new Set<string>()
    if (candidateIds) {
      for (const levelId of fallbackLevelIdsForCandidates(previousNodes, nodes, candidateIds)) {
        levelsToUpdate.add(levelId)
      }
    } else {
      const previousSnapshots = levelStructureSnapshots(previousNodes)
      const currentSnapshots = levelStructureSnapshots(nodes)
      for (const levelId of new Set([...previousSnapshots.keys(), ...currentSnapshots.keys()])) {
        // First sight of a level is a hydration baseline, not a wall edit —
        // `setScene` delivers a loaded scene as one atomic update, and a level's
        // first wall can't close a room anyway. Record it (below) and only
        // react to subsequent changes.
        const previous = previousSnapshots.get(levelId)
        if (previous === undefined) continue
        if (previous !== (currentSnapshots.get(levelId) ?? '')) {
          levelsToUpdate.add(levelId)
        }
      }
    }

    if (levelsToUpdate.size === 0) {
      if (candidateIds) {
        previousNodes = nodes
        return
      }
      const currentRoomsByLevel = detectedRoomsByLevel(nodes)
      previousRoomsByLevel.clear()
      for (const [levelId, rooms] of currentRoomsByLevel) {
        previousRoomsByLevel.set(levelId, rooms)
      }
      previousNodes = nodes
      return
    }

    isProcessing = true
    pauseSceneHistory(sceneStore)
    try {
      runSpaceDetection(
        [...levelsToUpdate],
        sceneStore,
        editorStore,
        nodes,
        previousNodes,
        previousRoomsByLevel,
      )
    } finally {
      resumeSceneHistory(sceneStore)
      const liveNodes = sceneStore.getState().nodes
      for (const levelId of levelsToUpdate) topologyIndex.rebuildLevel(levelId, liveNodes)
      previousNodes = liveNodes
      isProcessing = false
    }
  })

  return () => {
    unsubscribe()
    unsubscribeCommits()
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
