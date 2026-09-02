import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { runLocalToPlan } from './run-layout'
import {
  collectCabinetWallSnapNeighbors,
  findClosestCabinetWallInPlan,
  resolveCabinetWallFaceOffset,
} from './wall-snap'

const DIMENSION_Y = 0.035
const DIMENSION_OFFSET = 0.22
const DIMENSION_EPSILON = 1e-4

export type CabinetPlacementDimension = {
  id: string
  start: [number, number, number]
  end: [number, number, number]
  offsetNormal: [number, number]
  offsetDistance: number
  value: number
  renderIn3d?: boolean
  renderInFloorplan?: boolean
}

export function buildCabinetPlacementSizeDimensions({
  depth,
  height,
  position,
  rotation,
  width,
}: {
  depth: number
  height: number
  position: readonly [number, number, number]
  rotation: number
  width: number
}): CabinetPlacementDimension[] {
  const run = {
    position: [position[0], position[1], position[2]] as [number, number, number],
    rotation,
  }
  return [
    {
      id: 'cabinet-width',
      start: runLocalToPlan(run, [-width / 2, 0, depth / 2]),
      end: runLocalToPlan(run, [width / 2, 0, depth / 2]),
      offsetNormal: [0, 1],
      offsetDistance: 0.18,
      value: width,
      renderIn3d: false,
    },
    {
      id: 'cabinet-depth',
      start: runLocalToPlan(run, [width / 2, 0, -depth / 2]),
      end: runLocalToPlan(run, [width / 2, 0, depth / 2]),
      offsetNormal: [1, 0],
      offsetDistance: 0.18,
      value: depth,
      renderIn3d: false,
    },
    {
      id: 'cabinet-height',
      start: runLocalToPlan(run, [-width / 2, 0, -depth / 2]),
      end: runLocalToPlan(run, [-width / 2, height, -depth / 2]),
      offsetNormal: [0, 0],
      offsetDistance: 0,
      value: height,
      renderIn3d: false,
      renderInFloorplan: false,
    },
  ]
}

function pointOnWall(
  wall: {
    start: [number, number]
  },
  dir: readonly [number, number],
  localX: number,
): [number, number, number] {
  return [wall.start[0] + dir[0] * localX, DIMENSION_Y, wall.start[1] + dir[1] * localX]
}

function createWallDimension({
  endLocalX,
  hit,
  id,
  startLocalX,
  value,
}: {
  endLocalX: number
  hit: NonNullable<ReturnType<typeof findClosestCabinetWallInPlan>>
  id: string
  startLocalX: number
  value: number
}): CabinetPlacementDimension {
  const frontNormal: [number, number] = [-hit.dirY, hit.dirX]
  const normalScale = hit.side === 'front' ? 1 : -1
  return {
    id,
    start: pointOnWall(hit.wall, [hit.dirX, hit.dirY], startLocalX),
    end: pointOnWall(hit.wall, [hit.dirX, hit.dirY], endLocalX),
    offsetNormal: [frontNormal[0] * -normalScale, frontNormal[1] * -normalScale],
    offsetDistance: DIMENSION_OFFSET,
    value,
  }
}

function findPlacementWallHit({
  levelId,
  nodes,
  position,
  rotation,
  wallId,
}: {
  levelId: AnyNodeId
  nodes: Readonly<Record<AnyNodeId, AnyNode>>
  position: readonly [number, number, number]
  rotation: number
  wallId?: AnyNodeId
}) {
  const selectedWall = wallId ? nodes[wallId] : undefined
  const excludedWallIds =
    selectedWall?.type === 'wall'
      ? Object.values(nodes)
          .filter((node) => node.type === 'wall' && node.id !== selectedWall.id)
          .map((node) => node.id as AnyNodeId)
      : []
  const hit = findClosestCabinetWallInPlan({
    excludeIds: excludedWallIds,
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    parentLevelId: levelId,
    planPoint: [position[0], position[2]],
    yaw: rotation,
  })
  return selectedWall?.type === 'wall' && hit?.wall.id !== selectedWall.id ? null : hit
}

export function resolveCabinetPlacementDimensions({
  depth,
  levelId,
  nodes,
  position,
  rotation,
  wallId,
  width,
}: {
  depth: number
  levelId: AnyNodeId
  nodes: Readonly<Record<AnyNodeId, AnyNode>>
  position: readonly [number, number, number]
  rotation: number
  wallId?: AnyNodeId
  width: number
}): CabinetPlacementDimension[] {
  const wallHit = findPlacementWallHit({ levelId, nodes, position, rotation, wallId })
  if (!wallHit) return []

  const minLocalX = wallHit.localX - width / 2
  const maxLocalX = wallHit.localX + width / 2
  const dimensions: CabinetPlacementDimension[] = []
  if (minLocalX > DIMENSION_EPSILON) {
    dimensions.push(
      createWallDimension({
        endLocalX: minLocalX,
        hit: wallHit,
        id: 'wall-start',
        startLocalX: 0,
        value: minLocalX,
      }),
    )
  }

  const neighbors = collectCabinetWallSnapNeighbors({
    hit: wallHit,
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    parentLevelId: levelId,
    width,
  })
  const leftNeighbor = neighbors
    .filter((neighbor) => neighbor.maxX <= minLocalX + DIMENSION_EPSILON)
    .sort((a, b) => b.maxX - a.maxX)[0]
  const rightNeighbor = neighbors
    .filter((neighbor) => neighbor.minX >= maxLocalX - DIMENSION_EPSILON)
    .sort((a, b) => a.minX - b.minX)[0]
  const neighborGap = leftNeighbor
    ? { end: minLocalX, start: leftNeighbor.maxX }
    : rightNeighbor
      ? { end: rightNeighbor.minX, start: maxLocalX }
      : null
  if (neighborGap && neighborGap.end - neighborGap.start >= -DIMENSION_EPSILON) {
    dimensions.push(
      createWallDimension({
        endLocalX: neighborGap.end,
        hit: wallHit,
        id: 'neighbor-gap',
        startLocalX: neighborGap.start,
        value: Math.max(0, neighborGap.end - neighborGap.start),
      }),
    )
  }

  if (dimensions.length > 0) return dimensions

  const faceOffset = resolveCabinetWallFaceOffset({
    hit: wallHit,
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    parentLevelId: levelId,
  })
  const normalScale = wallHit.side === 'front' ? 1 : -1
  const expectedPerpendicular = faceOffset + normalScale * (depth / 2)
  const wallGap = Math.abs(wallHit.perpDistance - expectedPerpendicular)
  if (wallGap <= DIMENSION_EPSILON) return []

  const wallPoint = pointOnWall(wallHit.wall, [wallHit.dirX, wallHit.dirY], wallHit.localX)
  const frontNormal: [number, number] = [-wallHit.dirY, wallHit.dirX]
  const facePoint: [number, number, number] = [
    wallPoint[0] + frontNormal[0] * wallHit.perpDistance,
    DIMENSION_Y,
    wallPoint[2] + frontNormal[1] * wallHit.perpDistance,
  ]
  const backPoint: [number, number, number] = [
    facePoint[0] + Math.sin(rotation) * depth,
    DIMENSION_Y,
    facePoint[2] + Math.cos(rotation) * depth,
  ]
  return [
    {
      id: 'wall-clearance',
      start: facePoint,
      end: backPoint,
      offsetNormal: [0, 0],
      offsetDistance: 0,
      value: wallGap,
    },
  ]
}

export function resolveCabinetPlacementDimensionPosition({
  depth,
  dimensionId,
  levelId,
  nodes,
  position,
  rotation,
  wallId,
  width,
  value,
}: {
  depth: number
  dimensionId: string
  levelId: AnyNodeId
  nodes: Readonly<Record<AnyNodeId, AnyNode>>
  position: readonly [number, number, number]
  rotation: number
  wallId?: AnyNodeId
  width: number
  value: number
}): { position: [number, number, number]; wallLocalX: number } | null {
  if (!Number.isFinite(value) || value < 0) return null
  const hit = findPlacementWallHit({ levelId, nodes, position, rotation, wallId })
  if (!hit) return null

  const neighbors = collectCabinetWallSnapNeighbors({
    hit,
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    parentLevelId: levelId,
    width,
  })
  const currentMinLocalX = hit.localX - width / 2
  const currentMaxLocalX = hit.localX + width / 2
  let localX: number
  if (dimensionId === 'wall-start') {
    localX = value + width / 2
  } else if (dimensionId === 'neighbor-gap') {
    const leftNeighbor = neighbors
      .filter((neighbor) => neighbor.maxX <= currentMinLocalX + DIMENSION_EPSILON)
      .sort((a, b) => b.maxX - a.maxX)[0]
    const rightNeighbor = neighbors
      .filter((neighbor) => neighbor.minX >= currentMaxLocalX - DIMENSION_EPSILON)
      .sort((a, b) => a.minX - b.minX)[0]
    if (leftNeighbor) localX = leftNeighbor.maxX + value + width / 2
    else if (rightNeighbor) localX = rightNeighbor.minX - value - width / 2
    else return null
  } else if (dimensionId === 'wall-clearance') {
    const faceOffset = resolveCabinetWallFaceOffset({
      hit,
      nodes: nodes as Record<AnyNodeId, AnyNode>,
      parentLevelId: levelId,
    })
    const normalScale = hit.side === 'front' ? 1 : -1
    const expectedPerpendicular = faceOffset + normalScale * (depth / 2)
    const targetPerpendicular = expectedPerpendicular + normalScale * value
    const frontNormal: [number, number] = [-hit.dirY, hit.dirX]
    const wallPoint = pointOnWall(hit.wall, [hit.dirX, hit.dirY], hit.localX)
    return {
      position: [
        wallPoint[0] + frontNormal[0] * targetPerpendicular,
        position[1],
        wallPoint[2] + frontNormal[1] * targetPerpendicular,
      ],
      wallLocalX: hit.localX,
    }
  } else {
    return null
  }

  if (
    localX < width / 2 - DIMENSION_EPSILON ||
    localX > hit.wallLength - width / 2 + DIMENSION_EPSILON
  ) {
    return null
  }
  const clampedLocalX = Math.min(hit.wallLength - width / 2, Math.max(width / 2, localX))
  const faceOffset = resolveCabinetWallFaceOffset({
    hit,
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    parentLevelId: levelId,
  })
  const normalScale = hit.side === 'front' ? 1 : -1
  const frontNormal: [number, number] = [-hit.dirY, hit.dirX]
  const wallPoint = pointOnWall(hit.wall, [hit.dirX, hit.dirY], clampedLocalX)
  const centerOffset = faceOffset + normalScale * (depth / 2)
  return {
    position: [
      wallPoint[0] + frontNormal[0] * centerOffset,
      position[1],
      wallPoint[2] + frontNormal[1] * centerOffset,
    ],
    wallLocalX: clampedLocalX,
  }
}
