import {
  DEFAULT_ANGLE_STEP,
  FenceNode,
  getTwoPointFenceCurveTangents,
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  snapPointAlongAngleRay,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import {
  findWallSnapTarget,
  getSegmentGridStep,
  isSegmentLongEnough,
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
  bypassSnap?: boolean
  magnetic?: boolean
  /** Override the grid step. */
  step?: number
  /**
   * Optional grid-snap function. When provided, replaces the default
   * local-axis snap — lets the 2D floor-plan keep snapping to the
   * world XZ grid even when the building is rotated. Wall / fence
   * endpoint snap precedence is preserved.
   */
  gridSnap?: (point: FencePlanPoint) => FencePlanPoint
}): FencePlanPoint {
  const {
    point,
    walls,
    fences,
    start,
    angleSnap = false,
    ignoreFenceIds,
    bypassSnap = false,
    magnetic = true,
    step,
    gridSnap,
  } = args
  if (bypassSnap) return point

  const gridStep = step ?? getSegmentGridStep()

  // Magnetic endpoint snap must beat the angle lock, and the lock can pull
  // the cursor far enough off an endpoint that probing the locked point
  // would never engage — so under the lock, probe from the RAW cursor
  // first (mirrors `snapWallDraftPointDetailed`'s special-point pre-pass).
  if (start && angleSnap) {
    const rawTarget =
      magnetic &&
      (findFenceSnapTarget(point, fences, ignoreFenceIds) ?? findWallSnapTarget(point, walls))
    if (rawTarget) return rawTarget
  }

  // The angle path snaps the distance ALONG the 15° ray — a scalar, the
  // same in world and local frames — so the `gridSnap` world-grid override
  // only applies when the angle lock is off.
  const basePoint: FencePlanPoint =
    start && angleSnap
      ? [...snapPointAlongAngleRay(start, point, DEFAULT_ANGLE_STEP, gridStep)]
      : gridSnap
        ? gridSnap(point)
        : snapPointToGrid(point, gridStep)
  if (!magnetic) return basePoint

  const fenceSnapTarget = findFenceSnapTarget(basePoint, fences, ignoreFenceIds)
  return fenceSnapTarget ?? findWallSnapTarget(basePoint, walls) ?? basePoint
}

export function createFenceOnCurrentLevel(
  start: FencePlanPoint,
  end: FencePlanPoint,
): FenceNode | null {
  const currentLevelId = useViewer.getState().selection.levelId
  const { createNode, nodes } = useScene.getState()

  if (!(currentLevelId && isSegmentLongEnough(start, end))) {
    return null
  }

  const fenceCount = Object.values(nodes).filter((node) => node.type === 'fence').length
  // Build parameters seeded by a placed preset (height, style, post
  // spacing, …) merge in first; `name`/`start`/`end` always win. The
  // schema parse validates and drops anything unexpected.
  const defaults = useEditor.getState().toolDefaults.fence ?? {}
  const fence = FenceNode.parse({
    ...defaults,
    name: `Fence ${fenceCount + 1}`,
    start,
    end,
  })

  createNode(fence, currentLevelId)
  sfxEmitter.emit('sfx:structure-build')

  return fence
}

/**
 * Commit a smooth spline fence from a list of drawn control points. The
 * centerline becomes a Catmull-Rom curve through `path`; `start`/`end` are
 * pinned to the first/last point so endpoint handles, bbox, and miter
 * references stay valid. Requires >= 2 points spanning a usable distance.
 */
export function createSplineFenceOnCurrentLevel(
  path: FencePlanPoint[],
  tangents = getTwoPointFenceCurveTangents(path),
): FenceNode | null {
  const currentLevelId = useViewer.getState().selection.levelId
  const { createNode, nodes } = useScene.getState()

  if (!currentLevelId || path.length < 2) {
    return null
  }
  const start = path[0]!
  const end = path[path.length - 1]!
  // A degenerate single-point-ish path (all clicks on one spot) is rejected
  // the same way a too-short straight segment is.
  if (!isSegmentLongEnough(start, end) && path.length < 3) {
    return null
  }

  const fenceCount = Object.values(nodes).filter((node) => node.type === 'fence').length
  const defaults = useEditor.getState().toolDefaults.fence ?? {}
  const fence = FenceNode.parse({
    ...defaults,
    name: `Fence ${fenceCount + 1}`,
    start,
    end,
    path,
    tangents,
  })

  createNode(fence, currentLevelId)
  sfxEmitter.emit('sfx:structure-build')

  return fence
}
