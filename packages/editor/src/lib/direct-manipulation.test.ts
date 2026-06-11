import { DEFAULT_ANGLE_STEP } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import {
  resolveDirectRotationDragDelta,
  snapDirectRotationDelta,
} from './direct-manipulation'

describe('snapDirectRotationDelta', () => {
  test('snaps rotation deltas to the default angle increment', () => {
    expect(snapDirectRotationDelta(DEFAULT_ANGLE_STEP * 0.49, false)).toBe(0)
    expect(snapDirectRotationDelta(DEFAULT_ANGLE_STEP * 0.51, false)).toBeCloseTo(
      DEFAULT_ANGLE_STEP,
    )
    expect(snapDirectRotationDelta(DEFAULT_ANGLE_STEP * -1.49, false)).toBeCloseTo(
      -DEFAULT_ANGLE_STEP,
    )
  })

  test('keeps the raw rotation delta while free-rotating', () => {
    const rawDelta = DEFAULT_ANGLE_STEP * 0.42
    expect(snapDirectRotationDelta(rawDelta, true)).toBe(rawDelta)
  })
})

describe('resolveDirectRotationDragDelta', () => {
  test('maps horizontal pointer motion to the direct rotation delta direction', () => {
    const radiansPerPixel = DEFAULT_ANGLE_STEP / 12

    expect(resolveDirectRotationDragDelta(100, 112, radiansPerPixel, false)).toBeCloseTo(
      -DEFAULT_ANGLE_STEP,
    )
    expect(resolveDirectRotationDragDelta(100, 88, radiansPerPixel, false)).toBeCloseTo(
      DEFAULT_ANGLE_STEP,
    )
  })

  test('keeps unsnapped drag deltas while free-rotating', () => {
    expect(resolveDirectRotationDragDelta(100, 103, 0.1, true)).toBeCloseTo(-0.3)
  })
})
