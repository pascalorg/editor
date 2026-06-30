import { describe, expect, test } from 'bun:test'
import { getRoofSegmentSurfaceY, ROOF_SHAPE_DEFAULTS, RoofSegmentNode } from './roof-segment'

describe('getRoofSegmentSurfaceY', () => {
  test('keeps the Dutch width-axis rake on the upper gable slope', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      wallHeight: 3,
      pitch: 40,
    })
    const activeRh = getRoofSegmentSurfaceY(segment, 0, 0) - segment.wallHeight
    const upperRise = activeRh * (1 - segment.dutchHipHeightRatio)
    const waistHalfZ =
      segment.depth / 2 - Math.min(segment.width, segment.depth) * segment.dutchHipWidthRatio
    const availableRake = Math.max(
      0,
      segment.width / 2 -
        (segment.width / 2 - Math.min(segment.width, segment.depth) * segment.dutchHipWidthRatio) *
          segment.dutchWaistLengthRatio,
    )
    const rakeReach = Math.min(segment.dutchGabletRake, availableRake * 0.98)
    const localX =
      (segment.width / 2 - Math.min(segment.width, segment.depth) * segment.dutchHipWidthRatio) *
        segment.dutchWaistLengthRatio +
      rakeReach * 0.5
    const localZ = waistHalfZ * 0.5

    const expected = segment.wallHeight + activeRh - localZ * (upperRise / waistHalfZ)

    expect(localX).toBeGreaterThan(
      (segment.width / 2 - Math.min(segment.width, segment.depth) * segment.dutchHipWidthRatio) *
        segment.dutchWaistLengthRatio,
    )
    expect(getRoofSegmentSurfaceY(segment, localX, localZ)).toBeCloseTo(expected, 6)
  })

  test('keeps the Dutch depth-axis rake on the upper gable slope', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 6,
      depth: 8,
      wallHeight: 3,
      pitch: 40,
    })
    const activeRh = getRoofSegmentSurfaceY(segment, 0, 0) - segment.wallHeight
    const upperRise = activeRh * (1 - segment.dutchHipHeightRatio)
    const waistHalfX =
      segment.width / 2 - Math.min(segment.width, segment.depth) * segment.dutchHipWidthRatio
    const innerWaistHalfZ =
      (segment.depth / 2 - Math.min(segment.width, segment.depth) * segment.dutchHipWidthRatio) *
      segment.dutchWaistLengthRatio
    const rakeReach = Math.min(
      segment.dutchGabletRake ?? ROOF_SHAPE_DEFAULTS.dutchGabletRake,
      Math.max(0, segment.depth / 2 - innerWaistHalfZ) * 0.98,
    )
    const localX = waistHalfX * 0.5
    const localZ = innerWaistHalfZ + rakeReach * 0.5

    const expected = segment.wallHeight + activeRh - localX * (upperRise / waistHalfX)

    expect(localZ).toBeGreaterThan(innerWaistHalfZ)
    expect(getRoofSegmentSurfaceY(segment, localX, localZ)).toBeCloseTo(expected, 6)
  })
})
