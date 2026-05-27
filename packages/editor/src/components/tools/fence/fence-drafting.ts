import {
  FenceNode,
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { sfxEmitter } from '../../../lib/sfx-bus'
import {
  findWallSnapTarget,
  getWallAngleSnapStep,
  getWallGridStep,
  isWallLongEnough,
  snapPointTo45Degrees,
  snapPointToGrid,
  type WallPlanPoint,
} from '../wall/wall-drafting'

export type FencePlanPoint = WallPlanPoint

const FENCE_CORNER_SNAP_RADIUS = 0.28
const FENCE_SPAN_SNAP_RADIUS = 0.16

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
  const cornerRadiusSquared = FENCE_CORNER_SNAP_RADIUS ** 2
  const spanRadiusSquared = FENCE_SPAN_SNAP_RADIUS ** 2
  const ignoredFenceIds = new Set(ignoreFenceIds)
  let bestCornerTarget: FencePlanPoint | null = null
  let bestCornerDistanceSquared = Number.POSITIVE_INFINITY
  let bestSpanTarget: FencePlanPoint | null = null
  let bestSpanDistanceSquared = Number.POSITIVE_INFINITY

  for (const fence of fences) {
    if (ignoredFenceIds.has(fence.id)) {
      continue
    }

    for (const candidate of [fence.start, fence.end]) {
      const candidateDistanceSquared = distanceSquared(point, candidate)
      if (
        candidateDistanceSquared > cornerRadiusSquared ||
        candidateDistanceSquared >= bestCornerDistanceSquared
      ) {
        continue
      }

      bestCornerTarget = candidate
      bestCornerDistanceSquared = candidateDistanceSquared
    }

    if (isCurvedWall(fence)) {
      const sampleCount = Math.max(8, Math.ceil(getWallCurveLength(fence) / 0.3))
      for (let index = 1; index < sampleCount; index += 1) {
        const frame = getWallCurveFrameAt(fence, index / sampleCount)
        const candidate: FencePlanPoint = [frame.point.x, frame.point.y]
        const candidateDistanceSquared = distanceSquared(point, candidate)
        if (
          candidateDistanceSquared > spanRadiusSquared ||
          candidateDistanceSquared >= bestSpanDistanceSquared
        ) {
          continue
        }

        bestSpanTarget = candidate
        bestSpanDistanceSquared = candidateDistanceSquared
      }
    } else {
      const candidate = projectPointOntoSegment(point, fence)
      if (!candidate) {
        continue
      }

      const candidateDistanceSquared = distanceSquared(point, candidate)
      if (
        candidateDistanceSquared > spanRadiusSquared ||
        candidateDistanceSquared >= bestSpanDistanceSquared
      ) {
        continue
      }

      bestSpanTarget = candidate
      bestSpanDistanceSquared = candidateDistanceSquared
    }
  }

  return bestCornerTarget ?? bestSpanTarget
}

export function snapFenceDraftPoint(args: {
  point: FencePlanPoint
  walls: WallNode[]
  fences: FenceNode[]
  start?: FencePlanPoint
  angleSnap?: boolean
  ignoreFenceIds?: string[]
  /** Override the grid step (e.g. `WALL_FINE_GRID_STEP` for precision mode). */
  step?: number
}): FencePlanPoint {
  const { point, walls, fences, start, angleSnap = false, ignoreFenceIds, step } = args
  const gridStep = step ?? getWallGridStep()
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
