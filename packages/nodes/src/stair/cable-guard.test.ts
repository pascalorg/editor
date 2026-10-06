import { describe, expect, test } from 'bun:test'
import { resolveStairRailPaths, StairNode } from '@pascal-app/core'
import { buildCableGuard } from './cable-guard'
import type { GuardBox } from './guard-path'

const UP_ISH = (box: GuardBox) => box.direction[1] > 0.9
/** A slim 2 in square post stands plumb at a 0.0508 m section. */
const isPost = (box: GuardBox) =>
  !box.round &&
  UP_ISH(box) &&
  Math.abs(box.size[0] - 0.0508) < 1e-6 &&
  Math.abs(box.size[1] - 0.0508) < 1e-6
/** The flat cap runs along the path, 0.0635 m across and 0.0381 m thick. */
const isCap = (box: GuardBox) =>
  !box.round &&
  !UP_ISH(box) &&
  Math.abs(box.size[0] - 0.0635) < 1e-6 &&
  Math.abs(box.size[1] - 0.0381) < 1e-6
/** A cable is a slender round member of appreciable length. */
const isCable = (box: GuardBox) =>
  box.round === true && Math.abs(box.size[0] - 0.0095) < 1e-6 && box.size[2] > 0.06
/** A terminal sleeve is a short, fatter round fitting. */
const isSleeve = (box: GuardBox) =>
  box.round === true && Math.abs(box.size[0] - 0.019) < 1e-6 && Math.abs(box.size[2] - 0.05) < 1e-6
const horizontalish = (box: GuardBox) => Math.abs(box.direction[1]) < 0.6
const finite = (box: GuardBox) =>
  [...box.center, ...box.size, ...box.direction].every(Number.isFinite)

function straightRun(length: number, rise: number, count: number): [number, number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return [length * t, rise * t, 0] as [number, number, number]
  })
}

describe('buildCableGuard', () => {
  test('stands slim posts under a flat cap with round cables spanning between them', () => {
    const boxes = buildCableGuard(straightRun(3, 1.5, 2), {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    expect(boxes.every(finite)).toBe(true)
    const posts = boxes.filter(isPost)
    expect(posts).toHaveLength(2)
    const postXs = posts.map((p) => p.center[0]).sort((a, b) => a - b)
    expect(postXs[0]!).toBeCloseTo(0)
    expect(postXs[1]!).toBeCloseTo(3)
    expect(boxes.filter(isCap)).toHaveLength(1)
    const cables = boxes.filter(isCable)
    expect(cables.length).toBeGreaterThan(2)
    // Every cable is round and runs roughly along the flight, never plumb.
    expect(cables.every(horizontalish)).toBe(true)
    // One run of cables between the two posts, plus a sleeve at each terminal.
    expect(boxes.filter(isSleeve)).toHaveLength(cables.length * 2)
  })

  test('cables sit between the lowest clearance and the cap underside', () => {
    const boxes = buildCableGuard(straightRun(3, 0, 2), {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    const capUnderside = 0.92 - 0.0381
    const ys = boxes
      .filter(isCable)
      .map((cable) => cable.center[1])
      .sort((a, b) => a - b)
    expect(ys[0]!).toBeGreaterThanOrEqual(0.0762 - 1e-9)
    expect(ys.at(-1)!).toBeLessThan(capUnderside)
    // No clear gap over 3 in between consecutive cables.
    for (let i = 1; i < ys.length; i++)
      expect(ys[i]! - ys[i - 1]!).toBeLessThanOrEqual(0.0762 + 1e-9)
  })

  test('spaces posts and cables by run length, not by tessellation', () => {
    const options = { railHeight: 0.92, postSpacing: 1.2192 } as const
    const coarse = buildCableGuard(straightRun(4, 2, 2), options)
    const fine = buildCableGuard(straightRun(4, 2, 61), options)
    expect(fine.filter(isPost)).toHaveLength(coarse.filter(isPost).length)
    expect(fine.filter(isCable)).toHaveLength(coarse.filter(isCable).length)
    expect(coarse.filter(isPost).length).toBeLessThan(8)
    expect(fine.every(finite)).toBe(true)
  })

  test('topPost:false drops the top post and reach runs the cap past it', () => {
    const path = straightRun(3, 1.5, 4)
    const withTop = buildCableGuard(path, { railHeight: 0.92 })
    const noTop = buildCableGuard(path, { railHeight: 0.92, topPost: false, reach: 0.3 })
    expect(noTop.filter(isPost)).toHaveLength(withTop.filter(isPost).length - 1)
    const maxCapX = (boxes: GuardBox[]) =>
      Math.max(...boxes.filter(isCap).map((box) => box.center[0]))
    expect(maxCapX(noTop)).toBeGreaterThan(3)
    expect(maxCapX(withTop)).toBeLessThanOrEqual(3 + 1e-6)
  })

  test('a purely vertical path (a zero-radius winder pivot) stands one plumb post, no cables', () => {
    const boxes = buildCableGuard(
      [
        [0, 0, 0],
        [0, 1.2, 0],
      ],
      { railHeight: 0.92, postSpacing: 1.2192 },
    )
    expect(boxes.filter(isPost)).toHaveLength(1)
    expect(boxes.filter(isCable)).toHaveLength(0)
    expect(boxes.every(finite)).toBe(true)
  })

  test('postThrough adds a cap over each post top', () => {
    const path = straightRun(3, 1.5, 4)
    const plain = buildCableGuard(path, { railHeight: 0.92 })
    const through = buildCableGuard(path, { railHeight: 0.92, postThrough: true })
    const postCaps = (boxes: GuardBox[]) =>
      boxes.filter((box) => !box.round && UP_ISH(box) && box.size[0] > 0.0508 && box.size[1] < 0.03)
    expect(postCaps(plain)).toHaveLength(0)
    expect(postCaps(through)).toHaveLength(plain.filter(isPost).length)
  })
})

describe('arc stair cable guard — the curved/spiral pipeline', () => {
  // The renderer builds the curved/spiral cable guard this way: the shared
  // analytic path (`resolveStairRailPaths`), then buildCableGuard, so a spiral
  // reads as one cable rail whose cap follows the sweep while the taut cables
  // span straight between the run-spaced posts rather than tracing the arc.
  const spiral = StairNode.parse({
    stairType: 'spiral',
    stepCount: 14,
    sweepAngle: (249 * Math.PI) / 180,
    totalRise: 3,
    width: 0.72,
    innerRadius: 1.18,
    railingMode: 'both',
    railingStyle: 'cable',
  })

  test('caps the curve densely but spans straight cable chords between run-spaced posts', () => {
    const path = resolveStairRailPaths(spiral, {}).find((p) => p.side === 'right')!
    const boxes = buildCableGuard(path.points, { railHeight: 0.92, postSpacing: 1.2192 })
    expect(boxes.every(finite)).toBe(true)
    // The cap follows the arc as many short segments.
    expect(boxes.filter(isCap).length).toBeGreaterThan(spiral.stepCount)
    // Posts stand by run — far fewer than one per vertex of the dense arc.
    const posts = boxes.filter(isPost)
    expect(posts.length).toBeGreaterThan(2)
    expect(posts.length).toBeLessThan(path.points.length)
    // Cables are exactly one straight span per bay per level, not per vertex.
    const cables = boxes.filter(isCable)
    expect(cables.length % (posts.length - 1)).toBe(0)
    // Each cable chord's midpoint lies off the arc the posts sit on (a chord of
    // a convex arc is inside its endpoints' radius), proving it is not tracing
    // the curve.
    const postRadius = Math.hypot(posts[0]!.center[0], posts[0]!.center[2])
    const chordMid = cables.map((cable) => Math.hypot(cable.center[0], cable.center[2]))
    expect(chordMid.some((radius) => radius < postRadius - 1e-4)).toBe(true)
  })
})

test('cable runs terminate on a support at a sharp landing corner', () => {
  const boxes = buildCableGuard(
    [
      [0, 0, 0],
      [0, 1.5, 3],
      [3, 1.5, 3],
    ],
    { railHeight: 0.92, postSpacing: 1.2192 },
  )
  expect(
    boxes.some(
      (box) => isPost(box) && Math.abs(box.center[0]) < 1e-6 && Math.abs(box.center[2] - 3) < 1e-6,
    ),
  ).toBe(true)
  for (const box of boxes.filter(isCable)) {
    expect(Math.abs(box.direction[0]) < 1e-6 || Math.abs(box.direction[2]) < 1e-6).toBe(true)
  }
  expect(
    boxes
      .filter(isSleeve)
      .some((box) => Math.abs(box.center[0]) < 0.06 && Math.abs(box.center[2] - 3) < 0.06),
  ).toBe(true)
})

test('successive right-angle landing turns each anchor the cables', () => {
  const boxes = buildCableGuard(
    [
      [0, 0, 0],
      [0, 1, 3],
      [1, 1, 3],
      [1, 2, 0],
    ],
    { railHeight: 0.92 },
  )
  for (const [x, z] of [
    [0, 3],
    [1, 3],
  ]) {
    expect(
      boxes.some(
        (box) =>
          isPost(box) && Math.abs(box.center[0] - x!) < 1e-6 && Math.abs(box.center[2] - z!) < 1e-6,
      ),
    ).toBe(true)
  }
  for (const box of boxes.filter(isCable)) {
    expect(Math.abs(box.direction[0]) < 1e-6 || Math.abs(box.direction[2]) < 1e-6).toBe(true)
  }
})
