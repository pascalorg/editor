import * as THREE from 'three'

/**
 * Shear that leans a tilted wall across its thickness. The base stays on the
 * wall line and every point moves along the wall's local Z by `y · tan(tilt)`,
 * so a positive tilt leans the top toward the wall's +Z face. `inverse` undoes
 * it, taking sheared wall-local geometry back to the upright wall frame.
 * Returns null for an upright wall.
 */
export function wallTiltShear(tilt: number | undefined, inverse = false): THREE.Matrix4 | null {
  if (!tilt) return null
  const shift = Math.tan(tilt) * (inverse ? -1 : 1)
  // makeShear(xy, xz, yx, yz, zx, zy): the `yz` term adds `shift · y` to z.
  return new THREE.Matrix4().makeShear(0, 0, 0, shift, 0, 0)
}
