import type { StairNode, StairSegmentNode } from '../../schema'
import { resolveStairArcDimensions } from './stair-layout'

/** Coarse work units bound path length, sampling and vertical repetition without
 * knowing any guard's sections or joinery. Builders own their member profiles. */
export function stairRailComplexity(stair: StairNode, segments: readonly StairSegmentNode[]) {
  const guards = stair.railingMode === 'none' ? 0 : stair.railingMode === 'both' ? 2 : 1
  const hands =
    !stair.handrail || stair.handrail.mode === 'none' ? 0 : stair.handrail.mode === 'both' ? 2 : 1
  if (!guards && !hands) return 0
  const arc = resolveStairArcDimensions(stair, 0)
  const length =
    stair.stairType !== 'straight'
      ? (Math.abs(arc.sweepAngle) + Math.abs(arc.landingSweep)) * arc.outerRadius
      : (segments.length ? segments : [{ width: stair.width, length: 3 }]).reduce(
          (sum, segment) =>
            sum +
            ('winder' in segment && segment.winder
              ? Math.PI * (segment.winder.innerGap + segment.width)
              : segment.length + segment.width),
          0,
        )
  const vertices = stairRailPathVertexBound(stair, segments)
  const guardWork =
    guards *
    (vertices + Math.ceil((length + (stair.railingTopReach ?? 0)) * 10)) *
    Math.max(1, Math.ceil(stair.railingHeight))
  const handWork =
    hands *
    (vertices +
      Math.ceil(length) +
      Math.ceil(stair.handrail?.bottom?.extension ?? 0) +
      Math.ceil(stair.handrail?.top?.extension ?? 0))
  return guardWork + handWork
}

export function stairRailPathVertexBound(stair: StairNode, segments: readonly StairSegmentNode[]) {
  const arc = resolveStairArcDimensions(stair, 0)
  return stair.stairType !== 'straight'
    ? Math.ceil((Math.abs(arc.sweepAngle) + Math.abs(arc.landingSweep)) / (Math.PI / 36)) + 2
    : segments.reduce((sum, segment) => sum + (segment.winder ? segment.stepCount + 2 : 0), 0) +
        8 * Math.max(1, segments.length) +
        16 *
          segments.length *
          segments.filter((segment) => segment.segmentType === 'landing').length
}
