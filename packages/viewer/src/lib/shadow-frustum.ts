import * as THREE from 'three/webgpu'

const MIN_LIGHT_ELEVATION = 0.05
const GROUND_SHADOW_MARGIN = 1

const boxCorners = [
  [0, 0, 0],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 1],
  [1, 0, 0],
  [1, 0, 1],
  [1, 1, 0],
  [1, 1, 1],
] as const

export function expandBoundsByGroundShadow(
  target: THREE.Box3,
  source: THREE.Box3,
  lightDirection: THREE.Vector3,
  groundY = Math.min(0, source.min.y),
) {
  target.copy(source)

  if (source.isEmpty() || lightDirection.y <= MIN_LIGHT_ELEVATION) return target

  const point = new THREE.Vector3()
  const projected = new THREE.Vector3()

  for (const [x, y, z] of boxCorners) {
    point.set(
      x === 0 ? source.min.x : source.max.x,
      y === 0 ? source.min.y : source.max.y,
      z === 0 ? source.min.z : source.max.z,
    )

    if (point.y <= groundY) continue

    const distanceToGround = (point.y - groundY) / lightDirection.y
    projected.set(
      point.x - lightDirection.x * distanceToGround,
      groundY,
      point.z - lightDirection.z * distanceToGround,
    )
    target.expandByPoint(projected)
  }

  target.expandByScalar(GROUND_SHADOW_MARGIN)
  return target
}

export function fitShadowSphereFromBox(box: THREE.Box3, target: THREE.Sphere) {
  box.getBoundingSphere(target)
  return target
}
