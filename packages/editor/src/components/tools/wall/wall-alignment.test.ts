import { describe, expect, test } from 'bun:test'
import {
  nextWallAlignment,
  offsetWallLineForAlignment,
  WALL_ALIGNMENTS,
  type WallPlanPoint,
} from './wall-snap-geometry'

function closeTo(actual: number, expected: number, tolerance = 1e-9) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

const THICKNESS = 0.2

describe('offsetWallLineForAlignment', () => {
  test('leaves a centred wall exactly where it was drawn', () => {
    const start: WallPlanPoint = [0, 0]
    const end: WallPlanPoint = [5, 0]

    expect(offsetWallLineForAlignment(start, end, THICKNESS, 'center')).toEqual([start, end])
  })

  test('moves the centreline half a thickness to one side', () => {
    // Drawn along +X: the two face justifications land on opposite sides,
    // each half a thickness from the traced line.
    const [ls, le] = offsetWallLineForAlignment([0, 0], [5, 0], THICKNESS, 'left')
    const [rs, re] = offsetWallLineForAlignment([0, 0], [5, 0], THICKNESS, 'right')

    closeTo(ls[1], -THICKNESS / 2)
    closeTo(le[1], -THICKNESS / 2)
    closeTo(rs[1], THICKNESS / 2)
    closeTo(re[1], THICKNESS / 2)
  })

  test('puts the traced line on a face, which is the whole point', () => {
    // The traced line must end up flush with one side of the wall body, so a
    // wall traced along a CAD wall face sits exactly against it.
    const [s] = offsetWallLineForAlignment([0, 0], [5, 0], THICKNESS, 'left')
    // Body spans centre ± half; the near face is back at the traced line.
    closeTo(s[1] + THICKNESS / 2, 0)
  })

  test('offsets perpendicular to the direction drawn, not to an axis', () => {
    const [s, e] = offsetWallLineForAlignment([0, 0], [0, 5], THICKNESS, 'left')

    closeTo(s[0], THICKNESS / 2)
    closeTo(e[0], THICKNESS / 2)
    closeTo(s[1], 0)
  })

  test('keeps the wall parallel and the same length', () => {
    const start: WallPlanPoint = [1, 2]
    const end: WallPlanPoint = [4, 6]
    const [s, e] = offsetWallLineForAlignment(start, end, THICKNESS, 'right')

    closeTo(Math.hypot(e[0] - s[0], e[1] - s[1]), 5)
    // Parallel: the cross product of the two directions is zero.
    closeTo((e[0] - s[0]) * (end[1] - start[1]) - (e[1] - s[1]) * (end[0] - start[0]), 0)
  })

  test('shifts by exactly half the thickness, whatever the angle', () => {
    const start: WallPlanPoint = [1, 2]
    const end: WallPlanPoint = [4, 6]
    const [s] = offsetWallLineForAlignment(start, end, THICKNESS, 'left')

    closeTo(Math.hypot(s[0] - start[0], s[1] - start[1]), THICKNESS / 2)
  })

  test('reverses side when the wall is drawn the other way', () => {
    // Justification is relative to the direction of travel, like every CAD
    // tool — drawing a room clockwise vs anticlockwise flips which side is
    // inside, which is why the draft ghost shows it live.
    const [forward] = offsetWallLineForAlignment([0, 0], [5, 0], THICKNESS, 'left')
    const [, backward] = offsetWallLineForAlignment([5, 0], [0, 0], THICKNESS, 'left')

    closeTo(forward[1], -backward[1])
  })

  test('does nothing for a degenerate or thicknessless wall', () => {
    const point: WallPlanPoint = [3, 3]
    expect(offsetWallLineForAlignment(point, point, THICKNESS, 'left')).toEqual([point, point])
    expect(offsetWallLineForAlignment([0, 0], [5, 0], 0, 'left')).toEqual([
      [0, 0],
      [5, 0],
    ])
  })
})

describe('nextWallAlignment', () => {
  test('cycles through every option and returns to the start', () => {
    let alignment = WALL_ALIGNMENTS[0]!
    const seen = [alignment]
    for (let i = 0; i < WALL_ALIGNMENTS.length - 1; i++) {
      alignment = nextWallAlignment(alignment)
      seen.push(alignment)
    }

    expect(new Set(seen).size).toBe(WALL_ALIGNMENTS.length)
    expect(nextWallAlignment(alignment)).toBe(WALL_ALIGNMENTS[0]!)
  })

  test('starts from the centred behaviour walls have always had', () => {
    expect(WALL_ALIGNMENTS[0]).toBe('center')
  })
})
