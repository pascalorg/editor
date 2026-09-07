import { Vector3 } from 'three'
import {
  HAND_DEAD_ZONE,
  HAND_PINCH_RELEASE_DISTANCE,
  HAND_PINCH_TOUCH_DISTANCE,
  HAND_SPEED,
  HAND_TURN_SPEED,
  HAND_ZONE_RADIUS,
} from '../constants/human-mode-constants'

export function resolveHandJoystickArrowRotations(handedness: XRHandedness) {
  return handedness === 'right'
    ? [Math.PI / 2, -Math.PI / 2]
    : [0, Math.PI / 2, Math.PI, -Math.PI / 2]
}

export function resolveHandControlLabel(handedness: XRHandedness) {
  return handedness === 'left' ? 'MOVE' : 'TURN'
}

export function resolveHandPinching(previousPinching: boolean, distance: number) {
  if (!Number.isFinite(distance)) return false
  return previousPinching
    ? distance < HAND_PINCH_RELEASE_DISTANCE
    : distance <= HAND_PINCH_TOUCH_DISTANCE
}

const HAND_ZONE_HORIZONTAL_OFFSET = 0.2
const HAND_ZONE_HEIGHT = 0.93
const HAND_ZONE_DEPTH = -0.35
const HAND_ZONE_HEAD_VERTICAL_OFFSET = -0.25

export function getHandLocomotionZoneCenter(
  handedness: XRHandedness,
  target = new Vector3(),
  anchor?: Vector3,
) {
  if (!anchor)
    return target.set(
      handedness === 'right' ? HAND_ZONE_HORIZONTAL_OFFSET : -HAND_ZONE_HORIZONTAL_OFFSET,
      HAND_ZONE_HEIGHT,
      HAND_ZONE_DEPTH,
    )
  return target.set(
    anchor.x +
      (handedness === 'right' ? HAND_ZONE_HORIZONTAL_OFFSET : -HAND_ZONE_HORIZONTAL_OFFSET),
    anchor.y + HAND_ZONE_HEAD_VERTICAL_OFFSET,
    anchor.z + HAND_ZONE_DEPTH,
  )
}

export function isInsideHandLocomotionZone(
  position: Vector3,
  handedness: XRHandedness,
  anchor?: Vector3,
) {
  if (handedness !== 'left' && handedness !== 'right') return false
  const center = getHandLocomotionZoneCenter(handedness, new Vector3(), anchor)
  return (
    Math.hypot(position.x - center.x, position.z - center.z) <= HAND_ZONE_RADIUS &&
    Math.abs(position.y - center.y) <= HAND_ZONE_RADIUS
  )
}

export function normalizeHandLocomotionOffset(offset: number) {
  const distance = Math.abs(offset)
  if (!Number.isFinite(distance) || distance <= HAND_DEAD_ZONE) return 0
  const normalized = Math.min(1, (distance - HAND_DEAD_ZONE) / (HAND_ZONE_RADIUS - HAND_DEAD_ZONE))
  return Math.sign(offset) * normalized
}

export function resolveHandLocomotionVelocity(offset: number, delta: number, speed = HAND_SPEED) {
  if (!Number.isFinite(delta) || delta <= 0) return 0
  return normalizeHandLocomotionOffset(offset) * speed * delta
}

export function resolveHandTurnDelta(offset: number, delta: number) {
  return -normalizeHandLocomotionOffset(offset) * HAND_TURN_SPEED * Math.max(0, delta)
}
