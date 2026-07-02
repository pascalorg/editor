import {
  CeilingNode,
  type CeilingNode as CeilingNodeType,
  SlabNode,
  type SlabNode as SlabNodeType,
  type WallNode,
} from '../schema'
import {
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resumeSceneHistory,
} from '../store/history-control'
import {
  getClampedWallCurveOffset,
  getWallCurveFrameAt,
  isCurvedWall,
} from '../systems/wall/wall-curve'
import { simplifyClosedPolygon } from './polygon-geometry'

type Point2D = { x: number; y: number }

export type Space = {
  id: string
  levelId: string
  polygon: Array<[number, number]>
  wallIds: string[]
  isExterior: boolean
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

type DetectedCeilingRoom = DetectedRoom & {
  ceilingHeight: number
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

const DEFAULT_AUTO_SLAB_ELEVATION = 0.05
const DEFAULT_AUTO_CEILING_HEIGHT = 2.5
const CEILING_HEIGHT_EPSILON = 1e-6
const ROOM_CURVE_TOLERANCE = 0.04
const MAX_CURVE_SUBDIVISION_DEPTH = 6
const AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE = 0.08
const WALL_ROOM_BOUNDARY_TOLERANCE = 0.08
// A wall endpoint within this distance of another wall's interior is treated as a
// T-junction and splits that wall (see `splitStraightWallAtVertices`).
const WALL_JUNCTION_TOLERANCE = 0.08

export type AutoCeilingPlanningContext = {
  walls?: WallNode[]
  slabs?: SlabNodeType[]
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

function pointIsOnSlab(point: Point2D, slab: SlabNodeType) {
  if (slab.polygon.length < 3) return false
  const slabPolygon = slab.polygon.map(pointFromTuple)
  if (!pointInPolygon(point, slabPolygon)) return false

  for (const hole of slab.holes ?? []) {
    if (hole.length >= 3 && pointInPolygon(point, hole.map(pointFromTuple))) {
      return false
    }
  }

  return true
}

function slabSupportsRoom(roomPolygon: Point2D[], slab: SlabNodeType) {
  if (slab.polygon.length < 3) return false
  if (polygonSignature(slab.polygon.map(pointFromTuple)) === polygonSignature(roomPolygon)) {
    return true
  }
  return pointIsOnSlab(polygonCentroid(roomPolygon), slab)
}

function resolveRoomSlabElevation(roomPolygon: Point2D[], slabs: SlabNodeType[] = []) {
  let maxElevation = 0

  for (const slab of slabs) {
    if (!slabSupportsRoom(roomPolygon, slab)) continue
    maxElevation = Math.max(maxElevation, slab.elevation ?? DEFAULT_AUTO_SLAB_ELEVATION)
  }

  return maxElevation
}

function resolveRoomWallHeight(roomPolygon: Point2D[], walls: WallNode[] = []) {
  let maxHeight = 0

  for (const wall of walls) {
    if (!wallBoundsRoom(wall, roomPolygon)) continue
    const height = wall.height ?? DEFAULT_AUTO_CEILING_HEIGHT
    if (Number.isFinite(height)) {
      maxHeight = Math.max(maxHeight, height)
    }
  }

  return maxHeight > 0 ? maxHeight : DEFAULT_AUTO_CEILING_HEIGHT
}

function resolveAutoCeilingHeight(
  roomPolygon: Point2D[],
  context: AutoCeilingPlanningContext = {},
) {
  return (
    resolveRoomSlabElevation(roomPolygon, context.slabs) +
    resolveRoomWallHeight(roomPolygon, context.walls)
  )
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

function extractRoomPolygons(walls: WallNode[]): Point2D[][] {
  if (walls.length < 3) return []

  type HalfEdge = {
    id: string
    reverseId: string
    fromKey: string
    toKey: string
    angle: number
    points: Point2D[]
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
      })
      halfEdges.set(reverseId, {
        id: reverseId,
        reverseId: forwardId,
        fromKey: toKey,
        toKey: fromKey,
        angle: Math.atan2(reversePoints[1]!.y - to.y, reversePoints[1]!.x - to.x),
        points: reversePoints,
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

  const visitedDirected = new Set<string>()
  const faces: Point2D[][] = []
  // A single face cannot revisit a half-edge, so the half-edge count bounds the
  // longest possible cycle. Splitting at junctions can multiply edges per wall.
  const maxSteps = Math.min(2000, halfEdges.size + 10)

  for (const edgeId of halfEdges.keys()) {
    if (visitedDirected.has(edgeId)) continue

    const cycleEdgeIds: string[] = []
    let currentEdgeId = edgeId
    let valid = true

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
      if (currentEdgeId === edgeId) break
    }

    if (!valid || cycleEdgeIds.length < 3) continue

    const polygon = dedupeSequentialPoints(
      cycleEdgeIds.flatMap((id, index) => {
        const points = halfEdges.get(id)?.points ?? []
        return index === cycleEdgeIds.length - 1 ? points : points.slice(0, -1)
      }),
    )

    if (polygon.length < 3) continue

    const signedArea = polygonArea(polygon)
    if (signedArea <= 0) continue
    if (signedArea < 0.5 || signedArea > 10_000) continue

    const signature = polygonSignature(polygon)
    if (faces.some((face) => polygonSignature(face) === signature)) continue

    faces.push(polygon)
  }

  faces.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))
  return faces
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

function wallGeometrySignature(wall: WallNode) {
  return [
    wall.id,
    wall.start[0].toFixed(4),
    wall.start[1].toFixed(4),
    wall.end[0].toFixed(4),
    wall.end[1].toFixed(4),
    (wall.thickness ?? 0.2).toFixed(4),
    (wall.height ?? DEFAULT_AUTO_CEILING_HEIGHT).toFixed(4),
    getClampedWallCurveOffset(wall).toFixed(4),
  ].join('|')
}

function levelWallSnapshot(walls: WallNode[]) {
  return walls.map(wallGeometrySignature).sort().join('||')
}

// Trigger signature is wall-only on purpose: re-detection should fire on a
// genuine remodel (wall geometry change), never when an auto-slab is edited or
// deleted. Hashing slabs here created a feedback loop where deleting an
// auto-slab re-fired detection and recreated it.
function levelStructureSnapshots(nodes: Record<string, any>) {
  const byLevel = new Map<string, WallNode[]>()

  for (const node of Object.values(nodes)) {
    if (!(node && typeof node === 'object' && 'parentId' in node && node.parentId)) continue
    if ((node as any).type !== 'wall') continue
    const levelId = (node as any).parentId as string
    const walls = byLevel.get(levelId) ?? []
    walls.push(node as WallNode)
    byLevel.set(levelId, walls)
  }

  const snapshots = new Map<string, string>()
  for (const [levelId, walls] of byLevel.entries()) {
    snapshots.set(levelId, levelWallSnapshot(walls))
  }

  return snapshots
}

function buildSpace(levelId: string, polygon: Point2D[]): Space {
  const signature = polygonSignature(polygon)
  return {
    id: `space-${levelId}-${signature.slice(0, 12)}`,
    levelId,
    polygon: polygon.map(pointToTuple),
    wallIds: [],
    isExterior: false,
  }
}

export function planAutoSlabsForLevel(
  roomPolygons: Point2D[][],
  existingSlabs: SlabNodeType[],
): AutoSlabSyncPlan {
  const manualSlabs = existingSlabs.filter((slab) => !slab.autoFromWalls)
  const manualSignatures = new Set(
    manualSlabs.map((slab) => polygonSignature(slab.polygon.map(pointFromTuple))),
  )

  const detected: DetectedRoom[] = roomPolygons
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
    .filter(({ sig }) => !manualSignatures.has(sig))

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

  const matchedSlabIds = new Set<string>()
  const matchedDetectedIdx = new Set<number>()
  const updatesById = new Map<string, [number, number][]>()

  const autoBySignature = new Map<string, Array<(typeof existingAutoMeta)[number]>>()
  for (const entry of existingAutoMeta) {
    const bucket = autoBySignature.get(entry.sig) ?? []
    bucket.push(entry)
    autoBySignature.set(entry.sig, bucket)
  }

  detected.forEach((room, index) => {
    const existing = autoBySignature.get(room.sig)?.shift()
    if (!existing) return

    matchedDetectedIdx.add(index)
    matchedSlabIds.add(existing.slab.id)
    updatesById.set(existing.slab.id, room.poly.map(pointToTuple))
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
    updatesById.set(bestMatch.entry.slab.id, room.poly.map(pointToTuple))
  }

  const slabsToDelete = existingAuto
    .filter((slab) => !updatesById.has(slab.id))
    .map((slab) => slab.id)

  const slabsToUpdate = existingAuto
    .filter((slab) => updatesById.has(slab.id))
    .flatMap((slab) => {
      const polygon = updatesById.get(slab.id)
      if (!polygon) return []

      return sameTuplePolygon(slab.polygon, polygon) ? [] : [{ id: slab.id, data: { polygon } }]
    })

  const plannedSlabsForNaming: Array<{ name?: string }> = [...existingSlabs]
  const slabsToCreate: SlabNodeType[] = []
  for (let index = 0; index < detected.length; index += 1) {
    if (matchedDetectedIdx.has(index)) continue

    const room = detected[index]
    if (!room) continue

    const name = nextAutoRoomName(plannedSlabsForNaming, 'Slab')
    plannedSlabsForNaming.push({ name })

    slabsToCreate.push(
      SlabNode.parse({
        name,
        polygon: room.poly.map(pointToTuple),
        holes: [],
        elevation: DEFAULT_AUTO_SLAB_ELEVATION,
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
) {
  const plan = planAutoSlabsForLevel(roomPolygons, existingSlabs)

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

export function projectAutoSlabsForPlan(
  existingSlabs: SlabNodeType[],
  plan: AutoSlabSyncPlan,
): SlabNodeType[] {
  const slabsById = new Map(existingSlabs.map((slab) => [slab.id, slab]))

  for (const id of plan.delete) {
    slabsById.delete(id)
  }

  for (const update of plan.update) {
    const slab = slabsById.get(update.id)
    if (!slab) continue
    slabsById.set(update.id, SlabNode.parse({ ...slab, ...update.data }))
  }

  for (const slab of plan.create) {
    slabsById.set(slab.id, slab)
  }

  return [...slabsById.values()]
}

export function planAutoCeilingsForLevel(
  roomPolygons: Point2D[][],
  existingCeilings: CeilingNodeType[],
  context: AutoCeilingPlanningContext = {},
): AutoCeilingSyncPlan {
  const manualCeilings = existingCeilings.filter((ceiling) => !ceiling.autoFromWalls)
  const manualSignatures = new Set(
    manualCeilings.map((ceiling) => polygonSignature(ceiling.polygon.map(pointFromTuple))),
  )

  const detected: DetectedCeilingRoom[] = roomPolygons
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
      ceilingHeight: resolveAutoCeilingHeight(room.poly, context),
    }))
    .filter(({ sig }) => !manualSignatures.has(sig))

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

  const matchedCeilingIds = new Set<string>()
  const matchedDetectedIdx = new Set<number>()
  const updatesById = new Map<string, { polygon: [number, number][]; height: number }>()

  const autoBySignature = new Map<string, Array<(typeof existingAutoMeta)[number]>>()
  for (const entry of existingAutoMeta) {
    const bucket = autoBySignature.get(entry.sig) ?? []
    bucket.push(entry)
    autoBySignature.set(entry.sig, bucket)
  }

  detected.forEach((room, index) => {
    const existing = autoBySignature.get(room.sig)?.shift()
    if (!existing) return

    matchedDetectedIdx.add(index)
    matchedCeilingIds.add(existing.ceiling.id)
    updatesById.set(existing.ceiling.id, {
      polygon: room.poly.map(pointToTuple),
      height: room.ceilingHeight,
    })
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
    updatesById.set(bestMatch.entry.ceiling.id, {
      polygon: room.poly.map(pointToTuple),
      height: room.ceilingHeight,
    })
  }

  const ceilingsToDelete = existingAuto
    .filter((ceiling) => !updatesById.has(ceiling.id))
    .map((ceiling) => ceiling.id)

  const ceilingsToUpdate = existingAuto
    .filter((ceiling) => updatesById.has(ceiling.id))
    .flatMap((ceiling) => {
      const update = updatesById.get(ceiling.id)
      if (!update) return []

      const data: Partial<CeilingNodeType> = {}
      if (!sameTuplePolygon(ceiling.polygon, update.polygon)) {
        data.polygon = update.polygon
      }
      if (
        Math.abs((ceiling.height ?? DEFAULT_AUTO_CEILING_HEIGHT) - update.height) >
        CEILING_HEIGHT_EPSILON
      ) {
        data.height = update.height
      }

      return Object.keys(data).length === 0 ? [] : [{ id: ceiling.id, data }]
    })

  const plannedCeilingsForNaming: Array<{ name?: string }> = [...existingCeilings]
  const ceilingsToCreate: CeilingNodeType[] = []
  for (let index = 0; index < detected.length; index += 1) {
    if (matchedDetectedIdx.has(index)) continue

    const room = detected[index]
    if (!room) continue

    const name = nextAutoRoomName(plannedCeilingsForNaming, 'Ceiling')
    plannedCeilingsForNaming.push({ name })

    ceilingsToCreate.push(
      CeilingNode.parse({
        name,
        polygon: room.poly.map(pointToTuple),
        holes: [],
        height: room.ceilingHeight,
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
) {
  const plan = planAutoCeilingsForLevel(roomPolygons, existingCeilings, context)

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
  const roomPolygons = extractRoomPolygons(walls)
  const wallUpdates: WallSideUpdate[] = walls.map((wall) => ({
    wallId: wall.id,
    ...(resolveWallSurfaceSides(wall, roomPolygons) satisfies Pick<
      WallSideUpdate,
      'frontSide' | 'backSide'
    >),
  }))

  return {
    roomPolygons,
    spaces: roomPolygons.map((polygon) => buildSpace(levelId, polygon)),
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
    const walls = Object.values(nodes).filter(
      (node: any): node is WallNode => node?.type === 'wall' && node.parentId === levelId,
    )

    const slabs = Object.values(nodes).filter(
      (node: any) => node?.type === 'slab' && node.parentId === levelId,
    )
    const ceilings = Object.values(nodes).filter(
      (node: any) => node?.type === 'ceiling' && node.parentId === levelId,
    )

    const { wallUpdates, spaces, roomPolygons } = detectSpacesFromWalls(levelId, walls)

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

    const parsedSlabs = slabs.map((slab: any) => SlabNode.parse(slab))
    const slabPlan = syncAutoSlabsForLevel(levelId, roomPolygons, parsedSlabs, sceneStore)
    const projectedSlabs = projectAutoSlabsForPlan(parsedSlabs, slabPlan)
    syncAutoCeilingsForLevel(
      levelId,
      roomPolygons,
      ceilings.map((ceiling: any) => CeilingNode.parse(ceiling)),
      sceneStore,
      { walls, slabs: projectedSlabs },
    )

    for (const space of spaces) {
      nextSpaces[space.id] = space
    }
  }

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

export function initSpaceDetectionSync(sceneStore: any, editorStore: any): () => void {
  const previousSnapshots = new Map<string, string>()
  let isProcessing = false

  const unsubscribe = sceneStore.subscribe((state: any) => {
    if (isProcessing) return
    if (getSceneHistoryPauseDepth() > 0) return

    const nodes = state.nodes
    const currentSnapshots = levelStructureSnapshots(nodes)

    // Paused: roll the snapshot forward so we don't backfill (and re-duplicate)
    // every paused change once detection resumes. Whatever the AI built while
    // paused becomes the new baseline; only future changes will reconcile.
    if (spaceDetectionPauseDepth > 0) {
      previousSnapshots.clear()
      for (const [levelId, snapshot] of currentSnapshots.entries()) {
        previousSnapshots.set(levelId, snapshot)
      }
      return
    }

    const levelsToUpdate = new Set<string>()
    for (const levelId of new Set([...previousSnapshots.keys(), ...currentSnapshots.keys()])) {
      if ((previousSnapshots.get(levelId) ?? '') !== (currentSnapshots.get(levelId) ?? '')) {
        levelsToUpdate.add(levelId)
      }
    }

    if (levelsToUpdate.size === 0) {
      previousSnapshots.clear()
      for (const [levelId, snapshot] of currentSnapshots.entries()) {
        previousSnapshots.set(levelId, snapshot)
      }
      return
    }

    isProcessing = true
    pauseSceneHistory(sceneStore)
    try {
      runSpaceDetection([...levelsToUpdate], sceneStore, editorStore, nodes)
    } finally {
      resumeSceneHistory(sceneStore)
      previousSnapshots.clear()
      const postRunSnapshots = levelStructureSnapshots(sceneStore.getState().nodes)
      for (const [levelId, snapshot] of postRunSnapshots.entries()) {
        previousSnapshots.set(levelId, snapshot)
      }
      isProcessing = false
    }
  })

  return unsubscribe
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
