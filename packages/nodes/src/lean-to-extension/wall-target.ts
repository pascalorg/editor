import type { DoorEvent, WallEvent, WallNode } from '@pascal-app/core'
import type { Object3D } from 'three'
import { Vector3 } from 'three'

/**
 * Re-attributes a hosted door hit to its wall while preserving the hit in
 * world space. Door face normals are local to the intersected door object;
 * converting through that object keeps rotated doors and hosted cutout meshes
 * aligned with the wall's local placement frame.
 */
export function resolveLeanToDoorWallTarget(
  event: DoorEvent,
  wall: WallNode,
  wallObject: Object3D,
): WallEvent {
  wallObject.updateWorldMatrix(true, false)
  event.object.updateWorldMatrix(true, false)

  const worldPoint = new Vector3(...event.position)
  const localPoint = wallObject.worldToLocal(worldPoint.clone())
  const normal = event.normal
    ? (() => {
        const objectOrigin = event.object.localToWorld(new Vector3())
        const objectNormalPoint = event.object.localToWorld(new Vector3(...event.normal!))
        const worldNormal = objectNormalPoint.sub(objectOrigin).normalize()
        const localNormalPoint = wallObject.worldToLocal(worldPoint.clone().add(worldNormal))
        return localNormalPoint.sub(localPoint).normalize()
      })()
    : new Vector3(0, 0, localPoint.z >= 0 ? 1 : -1)

  return {
    ...event,
    node: wall,
    localPosition: [localPoint.x, localPoint.y, localPoint.z],
    normal: [normal.x, normal.y, normal.z],
    object: wallObject,
  }
}
