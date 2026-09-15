import { MIN_WALL_HEIGHT } from '@pascal-app/core'
import { type Matrix4, Plane, Ray, Vector3 } from 'three'

export function createWallHeightDrag({
  initialRay,
  levelMatrixWorld,
  midpoint,
  initialHeight,
}: {
  initialRay: Ray
  levelMatrixWorld: Matrix4
  midpoint: Vector3
  initialHeight: number
}): ((ray: Ray) => number | null) | null {
  // Measure in the level's frame so God-mode scale/rotation cannot change
  // the meaning of a metre of wall height. The pointer owns the drag plane,
  // rather than a desktop camera that may not be the active XR camera.
  const worldToLevel = levelMatrixWorld.clone().invert()
  const localRay = new Ray().copy(initialRay).applyMatrix4(worldToLevel)
  const normal = localRay.direction.clone().setY(0)
  if (normal.lengthSq() < 1e-8) return null
  const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), midpoint)
  const hit = new Vector3()
  if (!localRay.intersectPlane(plane, hit)) return null
  const initialY = hit.y

  return (ray) => {
    localRay.copy(ray).applyMatrix4(worldToLevel)
    if (!localRay.intersectPlane(plane, hit)) return null
    return Math.max(MIN_WALL_HEIGHT, initialHeight + hit.y - initialY)
  }
}
