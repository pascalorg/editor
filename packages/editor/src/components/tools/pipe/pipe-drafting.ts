import {
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  PipeNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
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

export type PipePlanPoint = WallPlanPoint

const PIPE_CORNER_SNAP_RADIUS = 0.28
const PIPE_SPAN_SNAP_RADIUS = 0.16

type SegmentNode = {
  start: PipePlanPoint
  end: PipePlanPoint
  curveOffset?: number
}

function distanceSquared(a: PipePlanPoint, b: PipePlanPoint): number {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

function projectPointOntoSegment(
  point: PipePlanPoint,
  segment: SegmentNode,
): PipePlanPoint | null {
  const [x1, z1] = segment.start
  const [x2, z2] = segment.end
  const dx = x2 - x1
  const dz = z2 - z1
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) return null

  const t = ((point[0] - x1) * dx + (point[1] - z1) * dz) / lengthSquared
  if (t <= 0 || t >= 1) return null

  return [x1 + dx * t, z1 + dz * t]
}

function findPipeSnapTarget(
  point: PipePlanPoint,
  pipes: PipeNode[],
  ignorePipeIds: string[] = [],
): PipePlanPoint | null {
  const cornerRadiusSquared = PIPE_CORNER_SNAP_RADIUS ** 2
  const spanRadiusSquared = PIPE_SPAN_SNAP_RADIUS ** 2
  const ignoredPipeIds = new Set(ignorePipeIds)
  let bestCornerTarget: PipePlanPoint | null = null
  let bestCornerDistanceSquared = Number.POSITIVE_INFINITY
  let bestSpanTarget: PipePlanPoint | null = null
  let bestSpanDistanceSquared = Number.POSITIVE_INFINITY

  for (const pipe of pipes) {
    if (ignoredPipeIds.has(pipe.id)) continue

    for (const candidate of [pipe.start, pipe.end]) {
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

    if (isCurvedWall(pipe)) {
      const sampleCount = Math.max(8, Math.ceil(getWallCurveLength(pipe) / 0.3))
      for (let index = 1; index < sampleCount; index += 1) {
        const frame = getWallCurveFrameAt(pipe, index / sampleCount)
        const candidate: PipePlanPoint = [frame.point.x, frame.point.y]
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
      const candidate = projectPointOntoSegment(point, pipe)
      if (!candidate) continue

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

export function snapPipeDraftPoint(args: {
  point: PipePlanPoint
  walls: WallNode[]
  pipes: PipeNode[]
  start?: PipePlanPoint
  angleSnap?: boolean
  ignorePipeIds?: string[]
}): PipePlanPoint {
  const { point, walls, pipes, start, angleSnap = false, ignorePipeIds } = args
  const gridStep = getWallGridStep()
  const angleStep = getWallAngleSnapStep(gridStep)
  const basePoint =
    start && angleSnap
      ? snapPointTo45Degrees(start, point, gridStep, angleStep)
      : snapPointToGrid(point, gridStep)
  const pipeSnapTarget = findPipeSnapTarget(basePoint, pipes, ignorePipeIds)

  return pipeSnapTarget ?? findWallSnapTarget(basePoint, walls) ?? basePoint
}

export function createPipeOnCurrentLevel(
  start: PipePlanPoint,
  end: PipePlanPoint,
): PipeNode | null {
  const currentLevelId = useViewer.getState().selection.levelId
  const { createNode, nodes } = useScene.getState()

  if (!(currentLevelId && isWallLongEnough(start, end))) {
    return null
  }

  const pipeCount = Object.values(nodes).filter((node) => node.type === 'pipe').length
  const pipe = PipeNode.parse({
    name: `Pipe ${pipeCount + 1}`,
    start,
    end,
  })

  createNode(pipe, currentLevelId)
  sfxEmitter.emit('sfx:structure-build')

  return pipe
}
