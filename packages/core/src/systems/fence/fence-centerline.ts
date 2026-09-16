import type { FenceNode } from '../../schema'
import {
  getWallCurveFrameAt,
  getWallCurveSampledLength,
  sampleWallCenterline,
} from '../wall/wall-curve'
import type { Point2D } from '../wall/wall-mitering'
import {
  getFenceSplineFrameAt,
  getFenceSplineLength,
  isSplineFence,
  sampleFenceSpline,
} from './fence-spline'

/**
 * Unified fence centerline accessors. A fence is either:
 *   - a spline fence (`path` of >= 2 control points) → smooth Catmull-Rom, or
 *   - a straight / single-arc fence (`start`/`end` + optional `curveOffset`).
 *
 * These wrappers branch on `isSplineFence` and return the SAME shapes the wall
 * arc helpers return, so every consumer (3D geometry, 2D floor-plan, length,
 * handles) can sample the centerline without caring which kind it is. Wall arc
 * math in `wall-curve.ts` is untouched — walls never carry a `path`.
 */

const DEFAULT_SPLINE_SAMPLE_SEGMENTS = 96

type CurveFrame = {
  point: Point2D
  tangent: Point2D
  normal: Point2D
}

export function getFenceCenterlineFrameAt(fence: FenceNode, t: number): CurveFrame {
  if (isSplineFence(fence) && fence.path) {
    return getFenceSplineFrameAt(fence.path, t, fence.tangents)
  }
  return getWallCurveFrameAt(fence, t)
}

export function sampleFenceCenterline(fence: FenceNode, segments?: number): Point2D[] {
  if (isSplineFence(fence) && fence.path) {
    // Spread the requested sample budget across the spans so a long path still
    // reads smoothly without exploding the point count.
    const spanCount = Math.max(1, fence.path.length - 1)
    const perSpan = Math.max(2, Math.ceil((segments ?? DEFAULT_SPLINE_SAMPLE_SEGMENTS) / spanCount))
    return sampleFenceSpline(fence.path, fence.tangents, perSpan)
  }
  return sampleWallCenterline(fence, segments)
}

export function getFenceCenterlineLength(fence: FenceNode, segments?: number): number {
  if (isSplineFence(fence) && fence.path) {
    const spanCount = Math.max(1, fence.path.length - 1)
    const perSpan = Math.max(2, Math.ceil((segments ?? DEFAULT_SPLINE_SAMPLE_SEGMENTS) / spanCount))
    return getFenceSplineLength(fence.path, fence.tangents, perSpan)
  }
  return getWallCurveSampledLength(fence, segments)
}
