import { type Matrix4, Plane, type Ray, Vector3 } from 'three'

export function createSpatialDragPlane(point: Vector3, ray: Ray, localToWorld?: Matrix4) {
  const normal = new Vector3(0, 1, 0)
  if (localToWorld) normal.transformDirection(localToWorld)
  // A nearly horizontal controller ray cannot reliably intersect a floor plane.
  if (Math.abs(normal.dot(ray.direction)) < 0.2) normal.copy(ray.direction)
  return new Plane().setFromNormalAndCoplanarPoint(normal, point)
}

export function intersectSpatialDragPlane(ray: Ray, plane: Plane, target: Vector3) {
  if (Math.abs(plane.normal.dot(ray.direction)) < 0.05) return null
  return ray.intersectPlane(plane, target)
}

// Freeze this frame at grab time; world metres differ from model metres in God view.
export function spatialDragLocalY(worldPoint: Vector3, worldToLocal: Matrix4) {
  return worldPoint.clone().applyMatrix4(worldToLocal).y
}
