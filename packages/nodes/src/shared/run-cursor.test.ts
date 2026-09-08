import { describe, expect, test } from 'bun:test'
import { createRunSurfaceFrame } from './distribution-run-tool'
import { intersectRunPlane, resolveRunCursorPlane } from './run-cursor'

describe('surface-first run cursor', () => {
  test('reacquires either ceiling face from free space with duct or pipe clearance', () => {
    for (const side of [-1, 1]) {
      for (const clearance of [0.0254, 0.1016]) {
        const result = resolveRunCursorPlane({
          hit: {
            point: [2, 3, 4],
            frame: createRunSurfaceFrame([0, 3, 0], [0, side, 0]),
          },
          working: createRunSurfaceFrame([0, 1, 0]),
          fallback: [2, 1, 4],
          clearance,
        })
        expect(result.point[1]).toBeCloseTo(3 + side * clearance)
        expect(result.frame.origin[1]).toBeCloseTo(result.point[1])
        expect(result.frame.normal).toEqual([0, side, 0])
      }
    }
  })

  test('wall hit wins over a ground fallback and applies clearance once', () => {
    const frame = createRunSurfaceFrame([0, 0, 2], [0, 0, 1])
    const result = resolveRunCursorPlane({
      hit: { point: [1, 1.5, 2], frame },
      working: null,
      fallback: [9, 0, 9],
      clearance: 0.0508,
    })
    expect(result.point).toEqual([1, 1.5, 2.0508])
  })
  test('empty space continues on the wall plane along the actual mouse ray', () => {
    const frame = createRunSurfaceFrame([0, 0, 2], [0, 0, 1])
    const result = resolveRunCursorPlane({
      hit: null,
      working: frame,
      ray: { origin: [0, 4, 6], direction: [1, -0.5, -1] },
      fallback: [0, 0, 0],
      clearance: 0.1,
    })
    expect(result.point).toEqual([4, 2, 2])
  })
  test('ceiling target replaces wall plane and offsets downward', () => {
    const result = resolveRunCursorPlane({
      hit: { point: [2, 3, 4], frame: createRunSurfaceFrame([0, 3, 0], [0, -1, 0]) },
      working: createRunSurfaceFrame([0, 0, 4], [0, 0, 1]),
      fallback: [0, 0, 0],
      clearance: 0.1,
    })
    expect(result.point).toEqual([2, 2.9, 4])
  })
  test('parallel and behind-camera intersections preserve the last point', () => {
    const working = createRunSurfaceFrame([0, 0, 2], [0, 0, 1])
    expect(intersectRunPlane({ origin: [0, 0, 0], direction: [0, 0, -1] }, working)).toBeNull()
    expect(
      resolveRunCursorPlane({
        hit: null,
        working,
        ray: { origin: [0, 0, 0], direction: [1, 0, 0] },
        fallback: [1, 2, 2],
        clearance: 0,
      }).point,
    ).toEqual([1, 2, 2])
  })
  test('floor and sloped planes use their own normal for clearance', () => {
    const frame = createRunSurfaceFrame([0, 2, 0], [0, Math.SQRT1_2, Math.SQRT1_2])
    const result = resolveRunCursorPlane({
      hit: { point: [0, 2, 0], frame },
      working: null,
      fallback: [0, 0, 0],
      clearance: 0.1,
    })
    expect(result.point[1]).toBeCloseTo(2 + Math.SQRT1_2 * 0.1)
    expect(result.point[2]).toBeCloseTo(Math.SQRT1_2 * 0.1)
  })
})
