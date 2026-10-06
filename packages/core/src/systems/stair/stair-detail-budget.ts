import type { StairNode, StairSegmentNode } from '../../schema'
import {
  arcStairConstructionDetailCost,
  stairConstructionError,
  straightStairConstructionDetailCost,
} from './stair-construction'
import { stairContinuousRailCost } from './stair-rail-budget'

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
  const continuous =
    segments.some((segment) => segment.winder) ||
    stair.railingPath === 'continuous' ||
    stair.railingStyle === 'glass' ||
    stair.railingStyle === 'metal'
  if (
    (continuous || stair.handrail) &&
    (!Number.isFinite(stairContinuousRailCost(stair, segments)) ||
      stairContinuousRailCost(stair, segments) > STAIR_DETAIL_SURFACE_BUDGET)
  )
    return {
      status: 'unresolved' as const,
      error:
        'Continuous stair guards exceed the 10,000-component computation budget. The authored dimensions are preserved.',
      budget: STAIR_DETAIL_SURFACE_BUDGET,
    }
  if (stair.railingMode !== 'none' && !continuous) {
    const sides = stair.railingMode === 'both' ? 2 : 1
    const reach = stair.railingTopReach ?? 0
    const guardParts =
      stair.stairType !== 'straight'
        ? // The arc guard now follows the shared ≤5° rail path with 0.127 m
          // pickets — the same geometry the continuous guard builds — so it is
          // bounded by the same cost rather than one picket per step.
          stairContinuousRailCost(stair, segments)
        : (stair.railingStyle ?? 'balusters') === 'balusters'
          ? // Pickets space by run (0.127 m) and newels by 1.2192 m; the rails
            // run per nosing. Bound each: 4 rail/corner parts per step, pitch
            // pickets and posts (with their through-caps) over the run.
            sides *
            ((segments.length
              ? segments
              : [
                  {
                    segmentType: 'stair' as const,
                    stepCount: stair.stepCount,
                    width: stair.width,
                    length: 3,
                  },
                ]
            ).reduce((sum, segment) => {
              const run = Math.max(segment.length, segment.width) + reach
              return (
                sum +
                (segment.segmentType === 'landing' ? 4 : 4 * segment.stepCount + 6) +
                Math.ceil(run / 0.127) +
                2 * (Math.ceil(run / 1.2192) + 2)
              )
            }, 0) +
              segments.length * 2 +
              2)
          : (stair.railingStyle ?? 'balusters') === 'cable'
            ? // Cable builds on the shared chassis: a flat cap follows every
              // nosing, posts stand by run, straight cable chords span each
              // consecutive post at every level, and a sleeve ends each run.
              // Bound each term by run (posts/cables), height (levels) and the
              // per-nosing cap, so a short dense flight is caught like the rest.
              sides *
              ((segments.length
                ? segments
                : [
                    {
                      segmentType: 'stair' as const,
                      stepCount: stair.stepCount,
                      width: stair.width,
                      length: 3,
                    },
                  ]
              ).reduce((sum, segment) => {
                const run = Math.max(segment.length, segment.width) + reach
                const levels = Math.ceil(stair.railingHeight / 0.0762) + 1
                const posts =
                  Math.ceil(run / 1.2192) +
                  2 +
                  (segment.segmentType === 'landing' ? 2 : segment.stepCount)
                const cap = segment.segmentType === 'landing' ? 4 : 2 * segment.stepCount + 4
                return sum + cap + 2 * posts + 3 * posts * levels + 2 * levels
              }, 0) +
                segments.length * 2 +
                2)
            : sides *
              (segments.length
                ? segments
                : [
                    {
                      width: stair.width,
                      length: 3,
                      stepCount: stair.stepCount,
                      segmentType: 'stair' as const,
                    },
                  ]
              ).reduce(
                (sum, segment) =>
                  sum +
                  // Post-and-rail follows every nosing, including extremely short treads.
                  (stair.railingStyle === 'post-and-rail'
                    ? segment.segmentType === 'landing'
                      ? 4
                      : 4 * segment.stepCount + 6
                    : stair.railingStyle === 'boards'
                      ? (segment.segmentType === 'landing' ? 8 : 2 * segment.stepCount + 4) *
                        (Math.ceil(stair.railingHeight / 0.2286) + 1)
                      : 0) +
                  // The smallest guard infill pitch is 76.2 mm; bound two landing edges and their parts.
                  Math.ceil(
                    (2 * (Math.max(segment.width, segment.length) + (stair.railingTopReach ?? 0))) /
                      0.0762,
                  ) *
                    3 +
                  Math.ceil(stair.railingHeight / 0.0762) * 2 +
                  20,
                0,
              )
    if (!Number.isFinite(guardParts) || guardParts > STAIR_DETAIL_SURFACE_BUDGET)
      return {
        status: 'unresolved' as const,
        error: `Detailed stair guards exceed the ${STAIR_DETAIL_SURFACE_BUDGET.toLocaleString('en-US')}-component computation budget. The authored dimensions are preserved.`,
        budget: STAIR_DETAIL_SURFACE_BUDGET,
      }
  }
  return { status: 'evaluated' as const, error: null, budget: STAIR_DETAIL_SURFACE_BUDGET }
}
