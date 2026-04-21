import { FenceNode, getWallCurveFrameAt, getWallCurveLength, isCurvedWall, useScene, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { sfxEmitter } from '../../../lib/sfx-bus'
import {
  getWallAngleSnapStep,
  getWallGridStep,
  type WallPlanPoint,
  findWallSnapTarget,
  isWallLongEnough,
  snapPointTo45Degrees,
  snapPointToGrid,
} from '../wall/wall-drafting'

export type FencePlanPoint = WallPlanPoint

type SegmentNode = {
  start: FencePlanPoint
  end: FencePlanPoint
}

function distanceSquared(a: FencePlanPoint, b: FencePlanPoint): number {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

function projectPointOntoSegment(
  point: FencePlanPoint,
  segment: SegmentNode,
): FencePlanPoint | null {
  const [x1, z1] = segment.start
  const [x2, z2] = segment.end
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

function findFenceSnapTarget(
  point: FencePlanPoint,
  fences: FenceNode[],
  ignoreFenceIds: string[] = [],
): FencePlanPoint | null {
  const radiusSquared = 0.35 ** 2
  const ignoredFenceIds = new Set(ignoreFenceIds)
  let bestTarget: FencePlanPoint | null = null
  let bestDistanceSquared = Number.POSITIVE_INFINITY

  for (const fence of fences) {
    if (ignoredFenceIds.has(fence.id)) {
      continue
    }

    const candidates: Array<FencePlanPoint | null> = [fence.start, fence.end]
    if (isCurvedWall(fence)) {
      const sampleCount = Math.max(8, Math.ceil(getWallCurveLength(fence) / 0.3))
      for (let index = 0; index <= sampleCount; index += 1) {
        const frame = getWallCurveFrameAt(fence, index / sampleCount)
        candidates.push([frame.point.x, frame.point.y])
      }
    } else {
      candidates.push(projectPointOntoSegment(point, fence))
    }

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

export function snapFenceDraftPoint(args: {
  point: FencePlanPoint
  walls: WallNode[]
  fences: FenceNode[]
  start?: FencePlanPoint
  angleSnap?: boolean
  ignoreFenceIds?: string[]
}): FencePlanPoint {
  const { point, walls, fences, start, angleSnap = false, ignoreFenceIds } = args
  const gridStep = getWallGridStep()
  const angleStep = getWallAngleSnapStep(gridStep)
  const basePoint =
    start && angleSnap
      ? snapPointTo45Degrees(start, point, gridStep, angleStep)
      : snapPointToGrid(point, gridStep)
  const fenceSnapTarget = findFenceSnapTarget(basePoint, fences, ignoreFenceIds)

  return fenceSnapTarget ?? findWallSnapTarget(basePoint, walls) ?? basePoint
}

export function createFenceOnCurrentLevel(
  start: FencePlanPoint,
  end: FencePlanPoint,
): FenceNode | null {
  const currentLevelId = useViewer.getState().selection.levelId
  const { createNode, nodes } = useScene.getState()

  if (!(currentLevelId && isWallLongEnough(start, end))) {
    return null
  }

  const fenceCount = Object.values(nodes).filter((node) => node.type === 'fence').length
  const fence = FenceNode.parse({
    name: `Fence ${fenceCount + 1}`,
    start,
    end,
  })

  createNode(fence, currentLevelId)
  sfxEmitter.emit('sfx:structure-build')

  return fence
}
