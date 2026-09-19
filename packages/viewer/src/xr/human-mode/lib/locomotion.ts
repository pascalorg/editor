import type { XRControllerState } from '@react-three/xr'
import { Vector3 as ThreeVector3, type Vector3 } from 'three'

export const MAX_LOCOMOTION_DELTA = 1 / 30

let artificialMovementSpeed = 0

export function resolveLocomotionDelta(deltaSeconds: number, maximum = MAX_LOCOMOTION_DELTA) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0
  return Math.min(deltaSeconds, maximum)
}

export function getControllerThumbstickAxis(
  controllerState: XRControllerState | undefined,
  axis: 0 | 1,
) {
  const axes = controllerState?.inputSource.gamepad?.axes
  const axisOffset = axes && axes.length >= 4 ? 2 : 0
  const axisValue = axes?.[axisOffset + axis]
  if (Number.isFinite(axisValue)) return axisValue!

  const thumbstick = controllerState?.gamepad?.['xr-standard-thumbstick']
  return axis === 0 ? (thumbstick?.xAxis ?? 0) : (thumbstick?.yAxis ?? 0)
}

export function normalizeMovementVector(x: number, z: number) {
  const length = Math.hypot(x, z)
  if (!Number.isFinite(length) || length === 0) return { x: 0, z: 0 }
  const scale = Math.min(1, 1 / length)
  return { x: x * scale, z: z * scale }
}

export function getCameraRelativeRight(forward: Vector3, target = new ThreeVector3()) {
  return target.set(-forward.z, 0, forward.x).normalize()
}

export function setArtificialMovementSpeed(speed: number) {
  artificialMovementSpeed = Number.isFinite(speed) ? Math.abs(speed) : 0
}

export function getArtificialMovementSpeed() {
  return artificialMovementSpeed
}
