// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import { HAND_TURN_SPEED, HAND_ZONE_RADIUS } from '../constants/human-mode-constants'
import { resolveComfortOpacity } from './comfort'
import {
  getHandLocomotionZoneCenter,
  isInsideHandLocomotionZone,
  normalizeHandLocomotionOffset,
  resolveHandControlLabel,
  resolveHandLocomotionVelocity,
  resolveHandPinching,
  resolveHandTurnDelta,
} from './hand-locomotion'
import { resolveSnapTurnDirection, SNAP_TURN_ANGLE, shouldSnapTurn } from './snap-turn'

describe('Human hand locomotion', () => {
  test('mirrors body-relative activation zones', () => {
    const anchor = new Vector3(3, 1.6, -4)
    const left = getHandLocomotionZoneCenter('left', new Vector3(), anchor)
    const right = getHandLocomotionZoneCenter('right', new Vector3(), anchor)
    expect(left.toArray()).toEqual([2.8, 1.35, -4.35])
    expect(right.x).toBeCloseTo(3.2)
    expect(isInsideHandLocomotionZone(left, 'left', anchor)).toBe(true)
    expect(isInsideHandLocomotionZone(left, 'right', anchor)).toBe(false)
  })

  test('applies dead zones, pinch hysteresis, and hand roles', () => {
    expect(normalizeHandLocomotionOffset(0.014)).toBe(0)
    expect(normalizeHandLocomotionOffset(HAND_ZONE_RADIUS)).toBe(1)
    expect(resolveHandPinching(false, 0.03)).toBe(true)
    expect(resolveHandPinching(false, 0.035)).toBe(false)
    expect(resolveHandPinching(true, 0.04)).toBe(true)
    expect(resolveHandPinching(true, 0.045)).toBe(false)
    expect(resolveHandControlLabel('left')).toBe('MOVE')
    expect(resolveHandControlLabel('right')).toBe('TURN')
  })

  test('scales movement and turning from hand displacement', () => {
    expect(resolveHandLocomotionVelocity(HAND_ZONE_RADIUS, 0.1)).toBeCloseTo(0.15)
    expect(HAND_TURN_SPEED).toBe(Math.PI / 2)
    expect(resolveHandTurnDelta(HAND_ZONE_RADIUS, 1)).toBe(-Math.PI / 2)
  })
})

describe('Human comfort and snap turn', () => {
  test('scales the vignette with artificial movement speed', () => {
    expect(resolveComfortOpacity(0)).toBe(0)
    expect(resolveComfortOpacity(0.75)).toBeCloseTo(0.11)
    expect(resolveComfortOpacity(3)).toBeCloseTo(0.22)
  })

  test('turns once per stick threshold crossing', () => {
    expect(resolveSnapTurnDirection(0.8)).toBe(1)
    expect(shouldSnapTurn(0, 1)).toBe(true)
    expect(shouldSnapTurn(1, 1)).toBe(false)
    expect(resolveSnapTurnDirection(0.1)).toBe(0)
    expect(SNAP_TURN_ANGLE).toBe(Math.PI / 6)
  })
})
