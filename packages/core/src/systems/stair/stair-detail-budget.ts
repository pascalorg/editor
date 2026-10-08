import type { StairNode, StairSegmentNode } from '../../schema'
import {
  arcStairConstructionDetailCost,
  stairConstructionError,
  straightStairConstructionDetailCost,
} from './stair-construction'
import { stairRailComplexity } from './stair-rail-budget'

export const STAIR_DETAIL_SURFACE_BUDGET = 10_000

export function stairSegmentDetailError(
  segment: Pick<StairSegmentNode, 'segmentType' | 'stepCount'>,
): string | null {
  if (segment.segmentType === 'landing') return null
  if (!Number.isSafeInteger(segment.stepCount) || segment.stepCount < 1)
    return 'Detailed stair geometry requires a positive whole riser count.'
  if (segment.stepCount > STAIR_DETAIL_SURFACE_BUDGET)
    return `Detailed stair geometry exceeds the ${STAIR_DETAIL_SURFACE_BUDGET.toLocaleString('en-US')}-surface computation budget. The authored count is preserved.`
  return null
}

export function measureStairDetail(stair: StairNode, segments: readonly StairSegmentNode[]) {
  const railWidth =
    stair.stairType === 'straight' && segments.length
      ? Math.min(
          ...segments
            .filter((segment) => segment.visible !== false)
            .map((segment) => segment.width),
        )
      : stair.width
  const railError =
    stair.handrail &&
    stair.handrail.mode !== 'none' &&
    stair.handrail.offset + stair.handrail.diameter / 2 > railWidth
      ? 'The handrail inset and radius must fit within the stair width.'
      : (stair.railingPath === 'continuous' ||
            stair.railingStyle === 'glass' ||
            stair.railingStyle === 'metal') &&
          stair.railingMode !== 'none' &&
          !(stair.railingHeight > 0)
        ? 'Guard height must be positive.'
        : null
  const constructionError = railError ?? stairConstructionError(stair, segments)
  if (constructionError)
    return {
      status: 'unresolved' as const,
      error: constructionError,
      budget: STAIR_DETAIL_SURFACE_BUDGET,
    }
  const counts =
    stair.stairType !== 'straight' || !segments.length
      ? [{ segmentType: 'stair' as const, stepCount: stair.stepCount, construction: undefined }]
      : segments
  for (const segment of counts) {
    const error = stairSegmentDetailError(segment)
    if (error) return { status: 'unresolved' as const, error, budget: STAIR_DETAIL_SURFACE_BUDGET }
  }
  const surfaces =
    stair.stairType !== 'straight'
      ? arcStairConstructionDetailCost(stair)
      : counts.reduce(
          (sum, segment) =>
            sum +
            straightStairConstructionDetailCost(segment, stair) *
              ('winder' in segment && segment.winder ? 2 : 1),
          0,
        )

  if (surfaces > STAIR_DETAIL_SURFACE_BUDGET)
    return {
      status: 'unresolved' as const,
      error: `Detailed stair geometry exceeds the ${STAIR_DETAIL_SURFACE_BUDGET.toLocaleString('en-US')}-surface computation budget. The authored counts are preserved.`,
      budget: STAIR_DETAIL_SURFACE_BUDGET,
    }
  const railWork = stairRailComplexity(stair, segments)
  if (!Number.isFinite(railWork) || railWork > STAIR_DETAIL_SURFACE_BUDGET)
    return {
      status: 'unresolved' as const,
      error:
        'Detailed stair rails exceed the 10,000-unit computation budget. The authored dimensions are preserved.',
      budget: STAIR_DETAIL_SURFACE_BUDGET,
    }
  return { status: 'evaluated' as const, error: null, budget: STAIR_DETAIL_SURFACE_BUDGET }
}
