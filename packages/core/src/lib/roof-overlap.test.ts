// @ts-expect-error — bun:test is provided by the Bun runtime; core does not depend on @types/bun.
import { describe, expect, test } from 'bun:test'
import { getRoofPlanBounds, roofOverlapEntryOwns, roofPlanBoundsOverlap } from './roof-overlap'

describe('roof overlap', () => {
  test('larger segments own intersections with stable ID tie-breaking', () => {
    const current = { roofId: 'roof_b', segmentId: 'seg_b', width: 4, depth: 4 }
    expect(
      roofOverlapEntryOwns({ ...current, roofId: 'roof_a', segmentId: 'seg_a' }, current),
    ).toBe(true)
    expect(roofOverlapEntryOwns({ ...current, width: 5 }, current)).toBe(true)
    expect(roofOverlapEntryOwns({ ...current, width: 3 }, current)).toBe(false)
  })

  test('computes rotated world bounds and rejects distant roofs', () => {
    const bounds = getRoofPlanBounds({
      position: [10, 0, 4],
      rotation: Math.PI / 2,
      segments: [{ position: [0, 0, 0], rotation: 0, width: 6, depth: 2 }],
    })!
    expect(bounds.minX).toBeCloseTo(9)
    expect(bounds.maxX).toBeCloseTo(11)
    expect(bounds.minZ).toBeCloseTo(1)
    expect(bounds.maxZ).toBeCloseTo(7)
    expect(roofPlanBoundsOverlap(bounds, { minX: 10, minZ: 6, maxX: 12, maxZ: 8 })).toBe(true)
    expect(roofPlanBoundsOverlap(bounds, { minX: 20, minZ: 20, maxX: 22, maxZ: 22 })).toBe(false)
  })
})
