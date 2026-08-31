import { describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import {
  lockedRotationAngleFromHits,
  signedAngleAroundAxis,
  unwrapRotationDelta,
} from './rotation-drag'

describe('block rotation drag', () => {
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

  test('uses the gizmo direction when rotation is locked to Y', () => {
    const angle = lockedRotationAngleFromHits(
      new Vector3(),
      new Vector3(1, 0, 0),
      new Vector3(0, 0, -1),
      new Vector3(0, 1, 0),
    )

    expect(angle).toBeCloseTo(Math.PI / 2)
  })

  test('waits for a direction when axis locking starts on the pivot', () => {
    expect(
      lockedRotationAngleFromHits(
        new Vector3(),
        new Vector3(),
        new Vector3(0, 0, -1),
        new Vector3(0, 1, 0),
      ),
    ).toBeNull()
  })
})
