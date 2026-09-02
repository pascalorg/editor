import type { Matrix4, Plane, Vector3 } from 'three'

export function applyXRReferenceSpaceRayToWorld(
  origin: Vector3,
  direction: Vector3,
  originMatrix: Matrix4,
) {
  origin.applyMatrix4(originMatrix)
  direction.transformDirection(originMatrix)
}

export function setObjectFloorPlane(
  plane: Plane,
  objectMatrix: Matrix4,
  point: Vector3,
  normal: Vector3,
) {
  plane.setFromNormalAndCoplanarPoint(
    normal.set(0, 1, 0).transformDirection(objectMatrix),
    point.set(0, 0, 0).applyMatrix4(objectMatrix),
  )
}
