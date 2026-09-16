import {
  type AnyNode,
  type CabinetEvent,
  type ItemEvent,
  type ShelfEvent,
  type SurfaceHit,
  sceneRegistry,
} from '@pascal-app/core'
import { Matrix3, type Matrix4, Vector3 } from 'three'

export function surfaceWorldNormalY(normal: ItemEvent['normal'], matrixWorld: Matrix4): number {
  return normal
    ? new Vector3(...normal)
        .applyNormalMatrix(new Matrix3().getNormalMatrix(matrixWorld))
        .normalize().y
    : Number.NaN
}

export function itemEventToSurfaceHit(
  host: AnyNode,
  event: ItemEvent | ShelfEvent | CabinetEvent,
): SurfaceHit | null {
  const mesh = sceneRegistry.nodes.get(host.id)
  if (!mesh) return null
  return {
    point: mesh.worldToLocal(new Vector3(...event.position)).toArray(),
    normalWorldY: surfaceWorldNormalY(event.normal, event.object.matrixWorld),
    meshName: event.object.name,
  }
}
