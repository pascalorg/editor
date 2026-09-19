// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import type { XRControllerState } from '@react-three/xr'
import { Vector3 } from 'three'
import {
  getCameraRelativeRight,
  getControllerThumbstickAxis,
  normalizeMovementVector,
  resolveLocomotionDelta,
} from './locomotion'

function controllerWithAxes(axes: number[]) {
  return { inputSource: { gamepad: { axes } } } as unknown as XRControllerState
}

describe('Human controller locomotion', () => {
  test('reads both XR thumbstick axis layouts', () => {
    expect(getControllerThumbstickAxis(controllerWithAxes([0.25, -0.5]), 0)).toBe(0.25)
    expect(getControllerThumbstickAxis(controllerWithAxes([0, 0, 0.4, -0.6]), 1)).toBe(-0.6)
  })

  test('keeps movement relative to the viewer heading', () => {
    const right = new Vector3()
    expect(getCameraRelativeRight(new Vector3(0, 0, -1), right).toArray()).toEqual([1, 0, 0])
    expect(getCameraRelativeRight(new Vector3(0, 0, 1), right).toArray()).toEqual([-1, 0, 0])
  })

  test('caps stalled frames and normalizes diagonal movement', () => {
    expect(resolveLocomotionDelta(1)).toBeCloseTo(1 / 30)
    expect(resolveLocomotionDelta(1 / 60)).toBeCloseTo(1 / 60)
    expect(resolveLocomotionDelta(0)).toBe(0)
    expect(normalizeMovementVector(1, 1).x).toBeCloseTo(1 / Math.sqrt(2))
    expect(normalizeMovementVector(1, 1).z).toBeCloseTo(1 / Math.sqrt(2))
  })
})
