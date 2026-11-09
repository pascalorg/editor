import type { Vector3Tuple } from 'three'

let keyLightDirection: Vector3Tuple | null = null

/**
 * Aims the key (shadow-casting) light along a world direction, ahead of the
 * theme or atmosphere source. For captures that compose their own camera —
 * the worker thumbnail sets the sun relative to its hero angle so shadows
 * read instead of falling straight behind the building. `null` restores the
 * theme/atmosphere direction.
 */
export function setKeyLightDirectionOverride(direction: Vector3Tuple | null) {
  keyLightDirection = direction
}

export function getKeyLightDirectionOverride(): Vector3Tuple | null {
  return keyLightDirection
}
