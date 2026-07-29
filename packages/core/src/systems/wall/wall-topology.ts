import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  getScaledDimensions,
  type ItemNode,
  type WallNode,
  WallNode as WallSchema,
  type WindowNode,
} from '../../schema'
import { getWallArcData, getWallCurveFrameAt, getWallCurveLength, isCurvedWall } from './wall-curve'
import type { WallPlanPoint } from './wall-move'

const WALL_MIN_LENGTH = 0.01
const WALL_SPLIT_ENDPOINT_EPSILON = 0.02
const WALL_INTERSECTION_EPSILON = 1e-6

export type WallProjection = {
  point: WallPlanPoint
  wallT: number
}

export type WallSegmentIntersection = {
  wallId: WallNode['id']
  point: WallPlanPoint
  draftT: number
  wallT: number
}

export type WallTopologyChanges = {
  create: Array<{ node: AnyNode; parentId?: AnyNodeId }>
  update: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>
  delete: AnyNodeId[]
}

export type WallInsertionPlan = {
  changes: WallTopologyChanges
  insertedWalls: WallNode[]
  terminalWallId: WallNode['id']
  resolvedStart: WallPlanPoint
  resolvedEnd: WallPlanPoint
}

export type WallPointSplitPlan = {
  changes: WallTopologyChanges
  point: WallPlanPoint
}

type WallSplitRequest = {
  point: WallPlanPoint
  wallT: number
}

type PlannedWallSplit = {
  create: WallNode[]
  update: WallTopologyChanges['update']
}

function distanceSquared(a: WallPlanPoint, b: WallPlanPoint) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

function pointsEqual(a: WallPlanPoint, b: WallPlanPoint, tolerance = WALL_INTERSECTION_EPSILON) {
  return distanceSquared(a, b) <= tolerance * tolerance
}

function isSegmentLongEnough(start: WallPlanPoint, end: WallPlanPoint) {
  return distanceSquared(start, end) >= WALL_MIN_LENGTH * WALL_MIN_LENGTH
}

export function projectPointOntoWallCenterline(
  point: WallPlanPoint,
  wall: WallNode,
): WallProjection | null {
  if (isCurvedWall(wall)) {
    const arc = getWallArcData(wall)
    if (!arc) return null

    const pointAngle = Math.atan2(point[1] - arc.center.y, point[0] - arc.center.x)
    let directedAngle = (pointAngle - arc.startAngle) * arc.direction
    while (directedAngle < 0) directedAngle += Math.PI * 2

    const wallT = directedAngle / Math.abs(arc.delta)
    if (wallT <= 0 || wallT >= 1) return null

    const frame = getWallCurveFrameAt(wall, wallT)
    return { point: [frame.point.x, frame.point.y], wallT }
  }

  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) return null

  const wallT = ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dz) / lengthSquared
  if (wallT <= 0 || wallT >= 1) return null

  return {
    point: [wall.start[0] + dx * wallT, wall.start[1] + dz * wallT],
    wallT,
  }
}

function straightSegmentIntersection(
  start: WallPlanPoint,
  end: WallPlanPoint,
  wall: WallNode,
): Omit<WallSegmentIntersection, 'wallId'> | null {
  const rx = end[0] - start[0]
  const rz = end[1] - start[1]
  const sx = wall.end[0] - wall.start[0]
  const sz = wall.end[1] - wall.start[1]
  const denominator = rx * sz - rz * sx
  if (Math.abs(denominator) < 1e-9) return null

  const offsetX = wall.start[0] - start[0]
  const offsetZ = wall.start[1] - start[1]
  const draftT = (offsetX * sz - offsetZ * sx) / denominator
  const wallT = (offsetX * rz - offsetZ * rx) / denominator
  if (draftT < 0 || draftT > 1 || wallT < 0 || wallT > 1) return null

  return {
    point: [start[0] + draftT * rx, start[1] + draftT * rz],
    draftT,
    wallT,
  }
}

function curvedSegmentIntersections(
  start: WallPlanPoint,
  end: WallPlanPoint,
  wall: WallNode,
): Array<Omit<WallSegmentIntersection, 'wallId'>> {
  const arc = getWallArcData(wall)
  if (!arc) return []

  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const offsetX = start[0] - arc.center.x
  const offsetZ = start[1] - arc.center.y
  const a = dx * dx + dz * dz
  if (a < 1e-12) return []

  const b = 2 * (offsetX * dx + offsetZ * dz)
  const c = offsetX * offsetX + offsetZ * offsetZ - arc.radius * arc.radius
  const discriminant = b * b - 4 * a * c
  if (discriminant < -1e-9) return []

  const root = Math.sqrt(Math.max(0, discriminant))
  const results: Array<Omit<WallSegmentIntersection, 'wallId'>> = []
  for (const rawDraftT of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (rawDraftT < -1e-9 || rawDraftT > 1 + 1e-9) continue
    const point: WallPlanPoint = [start[0] + rawDraftT * dx, start[1] + rawDraftT * dz]
    const angle = Math.atan2(point[1] - arc.center.y, point[0] - arc.center.x)
    let directedAngle = (angle - arc.startAngle) * arc.direction
    while (directedAngle < 0) directedAngle += Math.PI * 2
    const rawWallT = directedAngle / Math.abs(arc.delta)
    if (rawWallT < -1e-9 || rawWallT > 1 + 1e-9) continue
    if (results.some((candidate) => distanceSquared(candidate.point, point) < 1e-12)) continue

    results.push({
      point,
      draftT: Math.max(0, Math.min(1, rawDraftT)),
      wallT: Math.max(0, Math.min(1, rawWallT)),
    })
  }
  return results
}

export function findWallSegmentIntersections(
  start: WallPlanPoint,
  end: WallPlanPoint,
  walls: WallNode[],
): WallSegmentIntersection[] {
  return walls.flatMap((wall) => {
    const intersections = isCurvedWall(wall)
      ? curvedSegmentIntersections(start, end, wall)
      : [straightSegmentIntersection(start, end, wall)].filter(
          (entry): entry is Omit<WallSegmentIntersection, 'wallId'> => entry !== null,
        )
    return intersections.map((intersection) => ({ wallId: wall.id, ...intersection }))
  })
}

export function wallSegmentsCoverSegment(
  start: WallPlanPoint,
  end: WallPlanPoint,
  walls: WallNode[],
  tolerance = WALL_INTERSECTION_EPSILON,
) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= tolerance * tolerance) return false

  const length = Math.sqrt(lengthSquared)
  const intervals: Array<[number, number]> = []
  for (const wall of walls) {
    if (isCurvedWall(wall)) continue
    const startDistance =
      Math.abs((wall.start[0] - start[0]) * dz - (wall.start[1] - start[1]) * dx) / length
    const endDistance =
      Math.abs((wall.end[0] - start[0]) * dz - (wall.end[1] - start[1]) * dx) / length
    if (startDistance > tolerance || endDistance > tolerance) continue

    const wallStartT =
      ((wall.start[0] - start[0]) * dx + (wall.start[1] - start[1]) * dz) / lengthSquared
    const wallEndT = ((wall.end[0] - start[0]) * dx + (wall.end[1] - start[1]) * dz) / lengthSquared
    const intervalStart = Math.max(0, Math.min(wallStartT, wallEndT))
    const intervalEnd = Math.min(1, Math.max(wallStartT, wallEndT))
    if (intervalEnd >= intervalStart) intervals.push([intervalStart, intervalEnd])
  }

  intervals.sort((left, right) => left[0] - right[0])
  const parameterTolerance = tolerance / length
  let coveredUntil = 0
  for (const [intervalStart, intervalEnd] of intervals) {
    if (intervalStart > coveredUntil + parameterTolerance) return false
    coveredUntil = Math.max(coveredUntil, intervalEnd)
    if (coveredUntil >= 1 - parameterTolerance) return true
  }
  return false
}

function wallsForLevel(nodes: Record<AnyNodeId, AnyNode>, levelId: AnyNodeId) {
  return Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
  )
}

function nearestWallProjection(
  point: WallPlanPoint,
  walls: WallNode[],
  radius: number,
  ignoreWallIds: ReadonlySet<string>,
): { wall: WallNode | null; point: WallPlanPoint; wallT: number } | null {
  let best: { wall: WallNode | null; point: WallPlanPoint; wallT: number } | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    if (ignoreWallIds.has(wall.id)) continue
    const projection = projectPointOntoWallCenterline(point, wall)
    if (!projection) continue
    const candidateDistance = distanceSquared(point, projection.point)
    if (candidateDistance > radius * radius || candidateDistance >= bestDistance) continue

    const corner = ([wall.start, wall.end] as WallPlanPoint[]).find(
      (candidate) =>
        distanceSquared(projection.point, candidate) <=
        WALL_SPLIT_ENDPOINT_EPSILON * WALL_SPLIT_ENDPOINT_EPSILON,
    )
    best = corner
      ? { wall: null, point: [corner[0], corner[1]], wallT: projection.wallT }
      : { wall, ...projection }
    bestDistance = candidateDistance
  }
  return best
}

function wallLength(wall: WallNode) {
  return isCurvedWall(wall)
    ? getWallCurveLength(wall)
    : Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function attachmentSpan(node: AnyNode): { min: number; max: number; center: number } | null {
  if (node.type === 'door') {
    const door = node as DoorNode
    return {
      min: door.position[0] - door.width / 2,
      max: door.position[0] + door.width / 2,
      center: door.position[0],
    }
  }
  if (node.type === 'window') {
    const window = node as WindowNode
    return {
      min: window.position[0] - window.width / 2,
      max: window.position[0] + window.width / 2,
      center: window.position[0],
    }
  }
  if (node.type === 'item') {
    const item = node as ItemNode
    if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') return null
    const [width] = getScaledDimensions(item)
    return {
      min: item.position[0] - width / 2,
      max: item.position[0] + width / 2,
      center: item.position[0],
    }
  }
  return null
}

function wallAttachments(wall: WallNode, nodes: Record<AnyNodeId, AnyNode>) {
  const ids = new Set<AnyNodeId>((wall.children ?? []) as AnyNodeId[])
  for (const node of Object.values(nodes)) {
    if (
      node.parentId === wall.id ||
      ('wallId' in node && typeof node.wallId === 'string' && node.wallId === wall.id)
    ) {
      ids.add(node.id)
    }
  }
  return [...ids].flatMap((id) => {
    const node = nodes[id]
    return node ? [node] : []
  })
}

function splitPoint(wall: WallNode, wallT: number): WallPlanPoint {
  if (wallT <= WALL_INTERSECTION_EPSILON) return wall.start
  if (wallT >= 1 - WALL_INTERSECTION_EPSILON) return wall.end
  const frame = getWallCurveFrameAt(wall, wallT)
  return [frame.point.x, frame.point.y]
}

function segmentCurveOffset(wall: WallNode, startT: number, endT: number) {
  const arc = getWallArcData(wall)
  if (!arc) return wall.curveOffset
  const angle = Math.abs(arc.delta) * (endT - startT)
  return arc.direction * arc.radius * (1 - Math.cos(angle / 2))
}

function remapAttachment(
  node: AnyNode,
  wall: WallNode,
  nextLocalX: number,
): Partial<AnyNode> | null {
  if (!(node.type === 'door' || node.type === 'window' || node.type === 'item')) return null
  const nextLength = wallLength(wall)
  const clampedX = Math.max(0, Math.min(nextLength, nextLocalX))
  return {
    parentId: wall.id,
    wallId: wall.id,
    position: [clampedX, node.position[1], node.position[2]],
    ...(node.type === 'item' ? { wallT: nextLength > 1e-6 ? clampedX / nextLength : 0 } : {}),
  } as Partial<AnyNode>
}

function planWallSplit(
  wall: WallNode,
  requests: WallSplitRequest[],
  nodes: Record<AnyNodeId, AnyNode>,
): PlannedWallSplit | null {
  const splitParameters = [...new Set(requests.map(({ wallT }) => wallT))]
    .filter((wallT) => wallT > WALL_INTERSECTION_EPSILON && wallT < 1 - WALL_INTERSECTION_EPSILON)
    .sort((left, right) => left - right)
  if (splitParameters.length === 0) return { create: [], update: [] }

  const parameters = [0, ...splitParameters, 1]
  const segments = parameters.slice(0, -1).map((startT, index) => {
    const endT = parameters[index + 1]!
    const { id: _id, parentId: _parentId, children: _children, ...properties } = wall
    return WallSchema.parse({
      ...properties,
      start: splitPoint(wall, startT),
      end: splitPoint(wall, endT),
      curveOffset: segmentCurveOffset(wall, startT, endT),
      children: [],
    })
  })

  const totalLength = wallLength(wall)
  const segmentChildren = segments.map(() => [] as AnyNodeId[])
  const updates: WallTopologyChanges['update'] = []
  for (const attachment of wallAttachments(wall, nodes)) {
    const span = attachmentSpan(attachment)
    if (!span) return null

    const segmentIndex = parameters.slice(0, -1).findIndex((startT, index) => {
      const endT = parameters[index + 1]!
      return span.min >= totalLength * startT - 1e-4 && span.max <= totalLength * endT + 1e-4
    })
    if (segmentIndex < 0) return null

    const segment = segments[segmentIndex]!
    const nextData = remapAttachment(
      attachment,
      segment,
      span.center - totalLength * parameters[segmentIndex]!,
    )
    if (!nextData) return null
    segmentChildren[segmentIndex]!.push(attachment.id)
    updates.push({ id: attachment.id, data: nextData })
  }

  return {
    create: segments.map((segment, index) =>
      WallSchema.parse({ ...segment, children: segmentChildren[index] }),
    ),
    update: updates,
  }
}

function emptyChanges(): WallTopologyChanges {
  return { create: [], update: [], delete: [] }
}

export function planWallSplitAtPoint(
  nodes: Record<AnyNodeId, AnyNode>,
  args: {
    levelId: AnyNodeId | null
    point: WallPlanPoint
    radius: number
    ignoreWallIds?: readonly string[]
  },
): WallPointSplitPlan | null {
  if (!args.levelId) return null
  const walls = wallsForLevel(nodes, args.levelId)
  const projection = nearestWallProjection(
    args.point,
    walls,
    args.radius,
    new Set(args.ignoreWallIds ?? []),
  )
  if (!projection) return null
  if (!projection.wall) return { point: projection.point, changes: emptyChanges() }

  const split = planWallSplit(
    projection.wall,
    [{ point: projection.point, wallT: projection.wallT }],
    nodes,
  )
  if (!split) return { point: projection.point, changes: emptyChanges() }

  return {
    point: projection.point,
    changes: {
      create: split.create.map((node) => ({ node, parentId: args.levelId ?? undefined })),
      update: split.update,
      delete: [projection.wall.id],
    },
  }
}

export function planWallInsertion(
  nodes: Record<AnyNodeId, AnyNode>,
  args: {
    levelId: AnyNodeId
    start: WallPlanPoint
    end: WallPlanPoint
    joinRadius: number
    wallDefaults?: Partial<WallNode>
  },
): WallInsertionPlan | null {
  const walls = wallsForLevel(nodes, args.levelId)
  const endpointRequests = new Map<string, WallSplitRequest[]>()
  const addRequest = (wall: WallNode, request: WallSplitRequest) => {
    const requests = endpointRequests.get(wall.id) ?? []
    if (
      !requests.some(({ wallT }) => Math.abs(wallT - request.wallT) <= WALL_INTERSECTION_EPSILON)
    ) {
      requests.push(request)
    }
    endpointRequests.set(wall.id, requests)
  }

  const endProjection = nearestWallProjection(args.end, walls, args.joinRadius, new Set())
  const resolvedEnd = endProjection?.point ?? args.end
  if (endProjection?.wall) {
    addRequest(endProjection.wall, { point: endProjection.point, wallT: endProjection.wallT })
  }

  const startProjection = nearestWallProjection(args.start, walls, args.joinRadius, new Set())
  const resolvedStart = startProjection?.point ?? args.start
  if (startProjection?.wall) {
    addRequest(startProjection.wall, {
      point: startProjection.point,
      wallT: startProjection.wallT,
    })
  }

  if (
    !isSegmentLongEnough(resolvedStart, resolvedEnd) ||
    pointsEqual(resolvedStart, resolvedEnd) ||
    wallSegmentsCoverSegment(resolvedStart, resolvedEnd, walls)
  ) {
    return null
  }

  const crossings = findWallSegmentIntersections(resolvedStart, resolvedEnd, walls)
    .filter(
      ({ draftT }) => draftT > WALL_INTERSECTION_EPSILON && draftT < 1 - WALL_INTERSECTION_EPSILON,
    )
    .sort((left, right) => left.draftT - right.draftT)
  for (const crossing of crossings) {
    if (
      crossing.wallT > WALL_INTERSECTION_EPSILON &&
      crossing.wallT < 1 - WALL_INTERSECTION_EPSILON
    ) {
      const wall = walls.find((candidate) => candidate.id === crossing.wallId)
      if (wall) addRequest(wall, { point: crossing.point, wallT: crossing.wallT })
    }
  }

  const splitPlans = new Map<string, PlannedWallSplit>()
  for (const [wallId, requests] of endpointRequests) {
    const wall = walls.find((candidate) => candidate.id === wallId)
    if (!wall) continue
    const split = planWallSplit(wall, requests, nodes)
    if (split) splitPlans.set(wallId, split)
  }

  const splitPoints: WallPlanPoint[] = []
  for (const crossing of crossings) {
    const doesNotNeedHostSplit =
      crossing.wallT <= WALL_INTERSECTION_EPSILON || crossing.wallT >= 1 - WALL_INTERSECTION_EPSILON
    if (!(doesNotNeedHostSplit || splitPlans.has(crossing.wallId))) continue
    if (!splitPoints.some((point) => pointsEqual(point, crossing.point))) {
      splitPoints.push(crossing.point)
    }
  }

  const existingWallCount = Object.values(nodes).filter((node) => node.type === 'wall').length
  const vertices = [resolvedStart, ...splitPoints, resolvedEnd]
  const insertedWalls = vertices.slice(0, -1).map((start, index) =>
    WallSchema.parse({
      ...(args.wallDefaults ?? {}),
      name: `Wall ${existingWallCount + index + 1}`,
      start,
      end: vertices[index + 1]!,
    }),
  )
  if (insertedWalls.length === 0) return null

  const replacementWalls = [...splitPlans.values()].flatMap(({ create }) => create)
  return {
    changes: {
      create: [...replacementWalls, ...insertedWalls].map((node) => ({
        node,
        parentId: args.levelId,
      })),
      update: [...splitPlans.values()].flatMap(({ update }) => update),
      delete: [...splitPlans.keys()] as AnyNodeId[],
    },
    insertedWalls,
    terminalWallId: insertedWalls.at(-1)!.id,
    resolvedStart,
    resolvedEnd,
  }
}
