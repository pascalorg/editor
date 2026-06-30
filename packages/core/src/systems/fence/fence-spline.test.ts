import { describe, expect, test } from 'bun:test'
import {
  getFenceControlHandle,
  getFenceSplineFrameAt,
  getFenceSplineLength,
  getTwoPointFenceCurveTangents,
  isSplineFence,
  sampleFenceSpline,
} from './fence-spline'

describe('isSplineFence', () => {
  test('false without a path or with < 2 points', () => {
    expect(isSplineFence({ path: undefined })).toBe(false)
    expect(isSplineFence({ path: [[0, 0]] })).toBe(false)
  })

  test('true with >= 2 points', () => {
    expect(
      isSplineFence({
        path: [
          [0, 0],
          [1, 0],
        ],
      }),
    ).toBe(true)
  })
})

describe('sampleFenceSpline', () => {
  test('honors the control points as on-curve anchors', () => {
    const path: Array<[number, number]> = [
      [0, 0],
      [2, 2],
      [4, 0],
    ]
    const sampled = sampleFenceSpline(path, undefined, 8)
    // First and last sample equal the path endpoints exactly.
    expect(sampled[0]).toEqual({ x: 0, y: 0 })
    expect(sampled[sampled.length - 1]).toEqual({ x: 4, y: 0 })
    // The interior control point is interpolated: some sample lands on (2, 2).
    const hitsMiddle = sampled.some((p) => Math.hypot(p.x - 2, p.y - 2) < 1e-6)
    expect(hitsMiddle).toBe(true)
  })

  test('two-point path with no tangents is a straight segment', () => {
    expect(
      sampleFenceSpline(
        [
          [0, 0],
          [3, 0],
        ],
        undefined,
        8,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ])
  })

  test('a stored tangent bends an otherwise straight two-point span', () => {
    const path: Array<[number, number]> = [
      [0, 0],
      [4, 0],
    ]
    // Pull the first point's handle up — the span should bow off the X axis.
    const sampled = sampleFenceSpline(path, [[0, 2], null], 12)
    expect(sampled[0]).toEqual({ x: 0, y: 0 })
    expect(sampled[sampled.length - 1]).toEqual({ x: 4, y: 0 })
    const maxY = Math.max(...sampled.map((p) => Math.abs(p.y)))
    expect(maxY).toBeGreaterThan(0.1)
  })

  test('generated two-point curve tangents create a gentle arc', () => {
    const path: Array<[number, number]> = [
      [0, 0],
      [4, 0],
    ]
    const sampled = sampleFenceSpline(path, getTwoPointFenceCurveTangents(path), 16)
    expect(sampled[0]).toEqual({ x: 0, y: 0 })
    expect(sampled[sampled.length - 1]).toEqual({ x: 4, y: 0 })
    const maxY = Math.max(...sampled.map((p) => p.y))
    expect(maxY).toBeGreaterThan(0.4)
  })

  test('produces a smooth (no-cusp) curve on uneven spacing', () => {
    const path: Array<[number, number]> = [
      [0, 0],
      [1, 0.2],
      [5, 0.3],
      [6, 0],
    ]
    const sampled = sampleFenceSpline(path, undefined, 16)
    let maxTurn = 0
    for (let i = 2; i < sampled.length; i += 1) {
      const a = sampled[i - 2]!
      const b = sampled[i - 1]!
      const c = sampled[i]!
      const t1 = Math.atan2(b.y - a.y, b.x - a.x)
      const t2 = Math.atan2(c.y - b.y, c.x - b.x)
      let d = Math.abs(t2 - t1)
      if (d > Math.PI) d = 2 * Math.PI - d
      maxTurn = Math.max(maxTurn, d)
    }
    expect(maxTurn).toBeLessThan(Math.PI / 2)
  })
})

describe('getFenceControlHandle', () => {
  test('returns the stored tangent when present', () => {
    expect(
      getFenceControlHandle(
        [
          [0, 0],
          [4, 0],
        ],
        [[1, 2], null],
        0,
      ),
    ).toEqual({ x: 1, y: 2 })
  })

  test('falls back to the automatic distance-aware tangent', () => {
    const path: Array<[number, number]> = [
      [0, 0],
      [3, 0],
      [6, 0],
    ]
    expect(getFenceControlHandle(path, undefined, 1)).toEqual({ x: 1, y: 0 })
  })
})

describe('getFenceSplineFrameAt', () => {
  const path: Array<[number, number]> = [
    [0, 0],
    [2, 0],
    [4, 0],
  ]

  test('t=0 / t=1 land on the endpoints', () => {
    expect(getFenceSplineFrameAt(path, 0).point).toEqual({ x: 0, y: 0 })
    expect(getFenceSplineFrameAt(path, 1).point).toEqual({ x: 4, y: 0 })
  })

  test('returns a unit tangent and perpendicular normal', () => {
    const frame = getFenceSplineFrameAt(path, 0.5)
    expect(Math.hypot(frame.tangent.x, frame.tangent.y)).toBeCloseTo(1, 5)
    const dot = frame.tangent.x * frame.normal.x + frame.tangent.y * frame.normal.y
    expect(dot).toBeCloseTo(0, 5)
  })
})

describe('getFenceSplineLength', () => {
  test('roughly matches the straight distance for a straight path', () => {
    expect(
      getFenceSplineLength(
        [
          [0, 0],
          [3, 4],
        ],
        undefined,
        8,
      ),
    ).toBeCloseTo(5, 5)
  })

  test('a curved path is longer than its endpoint chord', () => {
    const path: Array<[number, number]> = [
      [0, 0],
      [2, 2],
      [4, 0],
    ]
    const chord = Math.hypot(4, 0)
    expect(getFenceSplineLength(path, undefined, 16)).toBeGreaterThan(chord)
  })
})
