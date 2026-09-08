import {
  type AnyNodeId,
  findLevelAncestorId,
  type GridEvent,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { Matrix3, Raycaster, Vector3 } from 'three'

export function accessoryCursor(
  event: GridEvent,
  levelId: AnyNodeId,
): { point: [number, number, number]; surface: boolean; normal?: [number, number, number] } {
  const level = sceneRegistry.nodes.get(levelId)
  const toLocal = (point: Vector3) => (level ? level.worldToLocal(point.clone()) : point.clone())
  if (event.localRay) {
    const frame = event.localFrameId ? sceneRegistry.nodes.get(event.localFrameId) : null
    const origin = new Vector3(...event.localRay.origin)
    const direction = new Vector3(...event.localRay.direction)
    if (frame) {
      frame.localToWorld(origin)
      direction.transformDirection(frame.matrixWorld)
    }
    const raycaster = new Raycaster(origin, direction)
    const nodes = useScene.getState().nodes
    let closest = Infinity
    let result: ReturnType<typeof accessoryCursor> | null = null
    const candidateIds = event.surfaceHit
      ? [event.surfaceHit.hostId]
      : (['wall', 'ceiling', 'slab', 'roof'] as const).flatMap(
          (type) => sceneRegistry.byType[type] ?? [],
        )
    for (const id of candidateIds) {
      const node = nodes[id as AnyNodeId]
      if (!node) continue
      if (['site', 'building', 'level', 'zone', 'group'].includes(node.type)) continue
      if (findLevelAncestorId(node.id, nodes) !== levelId || !node.visible) continue
      const root = sceneRegistry.nodes.get(node.id)
      if (!root?.visible) continue
      const hit = raycaster.intersectObject(root, true).find((candidate) => {
        let object = candidate.object
        while (object) {
          if (!object.visible) return false
          if (!object.parent) break
          object = object.parent
        }
        if (node.type === 'ceiling') {
          const normal = candidate.face?.normal
            .clone()
            .applyNormalMatrix(new Matrix3().getNormalMatrix(candidate.object.matrixWorld))
          if (!normal || normal.y >= -0.5) return false
        }
        return true
      })
      if (!hit || hit.distance >= closest) continue
      closest = hit.distance
      const point = toLocal(hit.point)
      const normal = hit.face?.normal
        .clone()
        .applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
        .normalize()
      const localNormal = normal
        ? toLocal(hit.point.clone().add(normal)).sub(point).normalize()
        : undefined
      result = { point: point.toArray(), surface: true, normal: localNormal?.toArray() }
    }
    if (result) return result
  }
  const point = toLocal(new Vector3(...event.position))
  const frame = event.localFrameId ? sceneRegistry.nodes.get(event.localFrameId) : null
  const normal = event.surfaceNormal ? new Vector3(...event.surfaceNormal) : undefined
  if (normal && frame) normal.transformDirection(frame.matrixWorld)
  const localNormal = normal
    ? toLocal(new Vector3(...event.position).add(normal))
        .sub(point)
        .normalize()
    : undefined
  return {
    point: point.toArray(),
    surface: !!event.surfaceLocalPosition,
    normal: localNormal?.toArray(),
  }
}
