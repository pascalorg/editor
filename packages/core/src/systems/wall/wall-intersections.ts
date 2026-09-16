import type { WallNode } from '../../schema'
import { getWallArcData, getWallCurveFrameAt, isCurvedWall } from './wall-curve'
import type { WallPlanPoint } from './wall-move'

const WALL_SPLIT_ENDPOINT_EPSILON = 0.02
const WALL_INTERSECTION_EPSILON = 1e-6

export type WallSegmentIntersection = {
  wallId: WallNode['id']
  point: WallPlanPoint
  draftT: number
  wallT: number
}

export function distanceSquared(a: WallPlanPoint, b: WallPlanPoint) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

export function projectPointOntoWallCenterline(
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
    const projected = getWallCurveFrameAt(wall, wallT).point
    return { point: [projected.x, projected.y], wallT }
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

export function nearestWallProjection(
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

export function straightSegmentIntersection(
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

export function curvedSegmentIntersections(
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

export function joinCrossingAtNearbyWallEndpoint(
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
