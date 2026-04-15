import { type AnyNodeId, useScene, type WallNode, WallNode as WallSchema } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { sfxEmitter } from '../../../lib/sfx-bus'

export type WallPlanPoint = [number, number]

export const WALL_GRID_STEP = 0.5
export const WALL_JOIN_SNAP_RADIUS = 0.35
export const WALL_MIN_LENGTH = 0.01

type WallSplitIntersection = {
  wallId: WallNode['id']
  point: WallPlanPoint
}

function distanceSquared(a: WallPlanPoint, b: WallPlanPoint): number {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

function snapScalarToGrid(value: number, step = WALL_GRID_STEP): number {
  return Math.round(value / step) * step
}

export function snapPointToGrid(point: WallPlanPoint, step = WALL_GRID_STEP): WallPlanPoint {
  return [snapScalarToGrid(point[0], step), snapScalarToGrid(point[1], step)]
}

export function snapPointTo45Degrees(start: WallPlanPoint, cursor: WallPlanPoint): WallPlanPoint {
  const dx = cursor[0] - start[0]
  const dz = cursor[1] - start[1]
  const angle = Math.atan2(dz, dx)
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
  const distance = Math.sqrt(dx * dx + dz * dz)

  return snapPointToGrid([
    start[0] + Math.cos(snappedAngle) * distance,
    start[1] + Math.sin(snappedAngle) * distance,
  ])
}

function projectPointOntoWall(point: WallPlanPoint, wall: WallNode): WallPlanPoint | null {
  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) {
    return null
  }

  const t = ((point[0] - x1) * dx + (point[1] - z1) * dz) / lengthSquared
  if (t <= 0 || t >= 1) {
    return null
  }

  return [x1 + dx * t, z1 + dz * t]
}

function splitWallAtPoint(wall: WallNode, splitPoint: WallPlanPoint): [WallNode, WallNode] {
  const { id: _id, parentId: _parentId, children, ...rest } = wall

  const first = WallSchema.parse({
    ...rest,
    start: wall.start,
    end: splitPoint,
    children: children ?? [],
  })
  const second = WallSchema.parse({
    ...rest,
    start: splitPoint,
    end: wall.end,
    children: children ?? [],
  })

  return [first, second]
}

function pointsEqual(a: WallPlanPoint, b: WallPlanPoint, tolerance = 1e-6): boolean {
  return distanceSquared(a, b) <= tolerance * tolerance
}

function findWallIntersection(
  point: WallPlanPoint,
  walls: WallNode[],
  ignoreWallIds?: string[],
): WallSplitIntersection | null {
  const ignore = new Set(ignoreWallIds ?? [])
  let best: WallSplitIntersection | null = null
  let bestDistanceSquared = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    if (ignore.has(wall.id)) continue

    const projected = projectPointOntoWall(point, wall)
    if (!projected) continue

    const candidateDistanceSquared = distanceSquared(point, projected)
    if (
      candidateDistanceSquared > WALL_JOIN_SNAP_RADIUS * WALL_JOIN_SNAP_RADIUS ||
      candidateDistanceSquared >= bestDistanceSquared
    ) {
      continue
    }

    best = { wallId: wall.id, point: projected }
    bestDistanceSquared = candidateDistanceSquared
  }

  return best
}

function wallHasAttachments(wall: WallNode, nodes: ReturnType<typeof useScene.getState>['nodes']) {
  if ((wall.children?.length ?? 0) > 0) {
    return true
  }

  return Object.values(nodes).some((node) => {
    if (!node) return false
    if ('parentId' in node && node.parentId === wall.id) return true
    if ('wallId' in node && typeof node.wallId === 'string' && node.wallId === wall.id) return true
    return false
  })
}

function splitWallIfNeeded(
  intersection: WallSplitIntersection | null,
  walls: WallNode[],
  nodes: ReturnType<typeof useScene.getState>['nodes'],
  createNodes: ReturnType<typeof useScene.getState>['createNodes'],
  deleteNode: ReturnType<typeof useScene.getState>['deleteNode'],
): { walls: WallNode[]; point: WallPlanPoint } | null {
  if (!intersection) return null

  const wallToSplit = walls.find((wall) => wall.id === intersection.wallId)
  if (!wallToSplit) {
    return { walls, point: intersection.point }
  }

  if (wallHasAttachments(wallToSplit, nodes)) {
    return { walls, point: intersection.point }
  }

  const [first, second] = splitWallAtPoint(wallToSplit, intersection.point)
  createNodes([
    { node: first, parentId: wallToSplit.parentId as AnyNodeId | undefined },
    { node: second, parentId: wallToSplit.parentId as AnyNodeId | undefined },
  ])
  deleteNode(wallToSplit.id as AnyNodeId)

  return {
    walls: [...walls.filter((wall) => wall.id !== wallToSplit.id), first, second],
    point: intersection.point,
  }
}

export function findWallSnapTarget(
  point: WallPlanPoint,
  walls: WallNode[],
  options?: { ignoreWallIds?: string[]; radius?: number },
): WallPlanPoint | null {
  const ignoreWallIds = new Set(options?.ignoreWallIds ?? [])
  const radiusSquared = (options?.radius ?? WALL_JOIN_SNAP_RADIUS) ** 2
  let bestTarget: WallPlanPoint | null = null
  let bestDistanceSquared = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    if (ignoreWallIds.has(wall.id)) {
      continue
    }

    const candidates: Array<WallPlanPoint | null> = [
      wall.start,
      wall.end,
      projectPointOntoWall(point, wall),
    ]
    for (const candidate of candidates) {
      if (!candidate) {
        continue
      }

      const candidateDistanceSquared = distanceSquared(point, candidate)
      if (
        candidateDistanceSquared > radiusSquared ||
        candidateDistanceSquared >= bestDistanceSquared
      ) {
        continue
      }

      bestTarget = candidate
      bestDistanceSquared = candidateDistanceSquared
    }
  }

  return bestTarget
}

export function snapWallDraftPoint(args: {
  point: WallPlanPoint
  walls: WallNode[]
  start?: WallPlanPoint
  angleSnap?: boolean
  ignoreWallIds?: string[]
}): WallPlanPoint {
  const { point, walls, start, angleSnap = false, ignoreWallIds } = args
  const basePoint = start && angleSnap ? snapPointTo45Degrees(start, point) : snapPointToGrid(point)

  return (
    findWallSnapTarget(basePoint, walls, {
      ignoreWallIds,
    }) ?? basePoint
  )
}

export function isWallLongEnough(start: WallPlanPoint, end: WallPlanPoint): boolean {
  return distanceSquared(start, end) >= WALL_MIN_LENGTH * WALL_MIN_LENGTH
}

export function createWallOnCurrentLevel(
  start: WallPlanPoint,
  end: WallPlanPoint,
): WallNode | null {
  const currentLevelId = useViewer.getState().selection.levelId
  const { createNode, createNodes, deleteNode, nodes } = useScene.getState()

  if (!(currentLevelId && isWallLongEnough(start, end))) {
    return null
  }

  let workingWalls = Object.values(nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && node.parentId === currentLevelId,
  )

  let resolvedStart = start
  let resolvedEnd = end

  const endIntersection = findWallIntersection(resolvedEnd, workingWalls)
  const splitEnd = splitWallIfNeeded(endIntersection, workingWalls, nodes, createNodes, deleteNode)
  if (splitEnd) {
    workingWalls = splitEnd.walls
    resolvedEnd = splitEnd.point
  }

  const startIntersection = findWallIntersection(resolvedStart, workingWalls)
  const splitStart = splitWallIfNeeded(
    startIntersection,
    workingWalls,
    nodes,
    createNodes,
    deleteNode,
  )
  if (splitStart) {
    workingWalls = splitStart.walls
    resolvedStart = splitStart.point
  }

  if (!isWallLongEnough(resolvedStart, resolvedEnd) || pointsEqual(resolvedStart, resolvedEnd)) {
    return null
  }

  const duplicateWall = workingWalls.some(
    (wall) =>
      (pointsEqual(wall.start, resolvedStart) && pointsEqual(wall.end, resolvedEnd)) ||
      (pointsEqual(wall.start, resolvedEnd) && pointsEqual(wall.end, resolvedStart)),
  )
  if (duplicateWall) {
    return null
  }

  const wallCount = Object.values(nodes).filter((node) => node.type === 'wall').length
  const wall = WallSchema.parse({
    name: `Wall ${wallCount + 1}`,
    start: resolvedStart,
    end: resolvedEnd,
  })

  createNode(wall, currentLevelId)
  sfxEmitter.emit('sfx:structure-build')

  return wall
}
