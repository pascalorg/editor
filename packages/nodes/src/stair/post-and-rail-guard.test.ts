import { describe, expect, test } from 'bun:test'
import { resolveStairRailPaths, StairNode } from '@pascal-app/core'
import type { GuardBox } from './guard-path'
import { buildPostAndRailGuard } from './post-and-rail-guard'

const UP_ISH = (box: GuardBox) => box.direction[1] > 0.9
/** A 4x4 deck post stands plumb at a 0.0889 m square section. */
const isPost = (box: GuardBox) =>
  UP_ISH(box) && Math.abs(box.size[0] - 0.0889) < 1e-6 && Math.abs(box.size[1] - 0.0889) < 1e-6
/** A 2x2 picket stands plumb at a 0.0381 m square section. */
const isPicket = (box: GuardBox) =>
  UP_ISH(box) && Math.abs(box.size[0] - 0.0381) < 1e-6 && Math.abs(box.size[1] - 0.0381) < 1e-6
/** The flat 2x6 cap runs along the path, 0.1397 m across and 0.0381 m thick. */
const isCapRun = (box: GuardBox) =>
  !UP_ISH(box) && Math.abs(box.size[0] - 0.1397) < 1e-6 && Math.abs(box.size[1] - 0.0381) < 1e-6
/** A 2x4 rail (top or bottom) runs along the path, 0.0381 across, 0.0889 deep on edge. */
const isRailRun = (box: GuardBox) =>
  !UP_ISH(box) && Math.abs(box.size[0] - 0.0381) < 1e-6 && Math.abs(box.size[1] - 0.0889) < 1e-6
/** A corner fitting block is a cube at the cap section (0.1397), not a post. */
const isCapBlock = (box: GuardBox) =>
  Math.abs(box.size[0] - box.size[1]) < 1e-6 &&
  Math.abs(box.size[1] - box.size[2]) < 1e-6 &&
  Math.abs(box.size[0] - 0.1397) < 1e-6
const finite = (box: GuardBox) =>
  [...box.center, ...box.size, ...box.direction].every(Number.isFinite)

function straightRun(length: number, rise: number, count: number): [number, number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return [length * t, rise * t, 0] as [number, number, number]
  })
}

describe('buildPostAndRailGuard', () => {
  test('stands 4x4 posts at both ends with pickets between three rails', () => {
    const boxes = buildPostAndRailGuard(straightRun(3, 1.5, 2), {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    expect(boxes.every(finite)).toBe(true)
    const posts = boxes.filter(isPost)
    expect(posts).toHaveLength(2)
    const postXs = posts.map((p) => p.center[0]).sort((a, b) => a - b)
    expect(postXs[0]!).toBeCloseTo(0)
    expect(postXs[1]!).toBeCloseTo(3)
    // A flat cap and two 2x4 rails follow the single straight edge.
    expect(boxes.filter(isCapRun)).toHaveLength(1)
    expect(boxes.filter(isRailRun)).toHaveLength(2)
    expect(boxes.filter(isPicket).length).toBeGreaterThan(0)
  })

  test('the cap sits on top and the three rails stack bottom to top', () => {
    const boxes = buildPostAndRailGuard(straightRun(3, 0, 2), {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    const cap = boxes.find(isCapRun)!
    const rails = boxes
      .filter(isRailRun)
      .map((r) => r.center[1])
      .sort((a, b) => a - b)
    // Cap top sits at the rail height; the two rails are below it.
    expect(cap.center[1] + 0.0381 / 2).toBeCloseTo(0.92)
    expect(rails[0]!).toBeLessThan(rails[1]!)
    expect(rails[1]!).toBeLessThan(cap.center[1])
  })

  test('spaces pickets and posts by run length, not by tessellation', () => {
    const options = { railHeight: 0.92, postSpacing: 1.2192 } as const
    const coarse = buildPostAndRailGuard(straightRun(4, 2, 2), options)
    const fine = buildPostAndRailGuard(straightRun(4, 2, 61), options)
    expect(fine.filter(isPost)).toHaveLength(coarse.filter(isPost).length)
    expect(fine.filter(isPicket)).toHaveLength(coarse.filter(isPicket).length)
    expect(coarse.filter(isPost).length).toBeLessThan(8)
    expect(fine.every(finite)).toBe(true)
  })

  test('pickets never leave a clear gap over the 4 in (0.1016 m) sphere', () => {
    const boxes = buildPostAndRailGuard(straightRun(3, 0, 2), {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    const xs = boxes
      .filter(isPicket)
      .map((box) => box.center[0])
      .sort((a, b) => a - b)
    expect(xs.length).toBeGreaterThan(1)
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]! - xs[i - 1]! - 0.0381).toBeLessThanOrEqual(0.1016 + 1e-9)
  })

  test('topPost:false drops the top post and reach runs the rails past it', () => {
    const path = straightRun(3, 1.5, 4)
    const withTop = buildPostAndRailGuard(path, { railHeight: 0.92 })
    const noTop = buildPostAndRailGuard(path, { railHeight: 0.92, topPost: false, reach: 0.3 })
    expect(noTop.filter(isPost)).toHaveLength(withTop.filter(isPost).length - 1)
    const maxCapX = (boxes: GuardBox[]) =>
      Math.max(...boxes.filter(isCapRun).map((box) => box.center[0]))
    expect(maxCapX(noTop)).toBeGreaterThan(3)
    expect(maxCapX(withTop)).toBeLessThanOrEqual(3 + 1e-6)
  })

  test('a flat L-turn gets cap corner blocks; a collinear bend does not bulge one', () => {
    const corner = buildPostAndRailGuard(
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 0, 2],
      ],
      { railHeight: 0.92 },
    )
    const collinear = buildPostAndRailGuard(
      [
        [0, 0, 0],
        [2, 0, 0],
        [4, 0, 0],
      ],
      { railHeight: 0.92 },
    )
    expect(corner.filter(isCapBlock).length).toBeGreaterThan(0)
    expect(collinear.filter(isCapBlock)).toHaveLength(0)
  })

  test('a purely vertical path (a zero-radius winder pivot) stands one plumb 4x4', () => {
    const boxes = buildPostAndRailGuard(
      [
        [0, 0, 0],
        [0, 1.2, 0],
      ],
      { railHeight: 0.92, postSpacing: 1.2192 },
    )
    const posts = boxes.filter(isPost)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.size[2]).toBeGreaterThan(1.2 + 0.92 - 0.0381)
    expect(boxes.every(finite)).toBe(true)
  })

  test('postThrough adds a cap over each post top', () => {
    const path = straightRun(3, 1.5, 4)
    const plain = buildPostAndRailGuard(path, { railHeight: 0.92 })
    const through = buildPostAndRailGuard(path, { railHeight: 0.92, postThrough: true })
    // A post cap is a plumb-ish box wider than the 4x4 post but not a run.
    const postCaps = (boxes: GuardBox[]) =>
      boxes.filter((box) => UP_ISH(box) && box.size[0] > 0.0889 && box.size[1] < 0.03)
    expect(postCaps(plain)).toHaveLength(0)
    expect(postCaps(through)).toHaveLength(plain.filter(isPost).length)
  })
})

describe('arc stair post-and-rail guard — the curved/spiral pipeline', () => {
  // The renderer builds the curved/spiral post-and-rail guard this way: the
  // shared analytic path (`resolveStairRailPaths`), then buildPostAndRailGuard,
  // so a spiral reads as the same deck guard as a straight flight rather than a
  // per-step facet or a balusters fallback.
  const spiral = StairNode.parse({
    stairType: 'spiral',
    stepCount: 14,
    sweepAngle: (249 * Math.PI) / 180,
    totalRise: 3,
    width: 0.72,
    innerRadius: 1.18,
    railingMode: 'both',
    railingStyle: 'post-and-rail',
  })

  test('adds interior posts and a cap along the sampled sweep, not one per step', () => {
    const path = resolveStairRailPaths(spiral, {}).find((p) => p.side === 'right')!
    const boxes = buildPostAndRailGuard(path.points, { railHeight: 0.92, postSpacing: 1.2192 })
    expect(boxes.every(finite)).toBe(true)
    // Interior posts by run (far fewer than one per vertex of the dense arc).
    expect(boxes.filter(isPost).length).toBeGreaterThan(2)
    expect(boxes.filter(isPost).length).toBeLessThan(path.points.length)
    // A continuous cap follows the curve as many short segments.
    expect(boxes.filter(isCapRun).length).toBeGreaterThan(spiral.stepCount)
  })

  test('spaces pickets by run along the arc with no gap over the 4 in sphere', () => {
    const path = resolveStairRailPaths(spiral, {}).find((p) => p.side === 'right')!
    // Ends-only posts isolate the picket pitch; interior posts would leave a
    // legitimate wider gap they fill themselves (the renderer adds those back).
    const boxes = buildPostAndRailGuard(path.points, {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    const radius = Math.hypot(path.points[0]![0], path.points[0]![2])
    const stationArc = boxes
      .filter(isPicket)
      .map((picket) => Math.atan2(picket.center[2], picket.center[0]) * radius)
      .sort((a, b) => a - b)
    expect(stationArc.length).toBeGreaterThan(spiral.stepCount)
    for (let i = 1; i < stationArc.length; i++)
      expect(stationArc[i]! - stationArc[i - 1]! - 0.0381).toBeLessThanOrEqual(0.1016 + 1e-6)
  })
})
