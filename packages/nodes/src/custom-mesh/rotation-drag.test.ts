import { describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import { signedAngleAroundAxis, unwrapRotationDelta } from './rotation-drag'

describe('custom mesh rotation drag', () => {
  test('derives rotation direction around the chosen axis', () => {
    const from = new Vector3(1, 0, 0)
    const to = new Vector3(0, 0, -1)

    expect(signedAngleAroundAxis(from, to, new Vector3(0, 1, 0))).toBeCloseTo(Math.PI / 2)
    expect(signedAngleAroundAxis(from, to, new Vector3(0, -1, 0))).toBeCloseTo(-Math.PI / 2)
  })

  test('continues smoothly when the pointer crosses the angle seam', () => {
    const previous = (179 * Math.PI) / 180
    const current = (-179 * Math.PI) / 180

    expect(unwrapRotationDelta(previous, current)).toBeCloseTo((2 * Math.PI) / 180)
    expect(unwrapRotationDelta(current, previous)).toBeCloseTo((-2 * Math.PI) / 180)
  })
})
