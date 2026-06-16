import { describe, expect, test } from 'bun:test'
import {
  computeEdgeGaps,
  computeOpeningGuides,
  detectAlongWallAlignment,
  detectEqualSpacing,
  detectVerticalAlignment,
  type OpeningSpan,
  type WallExtent,
} from './opening-guides'

function span(id: string, centerS: number, width: number, centerY = 1, height = 1): OpeningSpan {
  return { id, centerS, width, centerY, height }
}

const WALL: WallExtent = { length: 10, height: 2.5 }

describe('detectEqualSpacing', () => {
  test('returns null for fewer than three openings', () => {
    const a = span('a', 0.5, 1)
    const b = span('b', 2.5, 1)
    expect(detectEqualSpacing([a, b], 'b', 0.03, 0.02)).toBeNull()
  })

  test('detects a run of equal gaps across three openings', () => {
    // width 1 each: a[0,1] b[2,3] c[4,5] → two gaps of 1m.
    const a = span('a', 0.5, 1)
    const b = span('b', 2.5, 1)
    const c = span('c', 4.5, 1)
    const run = detectEqualSpacing([a, b, c], 'b', 0.03, 0.02)
    expect(run).not.toBeNull()
    expect(run?.gap).toBeCloseTo(1)
    expect(run?.segments).toHaveLength(2)
    expect(run?.openingIds).toEqual(['a', 'b', 'c'])
    expect(run?.segments[0]).toEqual({ fromS: 1, toS: 2 })
    expect(run?.segments[1]).toEqual({ fromS: 3, toS: 4 })
  })

  test('extends a run across four openings (three gaps)', () => {
    const openings = [span('a', 0.5, 1), span('b', 2.5, 1), span('c', 4.5, 1), span('d', 6.5, 1)]
    const run = detectEqualSpacing(openings, 'c', 0.03, 0.02)
    expect(run?.segments).toHaveLength(3)
    expect(run?.openingIds).toEqual(['a', 'b', 'c', 'd'])
  })

  test('returns null when gaps differ beyond tolerance', () => {
    const a = span('a', 0.5, 1) // [0,1]
    const b = span('b', 2.5, 1) // [2,3] → gap 1
    const c = span('c', 5, 1) //   [4.5,5.5] → gap 1.5
    expect(detectEqualSpacing([a, b, c], 'b', 0.03, 0.02)).toBeNull()
  })

  test('returns null when the moving opening is not part of the equal run', () => {
    const a = span('a', 0.5, 1)
    const b = span('b', 2.5, 1)
    const c = span('c', 4.5, 1) // a,b,c form equal gaps of 1
    const d = span('d', 10, 1) // far right, breaks the run
    expect(detectEqualSpacing([a, b, c, d], 'd', 0.03, 0.02)).toBeNull()
  })

  test('a near-zero (touching) gap breaks a run', () => {
    const a = span('a', 0.5, 1) // [0,1]
    const b = span('b', 1.505, 1) // [1.005,2.005] → gap 0.005 < minGap
    const c = span('c', 3.005, 1) // [2.505,3.505] → gap 0.5
    expect(detectEqualSpacing([a, b, c], 'b', 0.03, 0.02)).toBeNull()
  })

  test('honours the equal-spacing tolerance', () => {
    const a = span('a', 0.5, 1) // [0,1]
    const b = span('b', 2.5, 1) // [2,3] → gap 1.0
    const c = span('c', 4.52, 1) // [4.02,5.02] → gap 1.02
    expect(detectEqualSpacing([a, b, c], 'b', 0.03, 0.02)?.segments).toHaveLength(2)
    expect(detectEqualSpacing([a, b, c], 'b', 0.01, 0.02)).toBeNull()
  })
})

describe('computeEdgeGaps', () => {
  test('measures clearance to the nearest neighbour on each side', () => {
    const moving = span('m', 5, 1) // [4.5,5.5]
    const left = span('l', 2, 1) // [1.5,2.5]
    const right = span('r', 8, 1) // [7.5,8.5]
    const gaps = computeEdgeGaps(moving, [left, right], WALL, 0.02)
    const byside = Object.fromEntries(gaps.map((g) => [g.side, g]))
    expect(byside.left?.distance).toBeCloseTo(2)
    expect(byside.left?.target).toBe('opening')
    expect(byside.left?.targetId).toBe('l')
    expect(byside.right?.distance).toBeCloseTo(2)
    expect(byside.right?.targetId).toBe('r')
  })

  test('falls back to wall ends with no neighbour', () => {
    const moving = span('m', 5, 1) // [4.5,5.5]
    const gaps = computeEdgeGaps(moving, [], WALL, 0.02)
    const byside = Object.fromEntries(gaps.map((g) => [g.side, g]))
    expect(byside.left?.target).toBe('wall-start')
    expect(byside.left?.distance).toBeCloseTo(4.5)
    expect(byside.right?.target).toBe('wall-end')
    expect(byside.right?.distance).toBeCloseTo(4.5)
  })

  test('omits a side that is flush / overlapping (below minGap)', () => {
    const moving = span('m', 5, 1) // [4.5,5.5]
    const flush = span('l', 4, 1) // [3.5,4.5] right edge touches moving left
    const gaps = computeEdgeGaps(moving, [flush], WALL, 0.02)
    expect(gaps.find((g) => g.side === 'left')).toBeUndefined()
    expect(gaps.find((g) => g.side === 'right')?.target).toBe('wall-end')
  })
})

describe('detectAlongWallAlignment', () => {
  test('detects edge-to-edge alignment within tolerance', () => {
    const moving = span('m', 5, 2) // [4,6]
    const sib = span('s', 7.05, 2) // left edge 6.05
    const a = detectAlongWallAlignment(moving, [sib], 0.08)
    expect(a?.movingFeature).toBe('right')
    expect(a?.targetFeature).toBe('left')
    expect(a?.snap).toBeCloseTo(0.05)
    expect(a?.s).toBeCloseTo(6.05)
  })

  test('detects centre alignment', () => {
    const moving = span('m', 5, 2)
    const sib = span('s', 5.03, 0.5) // centre 5.03, edges far from moving edges
    const a = detectAlongWallAlignment(moving, [sib], 0.08)
    expect(a?.movingFeature).toBe('center')
    expect(a?.targetFeature).toBe('center')
    expect(a?.snap).toBeCloseTo(0.03)
  })

  test('returns null when nothing is within tolerance', () => {
    const moving = span('m', 5, 2)
    const sib = span('s', 9, 2)
    expect(detectAlongWallAlignment(moving, [sib], 0.08)).toBeNull()
  })
})

describe('detectVerticalAlignment', () => {
  test('detects a shared sill within tolerance', () => {
    const moving = span('m', 5, 1, 1.5, 1) // sill 1.0
    const sib = span('s', 8, 1, 2.04, 2) // sill 1.04
    const a = detectVerticalAlignment(moving, [sib], 0.08)
    expect(a?.movingFeature).toBe('sill')
    expect(a?.targetFeature).toBe('sill')
    expect(a?.snap).toBeCloseTo(0.04)
    expect(a?.y).toBeCloseTo(1.04)
  })

  test('returns null when sills/tops differ beyond tolerance', () => {
    const moving = span('m', 5, 1, 1.5, 1) // sill 1, top 2, centre 1.5
    const sib = span('s', 8, 1, 0.4, 0.4) // sill 0.2, top 0.6, centre 0.4
    expect(detectVerticalAlignment(moving, [sib], 0.08)).toBeNull()
  })
})

describe('computeOpeningGuides', () => {
  test('includes sill/head for windows', () => {
    const moving = span('m', 5, 1, 1.5, 1) // bottom 1, top 2
    const guides = computeOpeningGuides({
      moving,
      siblings: [],
      wall: WALL,
      includeVertical: true,
    })
    expect(guides.sillHead?.sill).toBeCloseTo(1)
    expect(guides.sillHead?.head).toBeCloseTo(0.5) // 2.5 - 2
    expect(guides.sillHead?.bottomY).toBeCloseTo(1)
    expect(guides.sillHead?.topY).toBeCloseTo(2)
  })

  test('omits vertical guides for doors (sit on the floor)', () => {
    const moving = span('m', 5, 1, 1, 2)
    const sib = span('s', 8, 1, 1, 2)
    const guides = computeOpeningGuides({
      moving,
      siblings: [sib],
      wall: WALL,
      includeVertical: false,
    })
    expect(guides.sillHead).toBeNull()
    expect(guides.vertical).toBeNull()
    // along-wall + proximity still computed for doors
    expect(guides.gaps.length).toBeGreaterThan(0)
  })

  test('combines proximity and equal-spacing in one pass', () => {
    const moving = span('b', 2.5, 1)
    const guides = computeOpeningGuides({
      moving,
      siblings: [span('a', 0.5, 1), span('c', 4.5, 1)],
      wall: WALL,
      includeVertical: true,
    })
    expect(guides.gaps).toHaveLength(2)
    expect(guides.equalSpacing?.gap).toBeCloseTo(1)
    expect(guides.equalSpacing?.openingIds).toEqual(['a', 'b', 'c'])
  })
})

describe('opening-guides — review regressions', () => {
  test('detectEqualSpacing finds a run that starts partway through a drifting sequence', () => {
    // gaps 1.00, 1.02, 1.04 — only [b,c,d] is equal within 0.03 and includes the
    // moving opening; a first-gap-anchored greedy scan used to drop it.
    const openings = [span('a', 0.5, 1), span('b', 2.5, 1), span('c', 4.52, 1), span('d', 6.56, 1)]
    const run = detectEqualSpacing(openings, 'd', 0.03, 0.02)
    expect(run?.openingIds).toEqual(['b', 'c', 'd'])
    expect(run?.gap).toBeCloseTo(1.03)
    expect(run?.segments).toHaveLength(2)
  })

  test('detectEqualSpacing prefers the leftmost run on a length tie', () => {
    // gaps 1,1,2,2 with the moving opening in the middle — two equal-length runs.
    const openings = [
      span('a', 0.5, 1),
      span('b', 2.5, 1),
      span('c', 4.5, 1),
      span('d', 7.5, 1),
      span('e', 10.5, 1),
    ]
    expect(detectEqualSpacing(openings, 'c', 0.03, 0.02)?.openingIds).toEqual(['a', 'b', 'c'])
  })

  test('computeEdgeGaps suppresses both sides when a sibling overlaps', () => {
    const moving = span('m', 5, 1) // [4.5,5.5]
    const containing = span('s', 5, 2) // [4,6] straddles both edges
    expect(computeEdgeGaps(moving, [containing], WALL, 0.02)).toEqual([])
  })

  test('alignment detectors ignore the moving opening if present in siblings', () => {
    const moving = span('m', 5, 2, 1.5, 1)
    expect(detectAlongWallAlignment(moving, [moving], 0.08)).toBeNull()
    expect(detectVerticalAlignment(moving, [moving], 0.08)).toBeNull()
  })

  test('detectAlongWallAlignment reports a negative snap when the feature is past the target', () => {
    const moving = span('m', 5, 2) // centre 5
    const sib = span('s', 4.96, 0.5) // centre 4.96
    const a = detectAlongWallAlignment(moving, [sib], 0.08)
    expect(a?.movingFeature).toBe('center')
    expect(a?.snap).toBeCloseTo(-0.04)
  })
})
