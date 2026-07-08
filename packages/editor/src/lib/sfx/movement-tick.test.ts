import { describe, expect, test } from 'bun:test'
import { movementSfxStepKey } from './movement-tick'

describe('movementSfxStepKey', () => {
  test('keeps tiny free-move changes in the same bucket', () => {
    expect(
      movementSfxStepKey({
        coords: [1.01, 2.04],
        gridSnapActive: false,
        gridStep: 0.5,
      }),
    ).toBe(
      movementSfxStepKey({
        coords: [1.04, 2.01],
        gridSnapActive: false,
        gridStep: 0.5,
      }),
    )
  })

  test('changes bucket after crossing the free-move cadence', () => {
    expect(
      movementSfxStepKey({
        coords: [1.01, 2.04],
        gridSnapActive: false,
        gridStep: 0.5,
      }),
    ).not.toBe(
      movementSfxStepKey({
        coords: [1.16, 2.04],
        gridSnapActive: false,
        gridStep: 0.5,
      }),
    )
  })

  test('uses the live grid step when grid snapping is active', () => {
    expect(
      movementSfxStepKey({
        coords: [0.24, 0],
        gridSnapActive: true,
        gridStep: 0.5,
      }),
    ).toBe(
      movementSfxStepKey({
        coords: [0.21, 0],
        gridSnapActive: true,
        gridStep: 0.5,
      }),
    )
    expect(
      movementSfxStepKey({
        coords: [0.24, 0],
        gridSnapActive: true,
        gridStep: 0.5,
      }),
    ).not.toBe(
      movementSfxStepKey({
        coords: [0.76, 0],
        gridSnapActive: true,
        gridStep: 0.5,
      }),
    )
  })
})
