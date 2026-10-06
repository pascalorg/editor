import { describe, expect, test } from 'bun:test'
import { resolveStairRailPaths, StairNode } from '@pascal-app/core'
import type { GuardBox } from './guard-path'
import { buildMetalGuard } from './metal-guard'

const UP_ISH = (box: GuardBox) => box.direction[1] > 0.9
/** A slim steel post stands plumb at a 0.04 m square section. */
const isPost = (box: GuardBox) =>
  UP_ISH(box) && Math.abs(box.size[0] - 0.04) < 1e-6 && Math.abs(box.size[1] - 0.04) < 1e-6
/** A baseplate is a thin flat plate (0.1 across, 0.008 thick) standing plumb. */
const isBaseplate = (box: GuardBox) =>
  UP_ISH(box) && Math.abs(box.size[0] - 0.1) < 1e-6 && Math.abs(box.size[1] - 0.008) < 1e-6
/** A slender baluster stands plumb at a 0.016 m square section. */
const isInfill = (box: GuardBox) =>
  UP_ISH(box) && Math.abs(box.size[0] - 0.016) < 1e-6 && Math.abs(box.size[1] - 0.016) < 1e-6
/** The flat top rail runs along the path, 0.05 across and 0.03 thick. */
const isTopRun = (box: GuardBox) =>
  !UP_ISH(box) && Math.abs(box.size[0] - 0.05) < 1e-6 && Math.abs(box.size[1] - 0.03) < 1e-6
/** The slimmer bottom rail runs along the path, 0.038 across and 0.025 thick. */
const isBottomRun = (box: GuardBox) =>
  !UP_ISH(box) && Math.abs(box.size[0] - 0.038) < 1e-6 && Math.abs(box.size[1] - 0.025) < 1e-6
/** A corner block is the top rail's cube (0.05) closing a plan corner. */
const isTopBlock = (box: GuardBox) =>
  Math.abs(box.size[0] - box.size[1]) < 1e-6 &&
  Math.abs(box.size[1] - box.size[2]) < 1e-6 &&
  Math.abs(box.size[0] - 0.05) < 1e-6
const finite = (box: GuardBox) =>
  [...box.center, ...box.size, ...box.direction].every(Number.isFinite)

function straightRun(length: number, rise: number, count: number): [number, number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return [length * t, rise * t, 0] as [number, number, number]
  })
}

describe('buildMetalGuard', () => {
  test('stands slim posts on baseplates at both ends with infill between two rails', () => {
    const boxes = buildMetalGuard(straightRun(3, 1.5, 2), {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    expect(boxes.every(finite)).toBe(true)
    const posts = boxes.filter(isPost)
    expect(posts).toHaveLength(2)
    const postXs = posts.map((p) => p.center[0]).sort((a, b) => a - b)
    expect(postXs[0]!).toBeCloseTo(0)
    expect(postXs[1]!).toBeCloseTo(3)
    // Each post gets a mounting baseplate; a top and bottom rail follow the edge.
    expect(boxes.filter(isBaseplate)).toHaveLength(2)
    expect(boxes.filter(isTopRun)).toHaveLength(1)
    expect(boxes.filter(isBottomRun)).toHaveLength(1)
    expect(boxes.filter(isInfill).length).toBeGreaterThan(0)
  })

  test('posts stand on the nosing line on their baseplates, never sunk below it', () => {
    const boxes = buildMetalGuard(straightRun(3, 0, 2), {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    for (const post of boxes.filter(isPost)) {
      const foot = post.center[1] - post.size[2] / 2
      expect(foot).toBeCloseTo(0)
    }
    for (const plate of boxes.filter(isBaseplate)) {
      const underside = plate.center[1] - plate.size[1] / 2
      expect(underside).toBeCloseTo(0)
    }
  })

  test('the top rail top sits at the guard height, above the bottom rail', () => {
    const boxes = buildMetalGuard(straightRun(3, 0, 2), {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    const top = boxes.find(isTopRun)!
    const bottom = boxes.find(isBottomRun)!
    expect(top.center[1] + 0.03 / 2).toBeCloseTo(0.92)
    expect(bottom.center[1]).toBeLessThan(top.center[1])
  })

  test('spaces infill and posts by run length, not by tessellation', () => {
    const options = { railHeight: 0.92, postSpacing: 1.2192 } as const
    const coarse = buildMetalGuard(straightRun(4, 2, 2), options)
    const fine = buildMetalGuard(straightRun(4, 2, 61), options)
    expect(fine.filter(isPost)).toHaveLength(coarse.filter(isPost).length)
    expect(fine.filter(isInfill)).toHaveLength(coarse.filter(isInfill).length)
    expect(coarse.filter(isPost).length).toBeLessThan(8)
    expect(fine.every(finite)).toBe(true)
  })

  test('infill never leaves a clear gap over the 4 in (0.1016 m) sphere', () => {
    const boxes = buildMetalGuard(straightRun(3, 0, 2), {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    const xs = boxes
      .filter(isInfill)
      .map((box) => box.center[0])
      .sort((a, b) => a - b)
    expect(xs.length).toBeGreaterThan(1)
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]! - xs[i - 1]! - 0.016).toBeLessThanOrEqual(0.1016 + 1e-9)
  })

  test('topPost:false drops the top post and reach runs the rails past it', () => {
    const path = straightRun(3, 1.5, 4)
    const withTop = buildMetalGuard(path, { railHeight: 0.92 })
    const noTop = buildMetalGuard(path, { railHeight: 0.92, topPost: false, reach: 0.3 })
    expect(noTop.filter(isPost)).toHaveLength(withTop.filter(isPost).length - 1)
    const maxTopX = (boxes: GuardBox[]) =>
      Math.max(...boxes.filter(isTopRun).map((box) => box.center[0]))
    expect(maxTopX(noTop)).toBeGreaterThan(3)
    expect(maxTopX(withTop)).toBeLessThanOrEqual(3 + 1e-6)
  })

  test('a flat L-turn gets corner blocks; a collinear bend does not bulge one', () => {
    const corner = buildMetalGuard(
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 0, 2],
      ],
      { railHeight: 0.92 },
    )
    const collinear = buildMetalGuard(
      [
        [0, 0, 0],
        [2, 0, 0],
        [4, 0, 0],
      ],
      { railHeight: 0.92 },
    )
    expect(corner.filter(isTopBlock).length).toBeGreaterThan(0)
    expect(collinear.filter(isTopBlock)).toHaveLength(0)
  })

  test('a purely vertical path (a zero-radius winder pivot) stands one plumb post on a plate', () => {
    const boxes = buildMetalGuard(
      [
        [0, 0, 0],
        [0, 1.2, 0],
      ],
      { railHeight: 0.92, postSpacing: 1.2192 },
    )
    const posts = boxes.filter(isPost)
    expect(posts).toHaveLength(1)
    expect(boxes.filter(isBaseplate)).toHaveLength(1)
    // The pivot post stands plumb over the inner edge: no XZ offset.
    expect(posts[0]!.center[0]).toBeCloseTo(0)
    expect(posts[0]!.center[2]).toBeCloseTo(0)
    expect(posts[0]!.size[2]).toBeGreaterThan(1.2 + 0.92 - 0.04)
    expect(boxes.every(finite)).toBe(true)
  })

  test('postThrough adds a cap over each post top', () => {
    const path = straightRun(3, 1.5, 4)
    const plain = buildMetalGuard(path, { railHeight: 0.92 })
    const through = buildMetalGuard(path, { railHeight: 0.92, postThrough: true })
    // A post cap is a plumb box wider than the 0.04 post but thin.
    const postCaps = (boxes: GuardBox[]) =>
      boxes.filter(
        (box) => UP_ISH(box) && box.size[0] > 0.04 && box.size[0] < 0.1 && box.size[1] < 0.03,
      )
    expect(postCaps(plain)).toHaveLength(0)
    expect(postCaps(through)).toHaveLength(plain.filter(isPost).length)
  })
})

describe('arc stair metal guard — the curved/spiral pipeline', () => {
  // The renderer builds the curved/spiral metal guard this way: the shared
  // analytic path (`resolveStairRailPaths`), then buildMetalGuard, so a spiral
  // reads as the same metal guard as a straight flight rather than a per-step
  // facet or a balusters fallback.
  const spiral = StairNode.parse({
    stairType: 'spiral',
    stepCount: 14,
    sweepAngle: (249 * Math.PI) / 180,
    totalRise: 3,
    width: 0.72,
    innerRadius: 1.18,
    railingMode: 'both',
    railingStyle: 'metal',
  })

  test('adds interior posts and rails along the sampled sweep, not one per step', () => {
    const path = resolveStairRailPaths(spiral, {}).find((p) => p.side === 'right')!
    const boxes = buildMetalGuard(path.points, { railHeight: 0.92, postSpacing: 1.2192 })
    expect(boxes.every(finite)).toBe(true)
    expect(boxes.filter(isPost).length).toBeGreaterThan(2)
    expect(boxes.filter(isPost).length).toBeLessThan(path.points.length)
    // The top rail follows the curve as many short segments.
    expect(boxes.filter(isTopRun).length).toBeGreaterThan(spiral.stepCount)
  })

  test('spaces infill by run along the arc with no gap over the 4 in sphere', () => {
    const path = resolveStairRailPaths(spiral, {}).find((p) => p.side === 'right')!
    const boxes = buildMetalGuard(path.points, {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    const radius = Math.hypot(path.points[0]![0], path.points[0]![2])
    const stationArc = boxes
      .filter(isInfill)
      .map((box) => Math.atan2(box.center[2], box.center[0]) * radius)
      .sort((a, b) => a - b)
    expect(stationArc.length).toBeGreaterThan(spiral.stepCount)
    for (let i = 1; i < stationArc.length; i++)
      expect(stationArc[i]! - stationArc[i - 1]! - 0.016).toBeLessThanOrEqual(0.1016 + 1e-6)
  })
})
