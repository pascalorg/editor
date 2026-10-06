import { describe, expect, test } from 'bun:test'
import { resolveStairRailPaths, StairNode } from '@pascal-app/core'
import { buildBalusterGuard } from './baluster-guard'
import type { GuardBox } from './guard-path'

const UP_ISH = (box: GuardBox) => box.direction[1] > 0.9
const isNewel = (box: GuardBox) => UP_ISH(box) && box.size[0] > 0.07 && box.size[0] < 0.09
const isPicket = (box: GuardBox) => UP_ISH(box) && Math.abs(box.size[0] - 0.032) < 1e-3
/** A corner fitting block is a small cube (the rail section), not a newel or picket. */
const isBlock = (box: GuardBox) =>
  Math.abs(box.size[0] - box.size[1]) < 1e-6 &&
  Math.abs(box.size[1] - box.size[2]) < 1e-6 &&
  box.size[0] < 0.07
const finite = (box: GuardBox) =>
  [...box.center, ...box.size, ...box.direction].every(Number.isFinite)

/** A straight run from the origin, split into `count` even collinear points. */
function straightRun(length: number, rise: number, count: number): [number, number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return [length * t, rise * t, 0] as [number, number, number]
  })
}

describe('buildBalusterGuard', () => {
  test('stands a newel at both ends with pickets between two rails', () => {
    const boxes = buildBalusterGuard(straightRun(3, 1.5, 2), {
      railHeight: 0.92,
      pickets: 0.1016,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    expect(boxes.every(finite)).toBe(true)
    const newels = boxes.filter(isNewel)
    expect(newels).toHaveLength(2)
    const newelXs = newels.map((newel) => newel.center[0]).sort((a, b) => a - b)
    expect(newelXs[0]!).toBeCloseTo(0)
    expect(newelXs[1]!).toBeCloseTo(3)
    // Two rails (top + bottom) following a single straight edge.
    const rails = boxes.filter((box) => box.direction[0] > 0.5)
    expect(rails).toHaveLength(2)
  })

  test('spaces pickets and newels by run length, not by tessellation', () => {
    const options = {
      railHeight: 0.92,
      pickets: 0.1016,
      postSpacing: 1.2192,
    } as const
    const coarse = buildBalusterGuard(straightRun(4, 2, 2), options)
    const fine = buildBalusterGuard(straightRun(4, 2, 61), options)
    // The 60x denser polyline is the same guard: a newel at every vertex would
    // explode the count — it must track the run instead.
    expect(fine.filter(isNewel)).toHaveLength(coarse.filter(isNewel).length)
    expect(fine.filter(isPicket)).toHaveLength(coarse.filter(isPicket).length)
    expect(coarse.filter(isNewel).length).toBeLessThan(8)
    expect(coarse.filter(isPicket).length).toBeGreaterThan(coarse.filter(isNewel).length)
    expect(fine.every(finite)).toBe(true)
  })

  test('topPost:false drops the top newel and reach runs the rails past it', () => {
    const path = straightRun(3, 1.5, 4)
    const withTop = buildBalusterGuard(path, { railHeight: 0.92, pickets: 0.1016 })
    const noTop = buildBalusterGuard(path, {
      railHeight: 0.92,
      pickets: 0.1016,
      topPost: false,
      reach: 0.3,
    })
    expect(noTop.filter(isNewel)).toHaveLength(withTop.filter(isNewel).length - 1)
    const maxX = (boxes: GuardBox[]) => Math.max(...boxes.map((box) => box.center[0]))
    expect(maxX(noTop)).toBeGreaterThan(3)
    expect(maxX(withTop)).toBeLessThanOrEqual(3 + 1e-6)
  })

  test('a flat L-turn gets corner blocks; a collinear bend does not bulge one', () => {
    const options = { railHeight: 0.92, pickets: 0.1016 } as const
    const corner = buildBalusterGuard(
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 0, 2],
      ],
      options,
    )
    const collinear = buildBalusterGuard(
      [
        [0, 0, 0],
        [2, 0, 0],
        [4, 0, 0],
      ],
      options,
    )
    expect(corner.filter(isBlock).length).toBeGreaterThan(0)
    expect(collinear.filter(isBlock)).toHaveLength(0)
  })

  test('an evenly turning spiral adds no corner blocks even past the turn threshold', () => {
    // 45° per step is well over the corner threshold, but every vertex turns
    // the same way, so the helix must stay smooth rather than bulge a block.
    const spiral = Array.from({ length: 9 }, (_, i) => {
      const angle = (Math.PI / 4) * i
      return [Math.cos(angle), i * 0.2, Math.sin(angle)] as [number, number, number]
    })
    const boxes = buildBalusterGuard(spiral, { railHeight: 0.92, pickets: 0.1016 })
    expect(boxes.filter(isBlock)).toHaveLength(0)
    expect(boxes.every(finite)).toBe(true)
  })

  test('a purely vertical path (a zero-radius winder pivot) stands one plumb newel', () => {
    const boxes = buildBalusterGuard(
      [
        [0, 0, 0],
        [0, 1.2, 0],
      ],
      { railHeight: 0.92, pickets: 0.1016, postSpacing: 1.2192 },
    )
    const newels = boxes.filter(isNewel)
    expect(newels).toHaveLength(1)
    expect(newels[0]!.direction[1]).toBeGreaterThan(0.9)
    // Spans the 1.2 m rise plus the guard height above it.
    expect(newels[0]!.size[2]).toBeGreaterThan(1.2 + 0.92)
    expect(boxes.every(finite)).toBe(true)
  })

  test('pickets never leave a clear gap over 0.1016 m, however coarse the pitch', () => {
    const boxes = buildBalusterGuard(straightRun(2, 0, 2), { railHeight: 0.92, pickets: 10 })
    const xs = boxes
      .filter(isPicket)
      .map((box) => box.center[0])
      .sort((a, b) => a - b)
    expect(xs.length).toBeGreaterThan(1)
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]! - xs[i - 1]! - 0.032).toBeLessThanOrEqual(0.1016 + 1e-9)
  })

  test('postThrough adds a cap over each newel', () => {
    const path = straightRun(3, 1.5, 4)
    const plain = buildBalusterGuard(path, { railHeight: 0.92, pickets: 0.1016 })
    const through = buildBalusterGuard(path, {
      railHeight: 0.92,
      pickets: 0.1016,
      postThrough: true,
    })
    const caps = (boxes: GuardBox[]) => boxes.filter((box) => UP_ISH(box) && box.size[0] > 0.1)
    expect(caps(plain)).toHaveLength(0)
    expect(caps(through)).toHaveLength(plain.filter(isNewel).length)
  })
})

/** The horizontal turn (radians) at an interior vertex of a rail path. */
function turnAt(points: readonly [number, number, number][], i: number): number {
  const dir = (a: [number, number, number], b: [number, number, number]) => {
    const dx = b[0] - a[0],
      dz = b[2] - a[2],
      len = Math.hypot(dx, dz)
    return len < 1e-9 ? null : ([dx / len, dz / len] as const)
  }
  const incoming = dir(points[i - 1]!, points[i]!),
    outgoing = dir(points[i]!, points[i + 1]!)
  if (!incoming || !outgoing) return 0
  return Math.acos(Math.min(1, Math.max(-1, incoming[0] * outgoing[0] + incoming[1] * outgoing[1])))
}

describe('arc stair guard — the curved/spiral renderer pipeline', () => {
  // The renderer builds its curved/spiral guard exactly this way: the shared
  // analytic path (`resolveStairRailPaths`), then `buildBalusterGuard` with a
  // metre pitch. These guard against the regression that drove this work — a
  // per-step polyline that faceted the arc and dropped a picket per step.
  const spiral = StairNode.parse({
    stairType: 'spiral',
    stepCount: 14,
    sweepAngle: (249 * Math.PI) / 180,
    totalRise: 3,
    width: 0.72,
    innerRadius: 1.18,
    railingMode: 'both',
  })

  test('samples the sweep at ≤5° so the handrail reads as a curve, not facets', () => {
    const paths = resolveStairRailPaths(spiral, {})
    expect(paths).toHaveLength(2)
    for (const path of paths) {
      // Far denser than one vertex per step (14): ≥ sweep / 5°.
      expect(path.points.length).toBeGreaterThan(spiral.stepCount * 3)
      for (let i = 1; i < path.points.length - 1; i++)
        expect(turnAt(path.points, i)).toBeLessThanOrEqual(Math.PI / 36 + 1e-6)
    }
  })

  test('spaces pickets by run length, not one per step, with no gap over 0.1016 m', () => {
    const path = resolveStairRailPaths(spiral, {}).find((p) => p.side === 'right')!
    // Ends-only newels isolate the picket pitch (interior newels would leave a
    // legitimate wider gap they fill themselves); the renderer adds those back.
    const boxes = buildBalusterGuard(path.points, {
      railHeight: 0.92,
      pickets: 0.127,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    const pickets = boxes.filter(isPicket)
    // The outer run is ~8 m: pitch gives dozens of pickets, far past 14 steps.
    expect(pickets.length).toBeGreaterThan(spiral.stepCount * 2)
    // Pickets ride a constant radius, so plan spacing is the pitch along the arc.
    const radius = Math.hypot(path.points[0]![0], path.points[0]![2])
    const stationArc = pickets
      .map((picket) => Math.atan2(picket.center[2], picket.center[0]) * radius)
      .sort((a, b) => a - b)
    expect(stationArc.every(Number.isFinite)).toBe(true)
    for (let i = 1; i < stationArc.length; i++)
      expect(stationArc[i]! - stationArc[i - 1]! - 0.032).toBeLessThanOrEqual(0.1016 + 1e-6)
  })

  test('the integrated landing arrival stays on the rail path', () => {
    const landed = StairNode.parse({
      stairType: 'spiral',
      stepCount: 14,
      sweepAngle: (249 * Math.PI) / 180,
      totalRise: 3,
      width: 0.72,
      innerRadius: 1.18,
      railingMode: 'both',
      topLandingMode: 'integrated',
      topLandingDepth: 0.9,
    })
    const withLanding = resolveStairRailPaths(landed, {})[0]!
    const withoutLanding = resolveStairRailPaths(spiral, {})[0]!
    // The landing sweep extends the path past the bare flight's final vertex.
    expect(withLanding.points.length).toBeGreaterThan(withoutLanding.points.length)
    const top = withLanding.points.at(-1)![1]
    const flightTop = withoutLanding.points.at(-1)![1]
    expect(top).toBeCloseTo(flightTop, 5)
  })
})
