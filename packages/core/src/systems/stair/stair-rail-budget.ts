import type { StairNode, StairSegmentNode } from '../../schema'
import { resolveStairArcDimensions } from './stair-layout'

export function stairContinuousRailCost(stair: StairNode, segments: readonly StairSegmentNode[]) {
  const guardSides = stair.railingMode === 'none' ? 0 : stair.railingMode === 'both' ? 2 : 1
  const handSides =
    !stair.handrail || stair.handrail.mode === 'none' ? 0 : stair.handrail.mode === 'both' ? 2 : 1
  if (!guardSides && !handSides) return 0
  const arc = resolveStairArcDimensions(stair, 0)
  const length =
    stair.stairType !== 'straight'
      ? (Math.abs(arc.sweepAngle) + Math.abs(arc.landingSweep)) * arc.outerRadius
      : (segments.length ? segments : [{ width: stair.width, length: 3 }]).reduce(
          (sum, segment) =>
            sum +
            2 *
              (segment.width +
                ('winder' in segment && segment.winder
                  ? 2 * (segment.winder.innerGap + segment.width)
                  : segment.length)),
          0,
        )
  const vertices = stairRailPathVertexBound(stair, segments)
  const handrailCost =
    handSides * (vertices + (stair.handrail?.bottom ? 2 : 0) + (stair.handrail?.top ? 2 : 0))
  if (stair.railingStyle === 'cable') {
    // Cable builds on the shared path chassis: a cap following the path (bounded
    // by `vertices`), posts spaced by run, straight cable chords between every
    // consecutive post at each level, and a swage sleeve at each terminal post.
    // Posts and cables scale with the run (and `reach`); levels with the height.
    const reach = stair.railingTopReach ?? 0
    const levels = Math.ceil(stair.railingHeight / 0.0762) + 1
    const posts = vertices + Math.ceil((length + reach) / 1.2192)
    const corners = stair.stairType === 'straight' ? 4 * Math.max(1, segments.length) : 2
    const guardCore = vertices + posts * 2 + posts * levels + 2 * levels + 2 * corners * levels + 2
    return (guardSides ? guardSides * guardCore : 0) + handrailCost
  }
  if (stair.railingStyle === 'boards') {
    // Boards builds on the shared chassis: a flat cap and a stack of plank
    // courses, each following the path as a bar per edge plus a corner block,
    // with posts spaced by run (and their optional through-caps). Courses scale
    // with the height; bars and corner blocks with the path's vertices.
    const reach = stair.railingTopReach ?? 0
    const courses = Math.ceil(stair.railingHeight / (0.1397 + 0.0889)) + 1
    const posts = vertices + Math.ceil((length + reach) / 1.2192) + 1
    const guardCore = 2 * vertices * (courses + 1) + 2 * posts
    return (guardSides ? guardSides * guardCore : 0) + handrailCost
  }
  if (stair.railingStyle === 'glass') {
    // Glass builds on the shared chassis: a flat cap following the path, posts
    // spaced by run (and `reach`), one flat pane per bay between consecutive
    // posts, and point clamps fixing each pane's edges. Panes and clamps scale
    // with the posts; the cap and its corner blocks with the path's vertices.
    const reach = stair.railingTopReach ?? 0
    const posts = vertices + Math.ceil((length + reach) / 1.2192) + 1
    const guardCore = 2 * vertices + posts * 7 + 4
    return (guardSides ? guardSides * guardCore : 0) + handrailCost
  }
  if (stair.railingStyle === 'metal') {
    // Metal builds on the shared chassis: a top and bottom rail following the
    // path (bars and corner blocks bounded by `vertices`), posts spaced by run
    // each with a baseplate and an optional through-cap, and slender plumb
    // balusters pitched by run. Posts and infill scale with the run (and
    // `reach`); the rails and corner blocks with the path's vertices.
    const reach = stair.railingTopReach ?? 0
    const posts = vertices + Math.ceil((length + reach) / 1.2192) + 1
    const infill = Math.ceil((length + reach) / 0.11) + vertices
    const guardCore = 4 * vertices + posts * 3 + infill + 2
    return (guardSides ? guardSides * guardCore : 0) + handrailCost
  }
  const infill = Math.ceil(length / 0.127)
  const posts = vertices + Math.ceil(length / 1.2192)
  return (guardSides ? guardSides * (vertices * 5 + infill + posts * 2 + 2) : 0) + handrailCost
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
