import { describe, expect, test } from 'bun:test'
import type { RoofSegmentNode } from '@pascal-app/core'
import { getDownSlopeYaw } from './roof-surface'

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
})
