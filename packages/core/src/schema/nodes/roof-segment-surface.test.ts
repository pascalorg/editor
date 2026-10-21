import { describe, expect, test } from 'bun:test'
import {
  getActiveRoofHeight,
  getRoofSegmentSurfaceY,
  ROOF_SHAPE_DEFAULTS,
  RoofSegmentNode,
} from '@pascal-app/core'

describe('getRoofSegmentSurfaceY', () => {
  test('falls linearly from a conical apex in every radial direction', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'conical',
      width: 8,
      depth: 8,
      wallHeight: 2,
      pitch: 45,
    })

    expect(getRoofSegmentSurfaceY(segment, 0, 0)).toBeCloseTo(6, 6)
    expect(getRoofSegmentSurfaceY(segment, 2, 0)).toBeCloseTo(4, 6)
    expect(getRoofSegmentSurfaceY(segment, 0, 4)).toBeCloseTo(2, 6)
    expect(getRoofSegmentSurfaceY(segment, Math.SQRT2, Math.SQRT2)).toBeCloseTo(4, 6)
  })

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

test('gambrel surface follows its lower and upper slopes across the kink', () => {
  const node = RoofSegmentNode.parse({
    roofType: 'gambrel',
    width: 10,
    depth: 8,
    wallHeight: 0,
    pitch: 45,
  })
  const peak = getActiveRoofHeight(node)
  expect(getRoofSegmentSurfaceY(node, 0, 3)).toBeCloseTo(1, 6)
  expect(getRoofSegmentSurfaceY(node, 0, 2)).toBeCloseTo(2, 6)
  expect(getRoofSegmentSurfaceY(node, 0, 1)).toBeCloseTo((peak + 2) / 2, 6)
})

test('mansard surface includes the shoulder and a ridge on rectangular footprints', () => {
  const node = RoofSegmentNode.parse({
    roofType: 'mansard',
    width: 12,
    depth: 8,
    wallHeight: 0,
    pitch: 45,
  })
  const peak = getActiveRoofHeight(node)
  expect(getRoofSegmentSurfaceY(node, 0, 3.4)).toBeCloseTo(0.6, 6)
  expect(getRoofSegmentSurfaceY(node, 0, 2.8)).toBeCloseTo(1.2, 6)
  expect(getRoofSegmentSurfaceY(node, 1, 0)).toBeCloseTo(peak, 6)
  expect(getRoofSegmentSurfaceY(node, 5.4, 0)).toBeCloseTo(0.6, 6)
})

test('rectangular hip surface stays at crown height along the ridge in either orientation', () => {
  for (const [width, depth, x, z] of [
    [10, 6, 1, 0],
    [6, 10, 0, 1],
  ]) {
    const node = RoofSegmentNode.parse({ roofType: 'hip', width, depth, wallHeight: 0, pitch: 45 })
    expect(getRoofSegmentSurfaceY(node, x!, z!)).toBeCloseTo(3, 6)
  }
})
