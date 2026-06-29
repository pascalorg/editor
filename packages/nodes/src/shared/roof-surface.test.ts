import { describe, expect, test } from 'bun:test'
import type { RoofSegmentNode } from '@pascal-app/core'
import { getDownSlopeYaw, getRoofSurfaceFaceBoundsAt, getSurfaceY } from './roof-surface'

const fixtureSegment = (overrides?: Partial<RoofSegmentNode>): RoofSegmentNode =>
  ({
    object: 'node',
    id: 'rseg_fixture',
    type: 'roof-segment',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    roofType: 'gable',
    width: 8,
    depth: 6,
    wallHeight: 2.5,
    pitch: (Math.atan2(2, 3) * 180) / Math.PI,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    ...overrides,
  }) as RoofSegmentNode

describe('getDownSlopeYaw', () => {
  test('gable +z face: local +z already points down-slope (yaw 0)', () => {
    expect(getDownSlopeYaw(0, 1, fixtureSegment())).toBeCloseTo(0)
  })
  test('gable −z face: half-turn so +z faces the −z eave (yaw π)', () => {
    expect(getDownSlopeYaw(0, -1, fixtureSegment())).toBeCloseTo(Math.PI)
  })
  test('hip +x face yaws +π/2', () => {
    expect(getDownSlopeYaw(2, 0, fixtureSegment({ roofType: 'hip' }))).toBeCloseTo(Math.PI / 2)
  })
  test('hip −x face yaws −π/2', () => {
    expect(getDownSlopeYaw(-2, 0, fixtureSegment({ roofType: 'hip' }))).toBeCloseTo(-Math.PI / 2)
  })
  test('flat segment has no down-slope direction (yaw 0)', () => {
    expect(getDownSlopeYaw(0, 0, fixtureSegment({ roofType: 'flat' }))).toBe(0)
  })
  test('dutch width-axis shoulder falls toward the side eaves', () => {
    expect(getDownSlopeYaw(3.8, 0, fixtureSegment({ roofType: 'dutch' }))).toBeCloseTo(Math.PI / 2)
  })
  test('dutch width-axis front skirt yaws toward the front eave', () => {
    expect(getDownSlopeYaw(0, 1, fixtureSegment({ roofType: 'dutch' }))).toBeCloseTo(0)
  })
  test('dutch depth-axis top gable falls toward the side eaves', () => {
    expect(
      getDownSlopeYaw(1, 0, fixtureSegment({ roofType: 'dutch', width: 6, depth: 8 })),
    ).toBeCloseTo(Math.PI / 2)
  })
})

describe('getRoofSurfaceFaceBoundsAt', () => {
  test('gable face bounds use the visible shingle face, not the wall footprint', () => {
    const segment = fixtureSegment()
    const bounds = getRoofSurfaceFaceBoundsAt(segment, 0, 1)
    const xInterval = bounds.xIntervalAtZ(1)
    const zInterval = bounds.zIntervalAtX(0)

    expect(xInterval?.[0]).toBeLessThan(-segment.width / 2)
    expect(xInterval?.[1]).toBeGreaterThan(segment.width / 2)
    expect(zInterval?.[0]).toBeCloseTo(0)
    expect(zInterval?.[1]).toBeGreaterThan(segment.depth / 2)
    expect(bounds.surfaceYAt(0, 1)).toBeGreaterThan(getSurfaceY(0, 1, segment))
  })

  test('hip face bounds shrink guide endpoints to the active triangular face edge', () => {
    const bounds = getRoofSurfaceFaceBoundsAt(fixtureSegment({ roofType: 'hip' }), 0, 1)
    const ridgeInterval = bounds.xIntervalAtZ(0)

    expect(ridgeInterval?.[0]).toBeGreaterThan(-2)
    expect(ridgeInterval?.[1]).toBeLessThan(2)
  })

  test('mansard top surface rises to a center ridge instead of staying flat', () => {
    const segment = fixtureSegment({
      roofType: 'mansard',
      mansardSteepWidthRatio: 0.15,
      mansardSteepHeightRatio: 0.7,
    })

    const center = getRoofSurfaceFaceBoundsAt(segment, 0, 0).surfaceYAt(0, 0)
    const offRidge = getRoofSurfaceFaceBoundsAt(segment, 0, 0.5).surfaceYAt(0, 0.5)

    expect(center).toBeGreaterThan(offRidge)
  })

  test('dutch top surface rises from the waist to the center ridge', () => {
    const segment = fixtureSegment({
      roofType: 'dutch',
      dutchHipWidthRatio: 0.2,
      dutchHipHeightRatio: 0.6,
    })

    const center = getRoofSurfaceFaceBoundsAt(segment, 0, 0).surfaceYAt(0, 0)
    const waist = getRoofSurfaceFaceBoundsAt(segment, 0, 1.2).surfaceYAt(0, 1.2)

    expect(center).toBeGreaterThan(waist)
  })
})
