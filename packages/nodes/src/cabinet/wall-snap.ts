import {
  type AnyNode,
  type AnyNodeId,
  type CabinetModuleNode,
  calculateLevelMiters,
  getWallPlanFootprint,
  getWallThickness,
  type WallNode,
} from '@pascal-app/core'
import type { WallHit } from '../shared/wall-attach-target'
import { projectWallLocalPointToPlan } from '../shared/wall-attach-target'

const EDGE_SNAP_THRESHOLD = 0.08
const FACE_MATCH_THRESHOLD = 0.12
const YAW_MATCH_THRESHOLD = 0.08
const WALL_FACE_EPSILON = 1e-5

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

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function snapLocalXToStops({
  localX,
  neighbors,
  wallLength,
  width,
}: {
  localX: number
  neighbors: CabinetWallSnapNeighbor[]
  wallLength: number
  width: number
}): { localX: number; reason: CabinetWallSnapPlacement['snapReason'] } {
  if (wallLength <= width) return { localX: wallLength / 2, reason: 'corner' }

  const halfWidth = width / 2
  const stops: Array<{ value: number; reason: CabinetWallSnapPlacement['snapReason'] }> = [
    { value: 0, reason: 'corner' },
    { value: wallLength, reason: 'corner' },
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
      if (candidateLocalX < halfWidth || candidateLocalX > wallLength - halfWidth) continue
      const distance = Math.abs(delta)
      if (distance > EDGE_SNAP_THRESHOLD) continue
      if (!best || distance < best.distance) {
        best = { localX: candidateLocalX, distance, reason: stop.reason }
      }
    }
  }

  return best ? { localX: best.localX, reason: best.reason } : { localX, reason: 'grid' }
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
  parentLevelId,
  width,
}: {
  hit: WallHit
  nodes: Record<AnyNodeId, AnyNode>
  parentLevelId: AnyNodeId
  width: number
}): CabinetWallSnapNeighbor[] {
  const frontNormal = [-hit.dirY, hit.dirX] as const
  const normalScale = hit.side === 'front' ? 1 : -1
  const yaw = Math.atan2(frontNormal[0] * normalScale, frontNormal[1] * normalScale)
  const wallFaceOffset = getWallThickness(hit.wall) / 2
  const neighbors: CabinetWallSnapNeighbor[] = []

  for (const node of Object.values(nodes)) {
    if (node?.type !== 'cabinet') continue
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
  neighbors = [],
  width,
}: {
  depth: number
  faceOffset?: number
  gridStep?: number
  hit: WallHit
  neighbors?: CabinetWallSnapNeighbor[]
  width: number
}): CabinetWallSnapPlacement | null {
  if (hit.wallLength <= 1e-6) return null

  const halfWidth = width / 2
  const snappedLocalX = snap(hit.localX, gridStep)
  const clampedLocalX =
    hit.wallLength > width
      ? Math.min(hit.wallLength - halfWidth, Math.max(halfWidth, snappedLocalX))
      : hit.wallLength / 2
  const snapped = snapLocalXToStops({
    localX: clampedLocalX,
    neighbors,
    wallLength: hit.wallLength,
    width,
  })
  const localX = snapped.localX
  const centerline = projectWallLocalPointToPlan(hit.wall, localX)
  const frontNormal = [-hit.dirY, hit.dirX] as const
  const normalScale = hit.side === 'front' ? 1 : -1
  const normal = [frontNormal[0] * normalScale, frontNormal[1] * normalScale] as const
  const resolvedFaceOffset = faceOffset ?? (normalScale * getWallThickness(hit.wall)) / 2
  const cabinetCenterOffset = resolvedFaceOffset + normalScale * (depth / 2)
  const guideOffset = resolvedFaceOffset
  const guideStart = projectWallLocalPointToPlan(
    hit.wall,
    Math.max(0, localX - halfWidth),
    guideOffset,
  )
  const guideEnd = projectWallLocalPointToPlan(
    hit.wall,
    Math.min(hit.wallLength, localX + halfWidth),
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
