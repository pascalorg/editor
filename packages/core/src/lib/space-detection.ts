import {
  getClampedWallCurveOffset,
  getWallCurveFrameAt,
  isCurvedWall,
} from '../systems/wall/wall-curve'
import { simplifyClosedPolygon } from './polygon-geometry'
import { SlabNode, type SlabNode as SlabNodeType, type WallNode } from '../schema'

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

const DEFAULT_AUTO_SLAB_ELEVATION = 0.05
const ROOM_CURVE_TOLERANCE = 0.04
const MAX_CURVE_SUBDIVISION_DEPTH = 6
const AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE = 0.08

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
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

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

  const subdivide = (t0: number, p0: Point2D, t1: number, p1: Point2D, depth: number): Point2D[] => {
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

function getDirectedWallBoundaryPoints(wall: WallNode, forward: boolean) {
  const points = sampleWallPointsForRoomDetection(wall)
  return forward ? points : [...points].reverse()
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

  for (const wall of walls) {
    const start = pointFromTuple(wall.start)
    const end = pointFromTuple(wall.end)
    const startKey = upsertNode(start)
    const endKey = upsertNode(end)
    if (startKey === endKey) continue

    const forwardDirection = getWallDirection(wall)
    const reverseDirection = getWallDirection({ start: wall.end, end: wall.start })

    const forwardId = `${wall.id}:f`
    const reverseId = `${wall.id}:r`

    halfEdges.set(forwardId, {
      id: forwardId,
      reverseId,
      fromKey: startKey,
      toKey: endKey,
      angle: Math.atan2(forwardDirection.tangent.y, forwardDirection.tangent.x),
      points: getDirectedWallBoundaryPoints(wall, true),
    })
    halfEdges.set(reverseId, {
      id: reverseId,
      reverseId: forwardId,
      fromKey: endKey,
      toKey: startKey,
      angle: Math.atan2(reverseDirection.tangent.y, reverseDirection.tangent.x),
      points: getDirectedWallBoundaryPoints(wall, false),
    })

    graph.get(startKey)?.outgoing.push(forwardId)
    graph.get(endKey)?.outgoing.push(reverseId)
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
  const maxSteps = Math.min(500, walls.length * 8 + 20)

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
    if (signedArea < 0.5 || signedArea > 10000) continue

    const signature = polygonSignature(polygon)
    if (faces.some((face) => polygonSignature(face) === signature)) continue

    faces.push(polygon)
  }

  faces.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))
  return faces
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
  slabs: Array<{
    name?: string
  }>,
) {
  let maxIndex = 0

  for (const slab of slabs) {
    const match = /^Room\s+(\d+)$/.exec((slab.name ?? '').trim())
    if (!match) continue
    const index = Number(match[1])
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index)
    }
  }

  return `Room ${maxIndex + 1}`
}

function wallGeometrySignature(wall: WallNode) {
  return [
    wall.id,
    wall.start[0].toFixed(4),
    wall.start[1].toFixed(4),
    wall.end[0].toFixed(4),
    wall.end[1].toFixed(4),
    (wall.thickness ?? 0.2).toFixed(4),
    getClampedWallCurveOffset(wall).toFixed(4),
  ].join('|')
}

function levelWallSnapshot(walls: WallNode[]) {
  return walls.map(wallGeometrySignature).sort().join('||')
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

function syncAutoSlabsForLevel(
  levelId: string,
  roomPolygons: Point2D[][],
  existingSlabs: SlabNodeType[],
  sceneStore: any,
) {
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

  const autoBySignature = new Map<string, (typeof existingAutoMeta)[number]>()
  for (const entry of existingAutoMeta) {
    autoBySignature.set(entry.sig, entry)
  }

  detected.forEach((room, index) => {
    const existing = autoBySignature.get(room.sig)
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

      const samePolygon =
        slab.polygon.length === polygon.length &&
        slab.polygon.every((point, index) => {
          const nextPoint = polygon[index]
          return point[0] === nextPoint?.[0] && point[1] === nextPoint?.[1]
        })

      return samePolygon ? [] : [{ id: slab.id, data: { polygon } }]
    })

  const plannedSlabsForNaming: Array<{ name?: string }> = [...existingSlabs]
  const slabsToCreate: SlabNodeType[] = []
  for (let index = 0; index < detected.length; index += 1) {
    if (matchedDetectedIdx.has(index)) continue

    const room = detected[index]
    if (!room) continue

    const name = nextAutoRoomName(plannedSlabsForNaming)
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

  if (slabsToDelete.length > 0) {
    sceneStore.getState().deleteNodes(slabsToDelete)
  }

  if (slabsToUpdate.length > 0) {
    sceneStore.getState().updateNodes(slabsToUpdate)
  }

  if (slabsToCreate.length > 0) {
    sceneStore.getState().createNodes(slabsToCreate.map((node) => ({ node, parentId: levelId })))
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

    syncAutoSlabsForLevel(
      levelId,
      roomPolygons,
      slabs.map((slab: any) => SlabNode.parse(slab)),
      sceneStore,
    )

    for (const space of spaces) {
      nextSpaces[space.id] = space
    }
  }

  editorStore.getState().setSpaces(nextSpaces)
}

export function initSpaceDetectionSync(sceneStore: any, editorStore: any): () => void {
  const previousSnapshots = new Map<string, string>()
  let isProcessing = false

  const unsubscribe = sceneStore.subscribe((state: any) => {
    if (isProcessing) return

    const nodes = state.nodes
    const wallsByLevel = new Map<string, WallNode[]>()

    for (const node of Object.values(nodes)) {
      if (node && (node as any).type === 'wall' && (node as any).parentId) {
        const levelId = (node as any).parentId as string
        const levelWalls = wallsByLevel.get(levelId) ?? []
        levelWalls.push(node as WallNode)
        wallsByLevel.set(levelId, levelWalls)
      }
    }

    const currentSnapshots = new Map<string, string>()
    for (const [levelId, walls] of wallsByLevel.entries()) {
      currentSnapshots.set(levelId, levelWallSnapshot(walls))
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
    sceneStore.temporal.getState().pause()
    try {
      runSpaceDetection([...levelsToUpdate], sceneStore, editorStore, nodes)
    } finally {
      sceneStore.temporal.getState().resume()
      previousSnapshots.clear()
      for (const [levelId, snapshot] of currentSnapshots.entries()) {
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
