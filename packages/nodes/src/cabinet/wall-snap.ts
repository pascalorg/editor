import {
  type AnyNode,
  type AnyNodeId,
  type CabinetModuleNode,
  calculateLevelMiters,
  getWallArcData,
  getWallCurveFrameAt,
  getWallPlanFootprint,
  getWallThickness,
  isCurvedWall,
  WALL_SNAP_DISTANCE_M,
  type WallNode,
} from '@pascal-app/core'
import type { WallHit } from '../shared/wall-attach-target'
import { snapCabinetFootprintCenter } from './placement-snap'
import { planToRunLocal, runLocalToPlan } from './run-layout'

const EDGE_SNAP_THRESHOLD = 0.08
const FACE_MATCH_THRESHOLD = 0.12
const YAW_MATCH_THRESHOLD = 0.08
const WALL_FACE_EPSILON = 1e-5
const WALL_JUNCTION_EPSILON = 0.001

export type CabinetWallSnapNeighbor = {
  minX: number
  maxX: number
}

export type CabinetWallSnapPlacement = {
  position: [number, number, number]
  yaw: number
  localX: number
  side: WallHit['side']
  snapReason: 'grid' | 'corner' | 'cabinet-edge'
  guide: {
    start: [number, number, number]
    end: [number, number, number]
  }
}

export type CabinetRunWallSnapPose = {
  position: [number, number, number]
  rotation: number
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function snapLocalXToStops({
  endStop,
  localX,
  neighbors,
  startStop,
  width,
}: {
  endStop: number
  localX: number
  neighbors: CabinetWallSnapNeighbor[]
  startStop: number
  width: number
}): { localX: number; reason: CabinetWallSnapPlacement['snapReason'] } {
  if (endStop - startStop <= width) {
    return { localX: (startStop + endStop) / 2, reason: 'corner' }
  }

  const halfWidth = width / 2
  const stops: Array<{ value: number; reason: CabinetWallSnapPlacement['snapReason'] }> = [
    { value: startStop, reason: 'corner' },
    { value: endStop, reason: 'corner' },
  ]
  for (const neighbor of neighbors) {
    stops.push(
      { value: neighbor.minX, reason: 'cabinet-edge' },
      { value: neighbor.maxX, reason: 'cabinet-edge' },
    )
  }

  let best: {
    localX: number
    distance: number
    reason: CabinetWallSnapPlacement['snapReason']
  } | null = null
  for (const movingStop of [localX - halfWidth, localX + halfWidth]) {
    for (const stop of stops) {
      const delta = stop.value - movingStop
      const candidateLocalX = localX + delta
      if (candidateLocalX < startStop + halfWidth || candidateLocalX > endStop - halfWidth) {
        continue
      }
      const distance = Math.abs(delta)
      if (distance > EDGE_SNAP_THRESHOLD) continue
      if (!best || distance < best.distance) {
        best = { localX: candidateLocalX, distance, reason: stop.reason }
      }
    }
  }

  return best ? { localX: best.localX, reason: best.reason } : { localX, reason: 'grid' }
}

function normalizePositiveAngle(angle: number): number {
  const fullTurn = Math.PI * 2
  return ((angle % fullTurn) + fullTurn) % fullTurn
}

function closestCurvedWallPoint(
  wall: WallNode,
  planPoint: readonly [number, number],
): (Omit<WallHit, 'itemRotation' | 'side'> & { distance: number }) | null {
  const arc = getWallArcData(wall)
  if (!arc) return null

  const queryAngle = Math.atan2(planPoint[1] - arc.center.y, planPoint[0] - arc.center.x)
  const sweep = Math.abs(arc.delta)
  const progress =
    arc.delta > 0
      ? normalizePositiveAngle(queryAngle - arc.startAngle)
      : normalizePositiveAngle(arc.startAngle - queryAngle)
  let t: number
  if (progress <= sweep) {
    t = progress / sweep
  } else {
    const start = getWallCurveFrameAt(wall, 0).point
    const end = getWallCurveFrameAt(wall, 1).point
    const startDistance = Math.hypot(planPoint[0] - start.x, planPoint[1] - start.y)
    const endDistance = Math.hypot(planPoint[0] - end.x, planPoint[1] - end.y)
    t = startDistance <= endDistance ? 0 : 1
  }

  const frame = getWallCurveFrameAt(wall, t)
  const dx = planPoint[0] - frame.point.x
  const dz = planPoint[1] - frame.point.y
  return {
    wall,
    localX: t * arc.radius * sweep,
    perpDistance: dx * frame.normal.x + dz * frame.normal.y,
    dirX: frame.tangent.x,
    dirY: frame.tangent.y,
    wallLength: arc.radius * sweep,
    distance: Math.hypot(dx, dz),
  }
}

function closestStraightWallPoint(
  wall: WallNode,
  planPoint: readonly [number, number],
): (Omit<WallHit, 'itemRotation' | 'side'> & { distance: number }) | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dz)
  if (wallLength <= 1e-6) return null
  const dirX = dx / wallLength
  const dirY = dz / wallLength
  const fromStartX = planPoint[0] - wall.start[0]
  const fromStartZ = planPoint[1] - wall.start[1]
  const localX = Math.max(0, Math.min(wallLength, fromStartX * dirX + fromStartZ * dirY))
  const closestX = wall.start[0] + dirX * localX
  const closestZ = wall.start[1] + dirY * localX
  return {
    wall,
    localX,
    perpDistance: fromStartX * -dirY + fromStartZ * dirX,
    dirX,
    dirY,
    wallLength,
    distance: Math.hypot(planPoint[0] - closestX, planPoint[1] - closestZ),
  }
}

export function findClosestCabinetWallInPlan({
  excludeIds,
  fallbackToAnyYaw = false,
  nodes,
  parentLevelId,
  planPoint,
  yaw,
}: {
  excludeIds: readonly AnyNodeId[]
  fallbackToAnyYaw?: boolean
  nodes: Record<AnyNodeId, AnyNode>
  parentLevelId: AnyNodeId
  planPoint: readonly [number, number]
  yaw?: number
}): WallHit | null {
  const excluded = new Set(excludeIds)
  let bestAny:
    | {
        distance: number
        hit: WallHit
      }
    | undefined
  let bestCompatible:
    | {
        distance: number
        hit: WallHit
      }
    | undefined

  for (const node of Object.values(nodes)) {
    if (node?.type !== 'wall' || node.parentId !== parentLevelId) continue
    const wall = node as WallNode
    if (excluded.has(wall.id as AnyNodeId)) continue
    const closest = isCurvedWall(wall)
      ? closestCurvedWallPoint(wall, planPoint)
      : closestStraightWallPoint(wall, planPoint)
    if (!closest || closest.distance > WALL_SNAP_DISTANCE_M) continue
    const side = closest.perpDistance >= 0 ? 'front' : 'back'
    const candidate: { distance: number; hit: WallHit } = {
      distance: closest.distance,
      hit: {
        wall,
        localX: closest.localX,
        perpDistance: closest.perpDistance,
        side,
        dirX: closest.dirX,
        dirY: closest.dirY,
        wallLength: closest.wallLength,
        itemRotation: side === 'front' ? 0 : Math.PI,
      },
    }
    if (!bestAny || candidate.distance < bestAny.distance) bestAny = candidate
    if (
      yaw !== undefined &&
      Math.abs(Math.sin(yaw + Math.atan2(closest.dirY, closest.dirX))) <=
        Math.sin(YAW_MATCH_THRESHOLD) &&
      (!bestCompatible || candidate.distance < bestCompatible.distance)
    ) {
      bestCompatible = candidate
    }
  }

  if (yaw === undefined) return bestAny?.hit ?? null
  return bestCompatible?.hit ?? (fallbackToAnyYaw ? (bestAny?.hit ?? null) : null)
}

function cabinetWallFrameAtLocalX(hit: WallHit, localX: number) {
  if (isCurvedWall(hit.wall)) {
    return getWallCurveFrameAt(hit.wall, localX / hit.wallLength)
  }
  return {
    point: {
      x: hit.wall.start[0] + hit.dirX * localX,
      y: hit.wall.start[1] + hit.dirY * localX,
    },
    tangent: { x: hit.dirX, y: hit.dirY },
    normal: { x: -hit.dirY, y: hit.dirX },
  }
}

function projectCabinetWallLocalPointToPlan(
  hit: WallHit,
  localX: number,
  localZ = 0,
): [number, number] {
  const frame = cabinetWallFrameAtLocalX(hit, localX)
  return [frame.point.x + frame.normal.x * localZ, frame.point.y + frame.normal.y * localZ]
}

function pointsMeet(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= WALL_JUNCTION_EPSILON
}

function polygonXExtentWithinZBand(
  points: readonly { x: number; z: number }[],
  zA: number,
  zB: number,
): { minX: number; maxX: number } | null {
  const minZ = Math.min(zA, zB)
  const maxZ = Math.max(zA, zB)
  const xs: number[] = []

  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    if (a.z >= minZ - WALL_FACE_EPSILON && a.z <= maxZ + WALL_FACE_EPSILON) xs.push(a.x)
    const dz = b.z - a.z
    if (Math.abs(dz) <= WALL_FACE_EPSILON) continue
    for (const boundary of [minZ, maxZ]) {
      const t = (boundary - a.z) / dz
      if (t >= -WALL_FACE_EPSILON && t <= 1 + WALL_FACE_EPSILON) {
        xs.push(a.x + (b.x - a.x) * t)
      }
    }
  }

  return xs.length > 0 ? { minX: Math.min(...xs), maxX: Math.max(...xs) } : null
}

function resolveCabinetWallUsableSpan({
  depth,
  excludeIds,
  hit,
  nodes,
  parentLevelId,
}: {
  depth: number
  excludeIds: readonly AnyNodeId[]
  hit: WallHit
  nodes: Record<AnyNodeId, AnyNode>
  parentLevelId: AnyNodeId
}): { end: number; start: number } {
  if (isCurvedWall(hit.wall)) return { start: 0, end: hit.wallLength }

  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && node.parentId === parentLevelId,
  )
  const miterData = calculateLevelMiters(walls)
  const excluded = new Set(excludeIds)
  const frontNormal = [-hit.dirY, hit.dirX] as const
  const normalScale = hit.side === 'front' ? 1 : -1
  const faceZ = normalScale * (getWallThickness(hit.wall) / 2)
  const outerZ = faceZ + normalScale * depth
  let start = 0
  let end = hit.wallLength

  for (const wall of walls) {
    if (wall.id === hit.wall.id || excluded.has(wall.id as AnyNodeId)) continue
    const connectedAtStart = pointsMeet(hit.wall.start, wall.start)
      ? wall.end
      : pointsMeet(hit.wall.start, wall.end)
        ? wall.start
        : null
    const connectedAtEnd = pointsMeet(hit.wall.end, wall.start)
      ? wall.end
      : pointsMeet(hit.wall.end, wall.end)
        ? wall.start
        : null
    const farPoint = connectedAtStart ?? connectedAtEnd
    if (!farPoint) continue

    const connectionPoint = connectedAtStart ? hit.wall.start : hit.wall.end
    const farDx = farPoint[0] - connectionPoint[0]
    const farDz = farPoint[1] - connectionPoint[1]
    const returnSide = farDx * frontNormal[0] + farDz * frontNormal[1]
    if (returnSide * normalScale <= WALL_JUNCTION_EPSILON) continue

    const localFootprint = getWallPlanFootprint(wall, miterData).map((point) => {
      const dx = point.x - hit.wall.start[0]
      const dz = point.y - hit.wall.start[1]
      return {
        x: dx * hit.dirX + dz * hit.dirY,
        z: dx * frontNormal[0] + dz * frontNormal[1],
      }
    })
    const extent = polygonXExtentWithinZBand(localFootprint, faceZ, outerZ)
    if (!extent) continue
    if (connectedAtStart) start = Math.max(start, extent.maxX)
    else end = Math.min(end, extent.minX)
  }

  return {
    start: Math.min(hit.wallLength, Math.max(0, start)),
    end: Math.max(0, Math.min(hit.wallLength, end)),
  }
}

function cabinetRunWidthAndCenterOffset(
  cabinet: Extract<AnyNode, { type: 'cabinet' }>,
  nodes: Record<AnyNodeId, AnyNode>,
): { width: number; centerOffset: number } {
  const modules = (cabinet.children ?? [])
    .map((id) => nodes[id as AnyNodeId])
    .filter((node): node is CabinetModuleNode => node?.type === 'cabinet-module')
  if (modules.length === 0) return { width: cabinet.width, centerOffset: 0 }

  const minX = Math.min(...modules.map((module) => module.position[0] - module.width / 2))
  const maxX = Math.max(...modules.map((module) => module.position[0] + module.width / 2))
  return { width: Math.max(0.01, maxX - minX), centerOffset: (minX + maxX) / 2 }
}

export function resolveCabinetWallFaceOffset({
  hit,
  nodes,
  parentLevelId,
}: {
  hit: WallHit
  nodes: Record<AnyNodeId, AnyNode>
  parentLevelId: AnyNodeId
}): number {
  if (isCurvedWall(hit.wall)) {
    return (hit.side === 'front' ? 1 : -1) * (getWallThickness(hit.wall) / 2)
  }

  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && node.parentId === parentLevelId,
  )
  if (walls.length === 0) {
    return (hit.side === 'front' ? 1 : -1) * (getWallThickness(hit.wall) / 2)
  }

  const miterData = calculateLevelMiters(walls)
  const footprint = getWallPlanFootprint(hit.wall, miterData)
  if (footprint.length < 3) {
    return (hit.side === 'front' ? 1 : -1) * (getWallThickness(hit.wall) / 2)
  }

  const frontNormal = [-hit.dirY, hit.dirX] as const
  const localPoints = footprint.map((point) => {
    const dx = point.x - hit.wall.start[0]
    const dz = point.y - hit.wall.start[1]
    return {
      x: dx * hit.dirX + dz * hit.dirY,
      z: dx * frontNormal[0] + dz * frontNormal[1],
    }
  })

  const zIntersections: number[] = []
  for (let i = 0; i < localPoints.length; i += 1) {
    const a = localPoints[i]!
    const b = localPoints[(i + 1) % localPoints.length]!
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    if (hit.localX < minX - WALL_FACE_EPSILON || hit.localX > maxX + WALL_FACE_EPSILON) {
      continue
    }
    const dx = b.x - a.x
    if (Math.abs(dx) <= WALL_FACE_EPSILON) {
      if (Math.abs(hit.localX - a.x) <= WALL_FACE_EPSILON) {
        zIntersections.push(a.z, b.z)
      }
      continue
    }
    const t = (hit.localX - a.x) / dx
    if (t < -WALL_FACE_EPSILON || t > 1 + WALL_FACE_EPSILON) continue
    zIntersections.push(a.z + (b.z - a.z) * t)
  }

  if (zIntersections.length === 0) {
    return (hit.side === 'front' ? 1 : -1) * (getWallThickness(hit.wall) / 2)
  }
  return hit.side === 'front' ? Math.max(...zIntersections) : Math.min(...zIntersections)
}

export function collectCabinetWallSnapNeighbors({
  hit,
  nodes,
  excludeIds = [],
  parentLevelId,
  width,
}: {
  excludeIds?: readonly AnyNodeId[]
  hit: WallHit
  nodes: Record<AnyNodeId, AnyNode>
  parentLevelId: AnyNodeId
  width: number
}): CabinetWallSnapNeighbor[] {
  if (isCurvedWall(hit.wall)) return []

  const frontNormal = [-hit.dirY, hit.dirX] as const
  const normalScale = hit.side === 'front' ? 1 : -1
  const yaw = Math.atan2(frontNormal[0] * normalScale, frontNormal[1] * normalScale)
  const wallFaceOffset = getWallThickness(hit.wall) / 2
  const neighbors: CabinetWallSnapNeighbor[] = []
  const excluded = new Set(excludeIds)

  for (const node of Object.values(nodes)) {
    if (node?.type !== 'cabinet') continue
    if (excluded.has(node.id as AnyNodeId)) continue
    if (node.parentId !== parentLevelId) continue
    if (Math.abs(angleDelta(node.rotation, yaw)) > YAW_MATCH_THRESHOLD) continue

    const run = cabinetRunWidthAndCenterOffset(node, nodes)
    const localXAxis = [Math.cos(node.rotation), -Math.sin(node.rotation)] as const
    const centerX = node.position[0] + localXAxis[0] * run.centerOffset
    const centerZ = node.position[2] + localXAxis[1] * run.centerOffset
    const fromStartX = centerX - hit.wall.start[0]
    const fromStartZ = centerZ - hit.wall.start[1]
    const localX = fromStartX * hit.dirX + fromStartZ * hit.dirY
    const perp = fromStartX * frontNormal[0] + fromStartZ * frontNormal[1]
    const expectedPerp = normalScale * (wallFaceOffset + node.depth / 2)
    if (Math.abs(perp - expectedPerp) > FACE_MATCH_THRESHOLD) continue

    const minX = localX - run.width / 2
    const maxX = localX + run.width / 2
    if (maxX < width / 2 || minX > hit.wallLength - width / 2) continue
    neighbors.push({ minX, maxX })
  }

  return neighbors
}

export function resolveCabinetWallSnapPlacement({
  depth,
  gridStep = 0,
  faceOffset,
  hit,
  endStop = hit.wallLength,
  neighbors = [],
  startStop = 0,
  width,
}: {
  depth: number
  endStop?: number
  faceOffset?: number
  gridStep?: number
  hit: WallHit
  neighbors?: CabinetWallSnapNeighbor[]
  startStop?: number
  width: number
}): CabinetWallSnapPlacement | null {
  if (hit.wallLength <= 1e-6 || endStop <= startStop) return null

  const halfWidth = width / 2
  const snappedLocalX = snapCabinetFootprintCenter(hit.localX, width, gridStep)
  const clampedLocalX =
    endStop - startStop > width
      ? Math.min(endStop - halfWidth, Math.max(startStop + halfWidth, snappedLocalX))
      : (startStop + endStop) / 2
  const snapped = snapLocalXToStops({
    endStop,
    localX: clampedLocalX,
    neighbors,
    startStop,
    width,
  })
  const localX = snapped.localX
  const frame = cabinetWallFrameAtLocalX(hit, localX)
  const centerline = [frame.point.x, frame.point.y] as const
  const frontNormal = [frame.normal.x, frame.normal.y] as const
  const normalScale = hit.side === 'front' ? 1 : -1
  const normal = [frontNormal[0] * normalScale, frontNormal[1] * normalScale] as const
  const resolvedFaceOffset = faceOffset ?? (normalScale * getWallThickness(hit.wall)) / 2
  const cabinetCenterOffset = resolvedFaceOffset + normalScale * (depth / 2)
  const guideOffset = resolvedFaceOffset
  const guideStart = projectCabinetWallLocalPointToPlan(
    hit,
    Math.max(startStop, localX - halfWidth),
    guideOffset,
  )
  const guideEnd = projectCabinetWallLocalPointToPlan(
    hit,
    Math.min(endStop, localX + halfWidth),
    guideOffset,
  )

  return {
    position: [
      centerline[0] + frontNormal[0] * cabinetCenterOffset,
      0,
      centerline[1] + frontNormal[1] * cabinetCenterOffset,
    ],
    yaw: Math.atan2(normal[0], normal[1]),
    localX,
    side: hit.side,
    snapReason: snapped.reason,
    guide: {
      start: [guideStart[0], 0.025, guideStart[1]],
      end: [guideEnd[0], 0.025, guideEnd[1]],
    },
  }
}

export function resolveCabinetWallSnapPlacementInScene({
  depth,
  excludeIds = [],
  gridStep = 0,
  hit,
  nodes,
  parentLevelId,
  width,
}: {
  depth: number
  excludeIds?: readonly AnyNodeId[]
  gridStep?: number
  hit: WallHit
  nodes: Record<AnyNodeId, AnyNode>
  parentLevelId: AnyNodeId
  width: number
}): CabinetWallSnapPlacement | null {
  const span = resolveCabinetWallUsableSpan({ depth, excludeIds, hit, nodes, parentLevelId })
  return resolveCabinetWallSnapPlacement({
    depth,
    endStop: span.end,
    faceOffset: resolveCabinetWallFaceOffset({ hit, nodes, parentLevelId }),
    gridStep,
    hit,
    neighbors: collectCabinetWallSnapNeighbors({
      excludeIds,
      hit,
      nodes,
      parentLevelId,
      width,
    }),
    startStop: span.start,
    width,
  })
}

/**
 * Wall snap for a single dragged module, in its run's LOCAL frame — the
 * frame `movable.parentFrame` kinds store `position` in. Converts the
 * candidate to plan space, resolves the same flush-to-wall placement a run
 * drag gets, and converts back. Snaps only when the module's world yaw
 * already faces the wall (a module drag cannot rotate its run).
 */
export function resolveCabinetModuleWallSnapLocal({
  candidateLocal,
  excludeIds = [],
  gridStep = 0,
  module,
  nodes,
  parentLevelId,
  run,
}: {
  candidateLocal: [number, number, number]
  excludeIds?: readonly AnyNodeId[]
  gridStep?: number
  module: CabinetModuleNode
  nodes: Record<AnyNodeId, AnyNode>
  parentLevelId: AnyNodeId
  run: Extract<AnyNode, { type: 'cabinet' }>
}): [number, number, number] | null {
  const planCenter = runLocalToPlan(run, candidateLocal)
  const worldYaw = run.rotation + module.rotation
  const hit = findClosestCabinetWallInPlan({
    excludeIds,
    nodes,
    parentLevelId,
    planPoint: [planCenter[0], planCenter[2]],
    yaw: worldYaw,
  })
  if (!hit) return null

  const placement = resolveCabinetWallSnapPlacementInScene({
    depth: module.depth,
    excludeIds: [...excludeIds, run.id as AnyNodeId],
    gridStep,
    hit,
    nodes,
    parentLevelId,
    width: module.width,
  })
  if (!placement) return null

  if (Math.abs(angleDelta(worldYaw, placement.yaw)) > YAW_MATCH_THRESHOLD) return null

  return planToRunLocal(run, placement.position[0], candidateLocal[1], placement.position[2])
}

export function resolveCabinetRunWallSnap({
  cabinet,
  candidatePosition,
  candidateRotation = cabinet.rotation,
  excludeIds = [],
  gridStep = 0,
  nodes,
  parentLevelId,
}: {
  cabinet: Extract<AnyNode, { type: 'cabinet' }>
  candidatePosition: [number, number, number]
  candidateRotation?: number
  excludeIds?: readonly AnyNodeId[]
  gridStep?: number
  nodes: Record<AnyNodeId, AnyNode>
  parentLevelId: AnyNodeId
}): CabinetRunWallSnapPose | null {
  const run = cabinetRunWidthAndCenterOffset(cabinet, nodes)
  const axisX = Math.cos(candidateRotation)
  const axisZ = -Math.sin(candidateRotation)
  const footprintCenter: [number, number] = [
    candidatePosition[0] + axisX * run.centerOffset,
    candidatePosition[2] + axisZ * run.centerOffset,
  ]
  const hit = findClosestCabinetWallInPlan({
    excludeIds,
    fallbackToAnyYaw: true,
    nodes,
    parentLevelId,
    planPoint: footprintCenter,
    yaw: candidateRotation,
  })
  if (!hit) return null

  const placement = resolveCabinetWallSnapPlacementInScene({
    depth: cabinet.depth,
    excludeIds,
    gridStep,
    hit,
    nodes,
    parentLevelId,
    width: run.width,
  })
  if (!placement) return null

  return {
    position: [
      placement.position[0] - Math.cos(placement.yaw) * run.centerOffset,
      candidatePosition[1],
      placement.position[2] + Math.sin(placement.yaw) * run.centerOffset,
    ],
    rotation: placement.yaw,
  }
}
