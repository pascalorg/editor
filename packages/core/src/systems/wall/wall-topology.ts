import { GROUND_SUPPORT_ID } from '../../hooks/spatial-grid/support-host-id'
import { terrainSupportLift } from '../../lib/terrain-support'
import { type AnyNode, type AnyNodeId, type WallNode, WallNode as WallSchema } from '../../schema'
import {
  getWallAttachmentSpan,
  getWallAttachments,
  remapWallAttachment,
  segmentCurveOffset,
  wallLength,
  wallPointAt,
} from './wall-attachments'
import { isCurvedWall } from './wall-curve'
import {
  curvedSegmentIntersections,
  distanceSquared,
  joinCrossingAtNearbyWallEndpoint,
  nearestWallProjection,
  straightSegmentIntersection,
  type WallSegmentIntersection,
} from './wall-intersections'
import type { WallPlanPoint } from './wall-move'

const WALL_MIN_LENGTH = 0.01
const WALL_INTERSECTION_EPSILON = 1e-6

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

function isSegmentLongEnough(start: WallPlanPoint, end: WallPlanPoint) {
  return distanceSquared(start, end) >= WALL_MIN_LENGTH * WALL_MIN_LENGTH
}

function wallSegmentsCoverSegment(start: WallPlanPoint, end: WallPlanPoint, walls: WallNode[]) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= WALL_INTERSECTION_EPSILON * WALL_INTERSECTION_EPSILON) return false

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
  const parameterTolerance = WALL_INTERSECTION_EPSILON / length
  let coveredUntil = 0
  for (const [intervalStart, intervalEnd] of intervals) {
    if (intervalStart > coveredUntil + parameterTolerance) return false
    coveredUntil = Math.max(coveredUntil, intervalEnd)
    if (coveredUntil >= 1 - parameterTolerance) return true
  }
  return false
}

export function planWallSplitAtPoint(
  nodes: Record<AnyNodeId, AnyNode>,
  args: {
    levelId: AnyNodeId | null
    point: WallPlanPoint
    radius: number
    ignoreWallIds?: readonly string[]
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

  const split = splitWall(projection.wall, [projection.wallT], nodes)
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

function splitWall(
  wall: WallNode,
  splitParameters: number[],
  nodes: Record<AnyNodeId, AnyNode>,
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
  for (const attachment of getWallAttachments(wall, nodes)) {
    const span = getWallAttachmentSpan(attachment)
    if (!span) return null
    const segmentIndex = parameters.slice(0, -1).findIndex((startT, index) => {
      const endT = parameters[index + 1]!
      return span.min >= totalLength * startT - 1e-4 && span.max <= totalLength * endT + 1e-4
    })
    if (segmentIndex < 0) return null
    const segment = segments[segmentIndex]!
    const update = remapWallAttachment(
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
    const split = wall ? splitWall(wall, parameters, nodes) : null
    return split ? [[wallId, split] as const] : []
  })
  const replacementWalls = splitPlans.flatMap(([, split]) => split.create)
  const plan: WallInsertionPlan = {
    changes: {
      create: [...replacementWalls, ...insertedWalls].map((node) => ({
        node,
        parentId: args.levelId,
      })),
      update: splitPlans.flatMap(([, split]) => split.update),
      delete: splitPlans.map(([wallId]) => wallId as AnyNodeId),
    },
    insertedWalls,
    terminalWallId: insertedWalls.at(-1)!.id,
    resolvedStart,
    resolvedEnd,
  }
  return { ok: true, plan }
}
