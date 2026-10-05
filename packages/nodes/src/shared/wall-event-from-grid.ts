import {
  type AnyNode,
  type AnyNodeId,
  type GridEvent,
  isCurvedWall,
  type WallEvent,
} from '@pascal-app/core'
import { Matrix3, type Object3D, Vector3 } from 'three'

/** Canvas surface queries still reach the host when a rendered child consumes mesh events. */
export function wallEventFromGrid(
  event: GridEvent,
  activeLevelId: AnyNodeId | null,
  nodes: Record<AnyNodeId, AnyNode>,
  objects: ReadonlyMap<string, Object3D>,
): WallEvent | null {
  if (event.surfaceHit?.kind !== 'wall' || !event.surfaceNormal) return null
  const wall = nodes[event.surfaceHit.hostId]
  if (
    wall?.type !== 'wall' ||
    wall.visible === false ||
    wall.metadata.isTransient ||
    wall.parentId !== activeLevelId ||
    isCurvedWall(wall)
  )
    return null
  const object = objects.get(wall.id)
  const frame = event.localFrameId ? objects.get(event.localFrameId) : undefined
  if (!object || (event.localFrameId && !frame)) return null
  object.updateWorldMatrix(true, false)
  frame?.updateWorldMatrix(true, false)
  const normal = new Vector3(...event.surfaceNormal)
  if (frame) normal.applyNormalMatrix(new Matrix3().getNormalMatrix(frame.matrixWorld))
  normal.applyNormalMatrix(new Matrix3().getNormalMatrix(object.matrixWorld.clone().invert()))
  if (Math.abs(normal.z) <= 0.7) return null
  const position = object.worldToLocal(new Vector3(...event.position))
  return {
    node: wall,
    object,
    position: event.position,
    localPosition: position.toArray(),
    normal: normal.toArray(),
    nativeEvent: event.nativeEvent,
    stopPropagation: () => {},
  }
}
