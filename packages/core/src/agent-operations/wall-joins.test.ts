import { describe, expect, test } from 'bun:test'
import { WallNode } from '../schema'
import { wallBodies, wallEndShortIssues, wallNearlyAlignedIssues } from './wall-joins'

type Pt = [number, number]

const wall = (id: string, start: Pt, end: Pt, extra: Record<string, unknown> = {}) =>
  WallNode.parse({
    id: `wall_${id}`,
    name: `Wall ${id}`,
    parentId: 'level_0',
    start,
    end,
    thickness: 0.1,
    ...extra,
  })

const bodiesOf = (...walls: ReturnType<typeof wall>[]) => wallBodies(walls)
const shorts = (...walls: ReturnType<typeof wall>[]) =>
  wallEndShortIssues({ levelId: 'level_0', levelName: 'Ground floor', bodies: bodiesOf(...walls) })
const aligned = (...walls: ReturnType<typeof wall>[]) =>
  wallNearlyAlignedIssues({
    levelId: 'level_0',
    levelName: 'Ground floor',
    bodies: bodiesOf(...walls),
  })

/** A point `length` away from `from`, turned `degrees` off the +x axis. */
const toward = (from: Pt, length: number, degrees: number): Pt => [
  from[0] + length * Math.cos((degrees * Math.PI) / 180),
  from[1] + length * Math.sin((degrees * Math.PI) / 180),
]

describe('wall_end_short', () => {
  const across = wall('across', [0, 0], [4, 0]) // 10 cm thick, along x

  test("a wall that stops short of another one's body is said with the daylight and both names", () => {
    // 15 cm from the other's centre line, 5 cm of that is the other's half thickness: 10 cm of daylight
    const issues = shorts(across, wall('stub', [2, 2], [2, 0.15]))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'wall_end_short',
      severity: 'warning',
      wallId: 'wall_stub',
      wallName: 'Wall stub',
      end: 'end',
      otherWallId: 'wall_across',
      otherWallName: 'Wall across',
      gap: 0.1,
      at: [2, 0.15],
      nodeIds: ['wall_stub', 'wall_across'],
    })
    expect(issues[0]!.message).toContain('10.0 cm short of Wall across (wall_across)')
  })

  test('3 cm of daylight is the least: nearer is a joint', () => {
    const issues = shorts(across, wall('s3', [2, 2], [2, 0.081]))
    expect(issues.map((issue) => issue.gap)).toEqual([0.031])
    expect(shorts(across, wall('s2', [2, 2], [2, 0.079]))).toEqual([]) // 2.9 cm
  })

  test('an end that touches or enters the other body is a joint', () => {
    expect(shorts(across, wall('in', [2, 2], [2, 0.03]))).toEqual([])
    expect(shorts(across, wall('touch', [2, 2], [2, 0.05]))).toEqual([])
    expect(shorts(across, wall('through', [2, 2], [2, -1]))).toEqual([])
  })

  test('25 cm of daylight is the most: further is a free end near a wall, not a missed joint', () => {
    expect(shorts(across, wall('near', [2, 2], [2, 0.3]))).toHaveLength(1) // 0.30 - 0.05 = 25 cm
    expect(shorts(across, wall('far', [2, 2], [2, 0.31]))).toEqual([])
  })

  test('two walls on one line with a gap between their ends: the gap along the axis, no half thickness taken off', () => {
    const issues = shorts(wall('left', [0, 0], [2, 0]), wall('right', [2.12, 0], [4, 0]))
    expect(issues.map((issue) => [issue.wallId, issue.end, issue.gap])).toEqual([
      ['wall_left', 'end', 0.12],
      ['wall_right', 'start', 0.12],
    ])
  })

  test("walls running side by side: the nearest wall is at the end's side, not ahead of it", () => {
    expect(shorts(wall('a', [0, 0], [3, 0]), wall('b', [0, 0.2], [4, 0.2]))).toEqual([])
  })

  test("an end angled at the other wall is measured from its nearest corner to the body's face", () => {
    // a wall coming in at 45 degrees; its end cap's lower corner is 10 cm above the face of the body at y = 0.05
    const cornerDrop = 0.05 * Math.SQRT1_2
    const e: Pt = [2, 0.05 + 0.1 + cornerDrop]
    const issues = shorts(across, wall('diag', [e[0] + 2, e[1] + 2], e))
    expect(issues.map((issue) => [issue.wallId, issue.gap])).toEqual([['wall_diag', 0.1]])
  })

  test('a curved wall is not measured and does not hide a gap by standing near it', () => {
    const curved = wall('curved', [0, 0], [4, 0], { curveOffset: 0.8 })
    expect(shorts(curved, wall('stub', [2, 2], [2, 0.15]))).toEqual([])
  })

  test('the justification moves the body, so the gap is measured from the body, not the stored line', () => {
    // body on the left of the stored line (justification a): shifted 5 cm toward +z
    const left = wall('left', [0, 0], [4, 0], { justification: 'a' })
    expect(left.thickness).toBe(0.1)
    const issues = shorts(left, wall('stub', [2, 2], [2, 0.2]))
    expect(issues[0]?.gap).toBeCloseTo(0.2 - 0.1, 3)
  })
})

describe('wall_nearly_aligned', () => {
  /** A 4 m wall, a short wall that turns `degrees` off its line, and a 4 m wall carrying on from the short wall's end. */
  const holder = (degrees: number, length = 1) => {
    const end = toward([4, 0], length, degrees)
    return [
      wall('left', [0, 0], [4, 0]),
      wall('gap', [4, 0], end),
      wall('right', end, [end[0] + 4, end[1]]),
    ]
  }

  test('a short wall skewed between two walls on one line is the one said, with both neighbours and its angle', () => {
    const issues = aligned(...holder(4))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'wall_nearly_aligned',
      severity: 'warning',
      wallId: 'wall_gap',
      angle: 4,
    })
    expect(issues[0]!.neighbours.map((n) => [n.wallId, n.end, n.angle])).toEqual([
      ['wall_left', 'start', 4],
      ['wall_right', 'end', 4],
    ])
    // the wall's far end stands sin(4 deg) x 1 m off the line of the first wall: 7.0 cm
    expect(issues[0]!.offset).toBeCloseTo(0.07, 2)
    expect(issues[0]!.nodeIds).toEqual(['wall_gap', 'wall_left', 'wall_right'])
  })

  test('0.5 to 6 degrees is the band: a straighter line is one line, a larger turn is an angle drawn on purpose', () => {
    expect(aligned(...holder(0.3, 6))).toEqual([]) // 0.3 degrees: the line of a plan read with noise
    expect(aligned(...holder(0.6, 6))).toHaveLength(1)
    expect(aligned(...holder(5.9))).toHaveLength(1)
    expect(aligned(...holder(8))).toEqual([]) // an angle somebody drew
    expect(aligned(...holder(45))).toEqual([]) // a bay
    expect(aligned(...holder(90))).toEqual([]) // a corner
  })

  test("a skew that moves the wall's end less than 2 cm off the line is within drawing tolerance", () => {
    expect(aligned(...holder(1, 1))).toEqual([]) // 1.7 cm
    expect(aligned(...holder(1, 1.3))).toHaveLength(1) // 2.3 cm
  })

  test('one wall carrying on into another a few degrees off: the shorter wall is said, once', () => {
    const long = wall('long', [0, 0], [5, 0])
    const issues = aligned(long, wall('short', [5, 0], toward([5, 0], 1, 3)))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ wallId: 'wall_short', angle: 3 })
    expect(issues[0]!.neighbours).toEqual([
      { wallId: 'wall_long', name: 'Wall long', end: 'start', angle: 3 },
    ])
  })

  test('walls that meet at a corner, a T or by an end that is not on theirs are not a line carrying on', () => {
    expect(aligned(wall('a', [0, 0], [4, 0]), wall('b', [4, 0], [4, 3]))).toEqual([])
    // a T: the stem ends on the middle of the bar
    expect(aligned(wall('bar', [0, 0], [4, 0]), wall('stem', [2, 0], [2.04, 3]))).toEqual([])
    // two walls 3 degrees apart whose ends are 0.5 m from each other
    expect(
      aligned(wall('a', [0, 0], [4, 0]), wall('b', toward([4.5, 0], 0, 0), toward([4.5, 0], 4, 3))),
    ).toEqual([])
  })

  test('a T whose bar is drawn in two pieces on one line is quiet', () => {
    expect(
      aligned(
        wall('west', [0, 0], [2, 0]),
        wall('east', [2, 0], [4, 0]),
        wall('stem', [2, 0], [2, 3]),
      ),
    ).toEqual([])
  })

  test('curved walls are not measured', () => {
    expect(
      aligned(
        wall('a', [0, 0], [4, 0]),
        wall('b', [4, 0], toward([4, 0], 1, 4), { curveOffset: 0.3 }),
      ),
    ).toEqual([])
  })
})
