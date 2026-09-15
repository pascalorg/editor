import { describe, expect, test } from 'bun:test'
import type { SurfaceRegion } from './surface-hosting'
import { surfaceRegionContainsFootprint, surfaceRegionContainsPoint } from './surface-region'

describe('surface regions', () => {
  const rect: SurfaceRegion = { kind: 'rect', size: [1, 0.5], center: [2, -1] }

  test('rectangles use half-extents and an optional center', () => {
    for (const [point, expected] of [
      [[2, -1], true],
      [[1, -1.5], true],
      [[3, -0.5], true],
      [[0, 0], false],
      [[3.01, -1], false],
    ] as const)
      expect(surfaceRegionContainsPoint(rect, point)).toBe(expected)
    expect(surfaceRegionContainsFootprint(rect, [2, 0, -1], [2, 1, 1], 0)).toBe(true)
    expect(surfaceRegionContainsFootprint(rect, [2.01, 0, -1], [2, 1, 1], 0)).toBe(false)
  })

  test('polygon boundary is included and outside points are rejected', () => {
    const triangle: SurfaceRegion = {
      kind: 'polygon',
      points: [
        [0, 0],
        [2, 0],
        [0, 2],
      ],
    }
    expect(surfaceRegionContainsPoint(triangle, [0.5, 0.5])).toBe(true)
    expect(surfaceRegionContainsPoint(triangle, [1, 1])).toBe(true)
    expect(surfaceRegionContainsPoint(triangle, [1.1, 1.1])).toBe(false)
    expect(surfaceRegionContainsFootprint(triangle, [0.5, 0, 0.5], [0.5, 1, 0.5], 0)).toBe(true)
  })

  test('a concave notch rejects a footprint even when all four corners are inside', () => {
    const notched: SurfaceRegion = {
      kind: 'polygon',
      points: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [0.25, 2],
        [0.25, 0],
        [-0.25, 0],
        [-0.25, 2],
        [-2, 2],
      ],
    }
    expect(surfaceRegionContainsFootprint(notched, [0, 0, 0], [2, 1, 2], 0)).toBe(false)
    expect(surfaceRegionContainsFootprint(notched, [-1, 0, 0], [1, 1, 2], 0)).toBe(true)
  })

  for (const kind of ['rect', 'polygon'] as const) {
    test(`${kind}: sink cutout rejects hits, crossings, touching and a fully enclosed hole`, () => {
      const region: SurfaceRegion = {
        kind,
        size: [2, 2],
        points: [
          [-2, -2],
          [2, -2],
          [2, 2],
          [-2, 2],
        ],
        holes: [
          [
            [-0.2, -0.2],
            [0.2, -0.2],
            [0.2, 0.2],
            [-0.2, 0.2],
          ],
        ],
      }
      expect(surfaceRegionContainsPoint(region, [0, 0])).toBe(false)
      expect(surfaceRegionContainsPoint(region, [0.2, 0])).toBe(false)
      expect(surfaceRegionContainsFootprint(region, [0, 0, 0], [1, 1, 1], 0)).toBe(false)
      expect(surfaceRegionContainsFootprint(region, [0.4, 0, 0], [0.6, 1, 0.1], 0)).toBe(false)
      expect(surfaceRegionContainsFootprint(region, [0.7, 0, 0], [1, 1, 0.1], 0)).toBe(false)
      expect(surfaceRegionContainsFootprint(region, [1, 0, 0], [0.5, 1, 0.5], 0)).toBe(true)
    })
  }

  test('rotation can make a child fit or make it overhang', () => {
    const region: SurfaceRegion = { kind: 'rect', size: [1, 0.4] }
    expect(surfaceRegionContainsFootprint(region, [0, 0, 0], [0.5, 1, 1.5], 0)).toBe(false)
    expect(surfaceRegionContainsFootprint(region, [0, 0, 0], [0.5, 1, 1.5], Math.PI / 2)).toBe(true)
    expect(surfaceRegionContainsFootprint(region, [0, 0, 0], [1.5, 1, 0.5], Math.PI / 4)).toBe(
      false,
    )
  })

  test('an absent region is unbounded', () => {
    expect(surfaceRegionContainsPoint(undefined, [100, -100])).toBe(true)
    expect(surfaceRegionContainsFootprint(undefined, [100, 3, -100], [40, 1, 50], 2)).toBe(true)
  })
})
