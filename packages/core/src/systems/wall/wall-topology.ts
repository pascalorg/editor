import { GROUND_SUPPORT_ID } from '../../hooks/spatial-grid/support-host-id'
import { detectOpenWallEnds, type OpenWallEnd, wallEndJoinCandidates } from '../../lib/room-graph'
import { terrainSupportLift } from '../../lib/terrain-support'
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

export const WALL_MIN_LENGTH = 0.01
const WALL_SPLIT_ENDPOINT_EPSILON = 0.02
const WALL_INTERSECTION_EPSILON = 1e-6
const WALL_JOIN_ANGLE_TOLERANCE = (5 * Math.PI) / 180
const WALL_JOIN_CORNER_STEP = Math.PI / 4
const WALL_JOIN_CORNER_MOVE_FLOOR = 0.15
const WALL_JOIN_CORNER_LENGTH_RATIO = 0.03

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

export type WallTopologyRejection = {
  ok: false
  reason: 'covered-existing-wall' | 'segment-too-short'
}

export type WallInsertionResult = { ok: true; plan: WallInsertionPlan } | WallTopologyRejection

export type WallPointSplitPlan = {
  changes: WallTopologyChanges
  point: WallPlanPoint
}

export type WallPointSplitResult =
  | { ok: true; plan: WallPointSplitPlan }
  | { ok: false; reason: 'no-host' }

export type WallJoinResult =
  | { ok: true; plan: WallInsertionPlan }
  | {
      ok: false
      reason:
        | WallTopologyRejection['reason']
        | 'stale-end'
        | 'no-target'
        | 'attachment-outside-wall'
        | 'attachment-straddles-junction'
    }

type WallSegmentIntersection = {
  wallId: WallNode['id']
  point: WallPlanPoint
  draftT: number
  wallT: number
}

function distanceSquared(a: WallPlanPoint, b: WallPlanPoint) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

function isSegmentLongEnough(start: WallPlanPoint, end: WallPlanPoint) {
  return distanceSquared(start, end) >= WALL_MIN_LENGTH * WALL_MIN_LENGTH
}

/** Where straight walls run along `start→end`, as sorted parameter intervals of it. */
function collinearWallIntervals(
  start: WallPlanPoint,
  end: WallPlanPoint,
  walls: WallNode[],
): { intervals: Array<[number, number]>; length: number } | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= WALL_INTERSECTION_EPSILON * WALL_INTERSECTION_EPSILON) return null

  const length = Math.sqrt(lengthSquared)
  const intervals: Array<[number, number]> = []
  for (const wall of walls) {
    if (Math.abs(wall.curveOffset ?? 0) > WALL_INTERSECTION_EPSILON) continue
    const startDistance =
      Math.abs((wall.start[0] - start[0]) * dz - (wall.start[1] - start[1]) * dx) / length
    const endDistance =
      Math.abs((wall.end[0] - start[0]) * dz - (wall.end[1] - start[1]) * dx) / length
    if (startDistance > WALL_INTERSECTION_EPSILON || endDistance > WALL_INTERSECTION_EPSILON) {
      continue
    }

    const wallStartT =
      ((wall.start[0] - start[0]) * dx + (wall.start[1] - start[1]) * dz) / lengthSquared
    const wallEndT = ((wall.end[0] - start[0]) * dx + (wall.end[1] - start[1]) * dz) / lengthSquared
    const intervalStart = Math.max(0, Math.min(wallStartT, wallEndT))
    const intervalEnd = Math.min(1, Math.max(wallStartT, wallEndT))
    if (intervalEnd >= intervalStart) intervals.push([intervalStart, intervalEnd])
  }
  intervals.sort((left, right) => left[0] - right[0])
  return { intervals, length }
}

function wallSegmentsCoverSegment(start: WallPlanPoint, end: WallPlanPoint, walls: WallNode[]) {
  const collinear = collinearWallIntervals(start, end, walls)
  if (!collinear) return false
  const parameterTolerance = WALL_INTERSECTION_EPSILON / collinear.length
  let coveredUntil = 0
  for (const [intervalStart, intervalEnd] of collinear.intervals) {
    if (intervalStart > coveredUntil + parameterTolerance) return false
    coveredUntil = Math.max(coveredUntil, intervalEnd)
    if (coveredUntil >= 1 - parameterTolerance) return true
  }
  return false
}

/**
 * The parts of `start→end` that no straight wall already runs along, in order.
 * A side drawn along an existing wall and past its end yields the overhang
 * only, so the existing wall is reused instead of doubled. Gaps too short to
 * be a wall are treated as covered.
 */
export function uncoveredWallSegments(
  start: WallPlanPoint,
  end: WallPlanPoint,
  walls: WallNode[],
): Array<[WallPlanPoint, WallPlanPoint]> {
  const collinear = collinearWallIntervals(start, end, walls)
  if (!collinear) return []
  const minimumGap = WALL_MIN_LENGTH / collinear.length
  const at = (t: number): WallPlanPoint => [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ]
  const segments: Array<[WallPlanPoint, WallPlanPoint]> = []
  let coveredUntil = 0
  for (const [intervalStart, intervalEnd] of collinear.intervals) {
    if (intervalStart > coveredUntil + minimumGap)
      segments.push([at(coveredUntil), at(intervalStart)])
    coveredUntil = Math.max(coveredUntil, intervalEnd)
  }
  if (coveredUntil < 1 - minimumGap) segments.push([at(coveredUntil), end])
  return segments
}

function projectPointOntoWallCenterline(
  point: WallPlanPoint,
  wall: WallNode,
): { point: WallPlanPoint; wallT: number } | null {
  if (isCurvedWall(wall)) {
    const arc = getWallArcData(wall)
    if (!arc) return null
    const pointAngle = Math.atan2(point[1] - arc.center.y, point[0] - arc.center.x)
    let directedAngle = (pointAngle - arc.startAngle) * arc.direction
    while (directedAngle < 0) directedAngle += Math.PI * 2
    const wallT = directedAngle / Math.abs(arc.delta)
    if (wallT <= 0 || wallT >= 1) return null
    return { point: wallPointAt(wall, wallT), wallT }
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

function nearestWallProjection(
  point: WallPlanPoint,
  walls: WallNode[],
  radius: number,
  ignoreWallIds: ReadonlySet<string> = new Set(),
) {
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

export function planWallSplitAtPoint(
  nodes: Record<AnyNodeId, AnyNode>,
  args: {
    levelId: AnyNodeId | null
    point: WallPlanPoint
    radius: number
    ignoreWallIds?: readonly string[]
    mintId?: () => string
  },
): WallPointSplitResult {
  if (!args.levelId) return { ok: false, reason: 'no-host' }
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === args.levelId,
  )
  const projection = nearestWallProjection(
    args.point,
    walls,
    args.radius,
    new Set(args.ignoreWallIds ?? []),
  )
  if (!projection) return { ok: false, reason: 'no-host' }
  if (!projection.wall) {
    return {
      ok: true,
      plan: { point: projection.point, changes: { create: [], update: [], delete: [] } },
    }
  }

  const split = splitWall(projection.wall, [projection.wallT], nodes, args.mintId)
  if (!split) {
    return {
      ok: true,
      plan: { point: projection.point, changes: { create: [], update: [], delete: [] } },
    }
  }
  return {
    ok: true,
    plan: {
      point: projection.point,
      changes: {
        create: split.create.map((node) => ({ node, parentId: args.levelId ?? undefined })),
        update: split.update,
        delete: [projection.wall.id],
      },
    },
  }
}

function straightSegmentIntersection(
  start: WallPlanPoint,
  end: WallPlanPoint,
  wall: WallNode,
): WallSegmentIntersection | null {
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
  if (draftT <= 0 || draftT >= 1 || wallT < 0 || wallT > 1) return null

  return {
    wallId: wall.id,
    point: [start[0] + draftT * rx, start[1] + draftT * rz],
    draftT,
    wallT,
  }
}

function curvedSegmentIntersections(
  start: WallPlanPoint,
  end: WallPlanPoint,
  wall: WallNode,
): WallSegmentIntersection[] {
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
  const results: WallSegmentIntersection[] = []
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
      wallId: wall.id,
      point,
      draftT: Math.max(0, Math.min(1, rawDraftT)),
      wallT: Math.max(0, Math.min(1, rawWallT)),
    })
  }
  return results
}

function joinCrossingAtNearbyWallEndpoint(
  crossing: WallSegmentIntersection,
  walls: WallNode[],
): WallSegmentIntersection {
  const wall = walls.find((candidate) => candidate.id === crossing.wallId)
  if (!wall) return crossing
  const endpointIndex = ([wall.start, wall.end] as WallPlanPoint[]).findIndex(
    (endpoint) =>
      distanceSquared(crossing.point, endpoint) <=
      WALL_SPLIT_ENDPOINT_EPSILON * WALL_SPLIT_ENDPOINT_EPSILON,
  )
  if (endpointIndex < 0) return crossing
  const endpoint = endpointIndex === 0 ? wall.start : wall.end
  return { ...crossing, point: [endpoint[0], endpoint[1]], wallT: endpointIndex }
}

function wallLength(wall: WallNode) {
  return isCurvedWall(wall)
    ? getWallCurveLength(wall)
    : Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function wallPointAt(wall: WallNode, wallT: number): WallPlanPoint {
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

function splitWall(
  wall: WallNode,
  splitParameters: number[],
  nodes: Record<AnyNodeId, AnyNode>,
  mintId?: () => string,
): { create: WallNode[]; update: WallTopologyChanges['update'] } | null {
  const parameters = [
    0,
    ...splitParameters
      .filter((wallT) => wallT > WALL_INTERSECTION_EPSILON && wallT < 1 - WALL_INTERSECTION_EPSILON)
      .sort((left, right) => left - right),
    1,
  ]
  const { id: _id, parentId: _parentId, children: _children, ...properties } = wall
  const parsedSegments = parameters.slice(0, -1).map((startT, index) => {
    const endT = parameters[index + 1]!
    return WallSchema.parse({
      ...properties,
      id: mintId?.(),
      start: wallPointAt(wall, startT),
      end: wallPointAt(wall, endT),
      curveOffset: segmentCurveOffset(wall, startT, endT),
      children: [],
    })
  })
  const originalElevation =
    wall.supportSlabId === GROUND_SUPPORT_ID && wall.parentId
      ? (terrainSupportLift(nodes, wall.parentId, wall.start[0], wall.start[1]) ?? 0) +
        (wall.supportOffset ?? 0)
      : null
  const segments = parsedSegments.map((segment) => {
    if (originalElevation === null || !wall.parentId) return segment
    const terrainElevation =
      terrainSupportLift(nodes, wall.parentId, segment.start[0], segment.start[1]) ?? 0
    const supportOffset = originalElevation - terrainElevation
    return {
      ...segment,
      supportOffset: Math.abs(supportOffset) > 1e-6 ? supportOffset : undefined,
    }
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
    const update = remapAttachment(
      attachment,
      segment,
      span.center - totalLength * parameters[segmentIndex]!,
    )
    if (!update) return null
    segmentChildren[segmentIndex]!.push(attachment.id)
    updates.push({ id: attachment.id, data: update })
  }

  return {
    create: segments.map((segment, index) =>
      WallSchema.parse({ ...segment, children: segmentChildren[index] }),
    ),
    update: updates,
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
    mintId?: () => string
  },
): WallInsertionResult {
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === args.levelId,
  )
  const endProjection = nearestWallProjection(args.end, walls, args.joinRadius)
  const startProjection = nearestWallProjection(args.start, walls, args.joinRadius)
  const resolvedStart = startProjection?.point ?? args.start
  const resolvedEnd = endProjection?.point ?? args.end
  if (wallSegmentsCoverSegment(resolvedStart, resolvedEnd, walls)) {
    return { ok: false, reason: 'covered-existing-wall' }
  }
  const crossings = walls
    .flatMap((wall) =>
      isCurvedWall(wall)
        ? curvedSegmentIntersections(resolvedStart, resolvedEnd, wall)
        : [straightSegmentIntersection(resolvedStart, resolvedEnd, wall)].filter(
            (crossing): crossing is WallSegmentIntersection => crossing !== null,
          ),
    )
    .map((crossing) => joinCrossingAtNearbyWallEndpoint(crossing, walls))
    .filter(
      ({ draftT }) => draftT > WALL_INTERSECTION_EPSILON && draftT < 1 - WALL_INTERSECTION_EPSILON,
    )
    .sort((left, right) => left.draftT - right.draftT)
  const splitPoints = crossings.reduce<WallPlanPoint[]>((points, crossing) => {
    if (!points.some((point) => distanceSquared(point, crossing.point) <= 1e-12)) {
      points.push(crossing.point)
    }
    return points
  }, [])
  const vertices = [resolvedStart, ...splitPoints, resolvedEnd]

  if (
    vertices.some(
      (start, index) =>
        index < vertices.length - 1 && !isSegmentLongEnough(start, vertices[index + 1]!),
    )
  ) {
    return { ok: false, reason: 'segment-too-short' }
  }

  const wallProperties = { ...(args.wallDefaults ?? {}) }
  delete wallProperties.id
  delete wallProperties.parentId
  delete wallProperties.children
  const existingWallCount = Object.values(nodes).filter((node) => node.type === 'wall').length
  const insertedWalls = vertices.slice(0, -1).map((start, index) =>
    WallSchema.parse({
      ...wallProperties,
      id: args.mintId?.(),
      name: `Wall ${existingWallCount + index + 1}`,
      start,
      end: vertices[index + 1]!,
    }),
  )
  const splitWalls = new Map<WallNode['id'], number[]>()
  const addSplitParameter = (wallId: WallNode['id'], wallT: number) => {
    const parameters = splitWalls.get(wallId) ?? []
    if (!parameters.some((candidate) => Math.abs(candidate - wallT) <= WALL_INTERSECTION_EPSILON)) {
      parameters.push(wallT)
    }
    splitWalls.set(wallId, parameters)
  }
  for (const projection of [startProjection, endProjection]) {
    if (projection?.wall) {
      addSplitParameter(projection.wall.id, projection.wallT)
    }
  }
  for (const crossing of crossings) {
    if (
      crossing.wallT <= WALL_INTERSECTION_EPSILON ||
      crossing.wallT >= 1 - WALL_INTERSECTION_EPSILON
    ) {
      continue
    }
    addSplitParameter(crossing.wallId, crossing.wallT)
  }
  const splitPlans = [...splitWalls].flatMap(([wallId, parameters]) => {
    const wall = walls.find((candidate) => candidate.id === wallId)
    const split = wall ? splitWall(wall, parameters, nodes, args.mintId) : null
    return split ? [[wallId, split] as const] : []
  })
  const replacementWalls = splitPlans.flatMap(([, split]) => split.create)
  // Rooms name the walls that enclose them; a split wall's replacements take
  // its place, as they do for an explicit division or a merge.
  const replacements = new Map(
    splitPlans.map(([wallId, split]) => [wallId, split.create.map((wall) => wall.id)] as const),
  )
  const zoneUpdates = Object.values(nodes).flatMap((node) =>
    node.type === 'zone' &&
    node.parentId === args.levelId &&
    node.boundaryWallIds.some((id) => replacements.has(id))
      ? [
          {
            id: node.id,
            data: {
              boundaryWallIds: node.boundaryWallIds.flatMap((id) => replacements.get(id) ?? [id]),
            },
          },
        ]
      : [],
  )
  const plan: WallInsertionPlan = {
    changes: {
      create: [...replacementWalls, ...insertedWalls].map((node) => ({
        node,
        parentId: args.levelId,
      })),
      update: [...splitPlans.flatMap(([, split]) => split.update), ...zoneUpdates],
      delete: splitPlans.map(([wallId]) => wallId as AnyNodeId),
    },
    insertedWalls,
    terminalWallId: insertedWalls.at(-1)!.id,
    resolvedStart,
    resolvedEnd,
  }
  return { ok: true, plan }
}

function distanceToLine(point: WallPlanPoint, a: WallPlanPoint, b: WallPlanPoint) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  return Math.abs((point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0])) / length
}

/** Where two straight walls' lines meet, if they meet at a real angle, and where along `target`. */
function lineMeeting(wall: WallNode, target: WallNode) {
  const r = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
  const u = [target.end[0] - target.start[0], target.end[1] - target.start[1]]
  const denominator = r[0]! * u[1]! - r[1]! * u[0]!
  if (Math.abs(denominator) < 0.5 * Math.hypot(r[0]!, r[1]!) * Math.hypot(u[0]!, u[1]!)) return null
  const qp = [target.start[0] - wall.start[0], target.start[1] - wall.start[1]]
  const t = (qp[0]! * u[1]! - qp[1]! * u[0]!) / denominator
  return {
    point: [wall.start[0] + t * r[0]!, wall.start[1] + t * r[1]!] as WallPlanPoint,
    targetT: (qp[0]! * r[1]! - qp[1]! * r[0]!) / denominator,
  }
}

function planWallEndJoin(
  nodes: Readonly<Record<string, AnyNode>>,
  openEnd: OpenWallEnd,
  cornerPoint?: WallPlanPoint,
): WallJoinResult {
  const wall = nodes[openEnd.wallId]
  if (
    wall?.type !== 'wall' ||
    !wall.parentId ||
    distanceSquared(wall[openEnd.end], openEnd.point) > 1e-12
  )
    return { ok: false, reason: 'stale-end' }
  const candidate = openEnd.candidate
  const target = candidate ? nodes[candidate.wallId] : undefined
  if (
    !candidate ||
    target?.type !== 'wall' ||
    target.id === wall.id ||
    target.parentId !== wall.parentId
  )
    return { ok: false, reason: 'no-target' }
  const straight = !isCurvedWall(wall) && !isCurvedWall(target)
  // Where the wall, run on or cut back along its own axis, meets the target's line: joining
  // there never tilts it.
  const meet = straight ? lineMeeting(wall, target) : null
  const near = (a: WallPlanPoint, b: WallPlanPoint) => distanceSquared(a, b) <= 0.35 ** 2
  let point = candidate.point
  // The target's open end slides along its own axis to the meeting point too.
  let targetEnd: 'start' | 'end' | null = null
  if (candidate.kind === 'endpoint') {
    const endpoint = [target.start, target.end].some((end) => distanceSquared(end, point) <= 1e-12)
      ? point
      : wallEndJoinCandidates(nodes, wall.parentId).find(
          (end) =>
            end.wallId === wall.id &&
            end.end === openEnd.end &&
            end.candidate?.wallId === target.id,
        )?.candidate?.point
    const key = (['start', 'end'] as const).find(
      (end) => endpoint && distanceSquared(target[end], endpoint) <= 1e-12,
    )
    if (!key) return { ok: false, reason: 'no-target' }
    point = target[key]
    const onOwnAxis = straight && distanceToLine(point, wall.start, wall.end) <= 1e-4
    if (!onOwnAxis && meet && near(meet.point, openEnd.point) && near(meet.point, point)) {
      const shared = Object.values(nodes).some(
        (node) =>
          node.type === 'wall' &&
          node.id !== target.id &&
          node.id !== wall.id &&
          node.parentId === wall.parentId &&
          (distanceSquared(node.start, point) <= 1e-12 ||
            distanceSquared(node.end, point) <= 1e-12),
      )
      if (!shared) targetEnd = key
      if (!shared || (meet.targetT > 0 && meet.targetT < 1)) point = meet.point
    }
  } else if (meet && meet.targetT > 0 && meet.targetT < 1 && near(meet.point, openEnd.point)) {
    point = meet.point
  } else {
    const projection = nearestWallProjection(
      point,
      [target],
      isCurvedWall(target) ? 0.04 : WALL_INTERSECTION_EPSILON,
    )
    if (!projection) return { ok: false, reason: 'no-target' }
    point = projection.point
  }
  // A squared corner keeps the straight join's shape: the target's open end, if it slides, slides
  // to the corner too.
  if (cornerPoint) point = cornerPoint
  if (!near(point, openEnd.point)) return { ok: false, reason: 'no-target' }
  const nextWall = { ...wall, [openEnd.end]: point }
  const nextTarget = targetEnd ? { ...target, [targetEnd]: point } : null
  if (
    !isSegmentLongEnough(nextWall.start, nextWall.end) ||
    (nextTarget && !isSegmentLongEnough(nextTarget.start, nextTarget.end))
  )
    return { ok: false, reason: 'segment-too-short' }
  const nextLength = wallLength(nextWall)
  const adjusted = { ...nodes } as Record<AnyNodeId, AnyNode>
  const attachmentUpdates: WallTopologyChanges['update'] = []
  const remapAttachments = (before: WallNode, after: WallNode) => {
    const length = wallLength(after)
    const dx = (after.end[0] - after.start[0]) / length
    const dz = (after.end[1] - after.start[1]) / length
    const oldLength = wallLength(before)
    for (const attachment of wallAttachments(before, adjusted)) {
      const span = attachmentSpan(attachment)
      if (!span) return false
      const oldPoint = getWallCurveFrameAt(before, span.center / oldLength).point
      const projection = isCurvedWall(after)
        ? projectPointOntoWallCenterline([oldPoint.x, oldPoint.y], after)
        : null
      if (isCurvedWall(after) && !projection) return false
      const center = projection
        ? projection.wallT * length
        : (oldPoint.x - after.start[0]) * dx + (oldPoint.y - after.start[1]) * dz
      if (
        center - (span.center - span.min) < -1e-4 ||
        center + (span.max - span.center) > length + 1e-4
      )
        return false
      const data = remapAttachment(attachment, after, center)!
      adjusted[attachment.id] = { ...attachment, ...data } as AnyNode
      attachmentUpdates.push({ id: attachment.id, data })
    }
    return true
  }
  if (!remapAttachments(wall, nextWall) || (nextTarget && !remapAttachments(target, nextTarget)))
    return { ok: false, reason: 'attachment-outside-wall' }
  if (nextTarget) adjusted[target.id] = nextTarget
  delete adjusted[wall.id]
  let insertion: WallInsertionResult
  if (isCurvedWall(wall)) {
    const split =
      candidate.kind === 'body'
        ? planWallSplitAtPoint(adjusted, {
            levelId: wall.parentId as AnyNodeId,
            point,
            radius: WALL_INTERSECTION_EPSILON,
          })
        : {
            ok: true as const,
            plan: { point, changes: { create: [], update: [], delete: [] } as WallTopologyChanges },
          }
    if (!split.ok) return { ok: false, reason: 'no-target' }
    const replacementIds = split.plan.changes.create.map(({ node }) => node.id as WallNode['id'])
    if (split.plan.changes.delete.includes(target.id))
      for (const node of Object.values(nodes)) {
        if (node.type === 'zone' && node.boundaryWallIds.includes(target.id))
          split.plan.changes.update.push({
            id: node.id,
            data: {
              boundaryWallIds: node.boundaryWallIds.flatMap((id) =>
                id === target.id ? replacementIds : [id],
              ),
            },
          })
      }
    insertion = {
      ok: true,
      plan: {
        changes: split.plan.changes,
        insertedWalls: [nextWall],
        terminalWallId: wall.id,
        resolvedStart: nextWall.start,
        resolvedEnd: nextWall.end,
      },
    }
  } else
    insertion = planWallInsertion(adjusted, {
      levelId: wall.parentId as AnyNodeId,
      start: nextWall.start,
      end: nextWall.end,
      joinRadius: WALL_INTERSECTION_EPSILON,
      wallDefaults: nextWall,
    })
  if (!insertion.ok) return insertion
  const insertedIds = new Set(insertion.plan.insertedWalls.map((segment) => segment.id))
  let replacements: WallNode[]
  let updates = attachmentUpdates
  if (insertion.plan.insertedWalls.length === 1) {
    replacements = [nextWall]
  } else {
    const parameters = insertion.plan.insertedWalls
      .slice(0, -1)
      .map(
        (segment) =>
          Math.hypot(segment.end[0] - nextWall.start[0], segment.end[1] - nextWall.start[1]) /
          nextLength,
      )
    let index = 0
    const split = splitWall(nextWall, parameters, adjusted, () =>
      index++ === 0 ? wall.id : insertion.plan.insertedWalls[index - 1]!.id,
    )
    if (!split) return { ok: false, reason: 'attachment-straddles-junction' }
    replacements = split.create.map((segment) => ({ ...segment, parentId: wall.parentId }))
    updates = split.update
  }
  const zoneUpdates: WallTopologyChanges['update'] =
    replacements.length > 1
      ? Object.values(nodes).flatMap((node) =>
          node.type === 'zone' && node.boundaryWallIds.includes(wall.id)
            ? [
                {
                  id: node.id,
                  data: {
                    boundaryWallIds: (
                      (
                        insertion.plan.changes.update.find((update) => update.id === node.id)
                          ?.data as Partial<typeof node>
                      )?.boundaryWallIds ?? node.boundaryWallIds
                    ).flatMap((id) =>
                      id === wall.id ? replacements.map((segment) => segment.id) : [id],
                    ),
                  },
                },
              ]
            : [],
        )
      : []
  const mergedUpdates = new Map<AnyNodeId, Partial<AnyNode>>()
  for (const update of [
    ...(nextTarget && targetEnd && !insertion.plan.changes.delete.includes(target.id)
      ? [{ id: target.id, data: { [targetEnd]: point } }]
      : []),
    ...insertion.plan.changes.update,
    ...zoneUpdates,
    ...updates,
    { id: wall.id, data: replacements[0]! },
  ])
    mergedUpdates.set(update.id, {
      ...mergedUpdates.get(update.id),
      ...update.data,
    } as Partial<AnyNode>)
  return {
    ok: true,
    plan: {
      changes: {
        create: [
          ...insertion.plan.changes.create.filter(
            ({ node }) => !insertedIds.has(node.id as WallNode['id']),
          ),
          ...replacements.slice(1).map((node) => ({ node, parentId: wall.parentId as AnyNodeId })),
        ],
        update: [...mergedUpdates].map(([id, data]) => ({ id, data })),
        delete: insertion.plan.changes.delete,
      },
      insertedWalls: replacements,
      terminalWallId: replacements.at(-1)!.id,
      resolvedStart: nextWall.start,
      resolvedEnd: nextWall.end,
    },
  }
}

/**
 * Where `line` meets a wall turning about `pivot` once their corner, now at `through`, snaps to the
 * nearest 45° step. Null when it is already exact, more than the tolerance off, or the meeting
 * leaves `line`'s segment on a side that `lineEnd` (the end of `line` that may slide) cannot reach.
 */
function squaredCorner(
  pivot: WallPlanPoint,
  through: WallPlanPoint,
  line: WallNode,
  lineEnd: 'start' | 'end' | null,
): WallPlanPoint | null {
  const ux = line.end[0] - line.start[0]
  const uz = line.end[1] - line.start[1]
  const rx = through[0] - pivot[0]
  const rz = through[1] - pivot[1]
  const angle = Math.atan2(ux * rz - uz * rx, ux * rx + uz * rz)
  const exactAngle = Math.round(angle / WALL_JOIN_CORNER_STEP) * WALL_JOIN_CORNER_STEP
  if (
    Math.abs(Math.sin(exactAngle)) < WALL_INTERSECTION_EPSILON ||
    Math.abs(angle - exactAngle) < WALL_INTERSECTION_EPSILON ||
    Math.abs(angle - exactAngle) > WALL_JOIN_ANGLE_TOLERANCE + 1e-12
  )
    return null
  const lineLength = Math.hypot(ux, uz)
  const dx = (ux * Math.cos(exactAngle) - uz * Math.sin(exactAngle)) / lineLength
  const dz = (ux * Math.sin(exactAngle) + uz * Math.cos(exactAngle)) / lineLength
  const denominator = dx * uz - dz * ux
  const qx = line.start[0] - pivot[0]
  const qz = line.start[1] - pivot[1]
  const reach = (qx * uz - qz * ux) / denominator
  const lineT = (qx * dz - qz * dx) / denominator
  if (reach <= WALL_MIN_LENGTH) return null
  if (lineEnd === null ? lineT < 0 || lineT > 1 : lineEnd === 'end' ? lineT <= 0 : lineT >= 1)
    return null
  return [pivot[0] + reach * dx, pivot[1] + reach * dz]
}

const otherEnd = (end: 'start' | 'end') => (end === 'start' ? 'end' : 'start')

/** Repair one reference endpoint, including host splits and opening rehosting, in one scene batch. */
export function planJoinOpenWallEnd(
  nodes: Readonly<Record<string, AnyNode>>,
  openEnd: OpenWallEnd,
): WallJoinResult {
  const straight = planWallEndJoin(nodes, openEnd)
  if (!straight.ok) return straight
  const wall = nodes[openEnd.wallId] as WallNode
  const target = nodes[openEnd.candidate!.wallId] as WallNode
  if (isCurvedWall(wall) || isCurvedWall(target)) return straight
  const fixedEnd = otherEnd(openEnd.end)
  const point = openEnd.end === 'start' ? straight.plan.resolvedStart : straight.plan.resolvedEnd
  // An L near miss: the straight join slid the target's open end onto the corner as well.
  const slid = straight.plan.changes.update.find(({ id }) => id === target.id)?.data as
    | Partial<WallNode>
    | undefined
  const targetEnd =
    (['start', 'end'] as const).find((end) => {
      const moved = slid?.[end]
      return moved !== undefined && distanceSquared(moved, point) <= 1e-12
    }) ?? null
  // Square by turning one wall about its anchored end. In an L either wall may turn; the one that
  // moves the corner least wins (then the lower id), so both ends of the gap plan the same join.
  const options = [
    { turned: wall, corner: squaredCorner(wall[fixedEnd], point, target, targetEnd) },
    ...(targetEnd
      ? [
          {
            turned: target,
            corner: squaredCorner(target[otherEnd(targetEnd)], point, wall, openEnd.end),
          },
        ]
      : []),
  ]
    .flatMap(({ turned, corner }) => {
      if (!corner) return []
      const move = distanceSquared(corner, point)
      const maxMove = Math.max(
        WALL_JOIN_CORNER_MOVE_FLOOR,
        WALL_JOIN_CORNER_LENGTH_RATIO * wallLength(turned),
      )
      return move <= maxMove ** 2 ? [{ turned, corner, move }] : []
    })
    .sort((a, b) =>
      Math.abs(a.move - b.move) > 1e-9 ? a.move - b.move : a.turned.id.localeCompare(b.turned.id),
    )
  for (const { corner } of options) {
    const squared = planWallEndJoin(nodes, openEnd, corner)
    if (!squared.ok || squared.plan.insertedWalls.length !== 1) continue
    const joined = squared.plan.insertedWalls[0]!
    // Only the open ends move: anchored junctions and every other wall keep their geometry.
    if (
      distanceSquared(joined[fixedEnd], wall[fixedEnd]) > 1e-12 ||
      distanceSquared(joined[openEnd.end], corner) > 1e-12 ||
      squared.plan.changes.delete.some((id) => id !== target.id) ||
      squared.plan.changes.update.some(({ id, data }) => {
        if (id === wall.id || nodes[id]?.type !== 'wall') return false
        const moved = data as Partial<WallNode>
        if (!(moved.start || moved.end)) return false
        return !(
          id === target.id &&
          targetEnd &&
          !moved[otherEnd(targetEnd)] &&
          distanceSquared(moved[targetEnd]!, corner) <= 1e-12
        )
      })
    )
      continue
    return squared
  }
  return straight
}

/**
 * The level's open wall ends, each candidate moved to where Join walls will put the end, so a
 * preview draws the join it makes. `nodes` must hold what the walls host: an opening can turn
 * a squared corner back into a straight join. Room detection (room-graph) stays planner-free.
 */
export function findOpenWallEnds(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
): OpenWallEnd[] {
  return detectOpenWallEnds(nodes, levelId).map((end) => {
    if (!end.candidate) return end
    const result = planJoinOpenWallEnd(nodes, end)
    if (!result.ok) return end
    const point = end.end === 'start' ? result.plan.resolvedStart : result.plan.resolvedEnd
    return { ...end, candidate: { ...end.candidate, point } }
  })
}

/** Fold drop-time connections into the move's atomic batch, including linked moved walls. */
export function planWallEndRejoins(
  nodes: Readonly<Record<string, AnyNode>>,
  wallIds: readonly string[],
  radius: number,
  changes: WallTopologyChanges,
): WallTopologyChanges {
  const draft = { ...nodes } as Record<AnyNodeId, AnyNode>
  const creates = new Map<AnyNodeId, WallTopologyChanges['create'][number]>()
  const updates = new Map<AnyNodeId, Partial<AnyNode>>()
  const deletes = new Set<AnyNodeId>()
  const fold = (patch: WallTopologyChanges) => {
    for (const id of patch.delete) {
      delete draft[id]
      updates.delete(id)
      if (!creates.delete(id)) deletes.add(id)
    }
    for (const entry of patch.create) {
      creates.set(entry.node.id, entry)
      draft[entry.node.id] = {
        ...entry.node,
        parentId: entry.parentId ?? entry.node.parentId,
      } as AnyNode
    }
    for (const { id, data } of patch.update) {
      if (!draft[id]) continue
      draft[id] = { ...draft[id], ...data } as AnyNode
      const created = creates.get(id)
      if (created) creates.set(id, { ...created, node: draft[id] })
      else updates.set(id, { ...updates.get(id), ...data } as Partial<AnyNode>)
    }
  }
  fold(changes)
  for (const wallId of wallIds)
    for (const end of ['start', 'end'] as const) {
      const wall = draft[wallId as AnyNodeId]
      const original = nodes[wallId]
      if (wall?.type !== 'wall' || !wall.parentId) continue
      // A linked wall's far end stays put; the drop only connects ends it moved.
      if (original?.type === 'wall' && distanceSquared(original[end], wall[end]) <= 1e-12) continue
      const openEnd = wallEndJoinCandidates(draft, wall.parentId).find(
        (entry) => entry.wallId === wallId && entry.end === end,
      )
      if (!openEnd?.candidate || openEnd.reason === 'parallel') continue
      const distance = distanceSquared(openEnd.point, openEnd.candidate.point)
      if (distance > radius ** 2 || (distance < 1e-12 && openEnd.candidate.kind === 'endpoint'))
        continue
      const result = planJoinOpenWallEnd(draft, openEnd)
      if (result.ok) fold(result.plan.changes)
    }
  return {
    create: [...creates.values()],
    update: [...updates].map(([id, data]) => ({ id, data })),
    delete: [...deletes],
  }
}
