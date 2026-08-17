import type { Vector3 } from 'three'

export function signedAngleAroundAxis(from: Vector3, to: Vector3, axis: Vector3): number {
  return Math.atan2(axis.dot(from.clone().cross(to)), from.dot(to))
}

export function unwrapRotationDelta(previous: number, current: number): number {
  let delta = current - previous
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}
