// @ts-expect-error — bun:test is provided by the Bun runtime; core does not depend on @types/bun.
import { describe, expect, test } from 'bun:test'
import {
  getRoofPlanBounds,
  roofOverlapEntryOwns,
  roofPlanBoundsOverlap,
  roofPlanOverlapEntryOwns,
} from './roof-overlap'

describe('roof overlap', () => {
  test('larger segments own intersections with stable ID tie-breaking', () => {
    const current = { roofId: 'roof_b', segmentId: 'seg_b', width: 4, depth: 4 }
    expect(
      roofOverlapEntryOwns({ ...current, roofId: 'roof_a', segmentId: 'seg_a' }, current),
    ).toBe(true)
    expect(roofOverlapEntryOwns({ ...current, width: 5 }, current)).toBe(true)
    expect(roofOverlapEntryOwns({ ...current, width: 3 }, current)).toBe(false)
  })

  test('a declared host roof clips its mounted conical roof', () => {
    const host = {
      roofId: 'roof_host',
      segmentId: 'seg_host',
      roofType: 'gable',
      width: 10,
      depth: 8,
    }
    const conical = {
      roofId: 'roof_tower',
      segmentId: 'seg_tower',
      roofType: 'conical',
      width: 3,
      depth: 3,
      supportRoofId: host.roofId,
      supportRoofSegmentId: host.segmentId,
    }

    expect(roofOverlapEntryOwns(conical, host)).toBe(false)
    expect(roofOverlapEntryOwns(host, conical)).toBe(true)
    expect(roofPlanOverlapEntryOwns(conical, host)).toBe(true)
    expect(roofPlanOverlapEntryOwns(host, conical)).toBe(false)
  })

  test('a ground conical roof does not automatically cut a larger roof', () => {
    const host = {
      roofId: 'roof_host',
      segmentId: 'seg_host',
      roofType: 'gable',
      width: 10,
      depth: 8,
    }
    const groundConical = {
      roofId: 'roof_tower',
      segmentId: 'seg_tower',
      roofType: 'conical',
      width: 3,
      depth: 3,
    }

    expect(roofOverlapEntryOwns(groundConical, host)).toBe(false)
    expect(roofOverlapEntryOwns(host, groundConical)).toBe(true)
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
