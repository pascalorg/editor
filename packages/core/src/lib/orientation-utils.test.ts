import { describe, expect, test } from 'bun:test'
import {
  angularStep,
  normalizedRadialDirection,
  radialExtrudeRotationInHorizontalPlane,
  radialExtrudeRotationInLocalPlane,
  transformedLocalAxis,
} from './orientation-utils'

function expectVecClose(actual: number[], expected: number[], precision = 5) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index] ?? 0, precision)
  })
}

describe('orientation utils', () => {
  test('orients horizontal radial extrudes with profile X along radial and depth Z upward', () => {
    for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
      const rotation = radialExtrudeRotationInHorizontalPlane(angle, 0)

      expectVecClose(transformedLocalAxis(rotation, 'x'), normalizedRadialDirection(angle))
      expectVecClose(transformedLocalAxis(rotation, 'z'), [0, 1, 0])
      expect(rotation[1]).toBeCloseTo(0)
      expect(rotation[2]).toBeCloseTo(-angle)
    }
  })

  test('orients local-plane radial extrudes without laying them flat', () => {
    const angle = Math.PI / 3
    const rotation = radialExtrudeRotationInLocalPlane(angle, 0)

    expectVecClose(transformedLocalAxis(rotation, 'x'), [Math.cos(angle), Math.sin(angle), 0])
    expectVecClose(transformedLocalAxis(rotation, 'z'), [0, 0, 1])
  })

  test('computes stable circular angular steps', () => {
    expect(angularStep(0, 3)).toBeCloseTo(0)
    expect(angularStep(1, 3)).toBeCloseTo((Math.PI * 2) / 3)
    expect(angularStep(2, 3)).toBeCloseTo((Math.PI * 4) / 3)
    expect(angularStep(1, 4, Math.PI / 4)).toBeCloseTo((Math.PI * 3) / 4)
  })
})
