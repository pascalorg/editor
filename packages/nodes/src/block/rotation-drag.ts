import type { Vector3 } from 'three'

export function signedAngleAroundAxis(from: Vector3, to: Vector3, axis: Vector3): number {
  return Math.atan2(axis.dot(from.clone().cross(to)), from.dot(to))
}

export function lockedRotationAngleFromHits(
  origin: Vector3,
  initialHit: Vector3,
  currentHit: Vector3,
  axis: Vector3,
): number | null {
  const initialVector = initialHit.clone().sub(origin).projectOnPlane(axis)
  const currentVector = currentHit.clone().sub(origin).projectOnPlane(axis)
  if (initialVector.lengthSq() < 1e-6 || currentVector.lengthSq() < 1e-6) return null
  return signedAngleAroundAxis(initialVector.normalize(), currentVector.normalize(), axis)
}

export function unwrapRotationDelta(previous: number, current: number): number {
  let delta = current - previous
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}
