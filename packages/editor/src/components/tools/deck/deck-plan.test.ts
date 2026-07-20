import { describe, expect, test } from 'bun:test'
import {
  buildRailingRuns,
  classifyDeckEdges,
  type DeckEdge,
  type PlanPoint,
  planDeckStair,
  quantizeDeckElevation,
  sanitizeDeckPolygon,
} from './deck-plan'

// Square deck, CCW in plan space: bottom edge (z = 0) is index 0.
const SQUARE: PlanPoint[] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

const BOTTOM_EDGE: DeckEdge = { start: [0, 0], end: [4, 0] }

describe('classifyDeckEdges', () => {
  test('no walls means every edge is open', () => {
    const { open, closed } = classifyDeckEdges(SQUARE, [])
    expect(open).toHaveLength(4)
    expect(closed).toHaveLength(0)
  })

  test('an edge whose midpoint hugs a wall centerline is closed', () => {
    const { open, closed } = classifyDeckEdges(SQUARE, [
      { start: [-1, 0], end: [5, 0], thickness: 0.1 },
    ])
    expect(closed).toHaveLength(1)
    expect(closed[0]?.start).toEqual([0, 0])
    expect(closed[0]?.end).toEqual([4, 0])
    expect(open).toHaveLength(3)
  })

  test('the ~0.3 m default threshold clamps: near wall closes, far wall stays open', () => {
    const near = classifyDeckEdges(SQUARE, [
      { start: [-1, -0.29], end: [5, -0.29], thickness: 0.1 },
    ])
    expect(near.closed).toHaveLength(1)

    const far = classifyDeckEdges(SQUARE, [{ start: [-1, -0.35], end: [5, -0.35], thickness: 0.1 }])
    expect(far.closed).toHaveLength(0)
  })

  test('a thicker wall extends the closing reach by its half thickness', () => {
    const { closed } = classifyDeckEdges(SQUARE, [
      { start: [-1, -0.35], end: [5, -0.35], thickness: 0.3 },
    ])
    expect(closed).toHaveLength(1)
  })

  test('a wall near only a corner (not the midpoint) leaves the edge open', () => {
    const { open } = classifyDeckEdges(SQUARE, [{ start: [-1, 0], end: [0.5, 0], thickness: 0.1 }])
    expect(open.some((edge) => edge.start[0] === 0 && edge.end[0] === 4)).toBe(true)
  })
})

describe('planDeckStair', () => {
  test('returns null when the deck is fully enclosed (no open edge)', () => {
    expect(planDeckStair(SQUARE, [], 1.25)).toBeNull()
  })

  test('returns null for a zero rise', () => {
    expect(planDeckStair(SQUARE, [BOTTOM_EDGE], 0)).toBeNull()
  })

  test('boards the edge at its midpoint with the foot outside the deck', () => {
    const plan = planDeckStair(SQUARE, [BOTTOM_EDGE], 1.25)
    expect(plan).not.toBeNull()
    if (!plan) return
    expect(plan.head).toEqual([2, 0])
    // Default slope preserved: run = rise * (3.0 / 2.5).
    expect(plan.runLength).toBeCloseTo(1.5)
    expect(plan.foot[0]).toBeCloseTo(2)
    expect(plan.foot[1]).toBeCloseTo(-1.5)
    // Ascent aims from the foot toward the deck: rotation 0 is local +Z.
    expect(plan.rotation).toBeCloseTo(0)
    // Default riser height preserved: 1.25 / 0.25.
    expect(plan.stepCount).toBe(5)
  })

  test('winding order does not flip the foot inside the deck', () => {
    const clockwise = [...SQUARE].reverse()
    const edge: DeckEdge = { start: [4, 0], end: [0, 0] }
    const plan = planDeckStair(clockwise, [edge], 1.25)
    expect(plan).not.toBeNull()
    if (!plan) return
    expect(plan.foot[1]).toBeCloseTo(-1.5)
  })

  test('picks the longest open edge', () => {
    const rect: PlanPoint[] = [
      [0, 0],
      [6, 0],
      [6, 2],
      [0, 2],
    ]
    const shortEdge: DeckEdge = { start: [6, 0], end: [6, 2] }
    const longEdge: DeckEdge = { start: [0, 0], end: [6, 0] }
    const plan = planDeckStair(rect, [shortEdge, longEdge], 1)
    expect(plan?.edge).toBe(longEdge)
  })

  test('clamps tiny rises to a usable run and at least two steps', () => {
    const plan = planDeckStair(SQUARE, [BOTTOM_EDGE], 0.2)
    expect(plan?.runLength).toBeCloseTo(0.6)
    expect(plan?.stepCount).toBe(2)
  })
})

describe('buildRailingRuns', () => {
  test('one full run per open edge without a stair', () => {
    const runs = buildRailingRuns([BOTTOM_EDGE], null)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.start).toEqual([0, 0])
    expect(runs[0]?.end).toEqual([4, 0])
  })

  test('splits the boarding edge around the stair mouth', () => {
    const runs = buildRailingRuns([BOTTOM_EDGE], {
      edge: BOTTOM_EDGE,
      head: [2, 0],
      width: 1,
    })
    // Gap = width + 2 * clearance = 1.2 m centered on the boarding point.
    expect(runs).toHaveLength(2)
    expect(runs[0]?.start[0]).toBeCloseTo(0)
    expect(runs[0]?.end[0]).toBeCloseTo(1.4)
    expect(runs[1]?.start[0]).toBeCloseTo(2.6)
    expect(runs[1]?.end[0]).toBeCloseTo(4)
  })

  test('drops stubs shorter than the minimum run', () => {
    const shortEdge: DeckEdge = { start: [0, 0], end: [1.6, 0] }
    const runs = buildRailingRuns([shortEdge], {
      edge: shortEdge,
      head: [0.8, 0],
      width: 1,
    })
    // 1.6 m edge minus the 1.2 m mouth leaves two 0.2 m stubs — both culled.
    expect(runs).toHaveLength(0)
  })

  test('boarding near an edge end keeps only the far run', () => {
    const runs = buildRailingRuns([BOTTOM_EDGE], {
      edge: BOTTOM_EDGE,
      head: [0.5, 0],
      width: 1,
    })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.start[0]).toBeCloseTo(1.1)
    expect(runs[0]?.end[0]).toBeCloseTo(4)
  })

  test('other open edges keep their full railing while the boarding edge is split', () => {
    const rightEdge: DeckEdge = { start: [4, 0], end: [4, 4] }
    const runs = buildRailingRuns([BOTTOM_EDGE, rightEdge], {
      edge: BOTTOM_EDGE,
      head: [2, 0],
      width: 1,
    })
    expect(runs).toHaveLength(3)
    expect(runs[2]?.start).toEqual([4, 0])
    expect(runs[2]?.end).toEqual([4, 4])
  })

  test('skips edges shorter than the minimum run', () => {
    const tiny: DeckEdge = { start: [0, 0], end: [0.2, 0] }
    expect(buildRailingRuns([tiny], null)).toHaveLength(0)
  })
})

describe('sanitizeDeckPolygon', () => {
  test('drops consecutive duplicates and a trailing first-point repeat', () => {
    const polygon = sanitizeDeckPolygon([
      [0, 0],
      [0, 0],
      [4, 0],
      [4, 4],
      [4, 4],
      [0, 4],
      [0.005, 0.005],
    ])
    expect(polygon).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ])
  })
})

describe('quantizeDeckElevation', () => {
  test('quantizes to 0.05 m', () => {
    expect(quantizeDeckElevation(1.27)).toBeCloseTo(1.25)
    expect(quantizeDeckElevation(2.5 / 2)).toBeCloseTo(1.25)
    expect(quantizeDeckElevation(1.31)).toBeCloseTo(1.3)
  })
})
