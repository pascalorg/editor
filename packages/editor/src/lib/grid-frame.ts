import type { Object3D, Vector3 } from 'three'

export function gridLocalPoint(parent: Object3D | null, world: Vector3, target: Vector3) {
  target.copy(world)
  if (parent) {
    parent.updateWorldMatrix(true, false)
    parent.worldToLocal(target)
  }
  return target
}

export function gridLocalNormal(parent: Object3D | null, normal: Vector3, target: Vector3) {
  target.copy(normal)
  if (parent) target.transformDirection(parent.matrixWorld.clone().invert())
  return target
}
