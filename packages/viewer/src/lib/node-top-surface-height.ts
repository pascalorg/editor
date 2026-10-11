import { type AnyNodeId, sceneRegistry } from '@pascal-app/core'
import { Box3, Matrix3, type Object3D, Raycaster, Vector3 } from 'three'
import useViewer from '../store/use-viewer'
import { setSurfaceRaycastLayers } from './layers'

type HeightSampler = (x: number, z: number) => number | null
type CachedSampler = {
  revision: number
  hostMatrix: number[]
  levelMatrix: number[]
  sample: HeightSampler
}
const samplerCache = new WeakMap<Object3D, WeakMap<Object3D, CachedSampler>>()

/** Samples one locked node's upward-facing mesh in level-local coordinates. */
export function createNodeTopSurfaceHeightSampler(
  hostId: AnyNodeId,
  levelId: AnyNodeId,
): HeightSampler | null {
  const host = sceneRegistry.nodes.get(hostId)
  const level = sceneRegistry.nodes.get(levelId)
  if (!(host && level)) return null

  host.updateWorldMatrix(true, false)
  level.updateWorldMatrix(true, false)
  const revision = useViewer.getState().geometryRevision
  const cached = samplerCache.get(host)?.get(level)
  if (
    cached?.revision === revision &&
    cached.hostMatrix.every((value, index) => value === host.matrixWorld.elements[index]) &&
    cached.levelMatrix.every((value, index) => value === level.matrixWorld.elements[index])
  ) {
    return cached.sample
  }
  host.updateWorldMatrix(true, true)
  const bounds = new Box3().setFromObject(host)
  if (bounds.isEmpty()) return null

  const raycaster = new Raycaster()
  setSurfaceRaycastLayers(raycaster.layers)
  raycaster.far = Math.max(4, bounds.max.y - bounds.min.y + 4)
  const origin = new Vector3()
  const direction = new Vector3(0, -1, 0)
  const normal = new Vector3()
  const normalMatrix = new Matrix3()
  const registeredRoots = new Set(sceneRegistry.nodes.values())

  const sample: HeightSampler = (x, z) => {
    origin.set(x, 0, z)
    level.localToWorld(origin)
    origin.y = bounds.max.y + 2
    raycaster.set(origin, direction)

    for (const hit of raycaster.intersectObject(host, true)) {
      if (!hit.face) continue
      let owner = hit.object.parent
      let nestedNode = false
      while (owner && owner !== host) {
        if (registeredRoots.has(owner)) {
          nestedNode = true
          break
        }
        owner = owner.parent
      }
      if (nestedNode) continue

      normalMatrix.getNormalMatrix(hit.object.matrixWorld)
      normal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize()
      if (normal.y < 0.1) continue
      const point = hit.point.clone()
      level.worldToLocal(point)
      return point.y
    }
    return null
  }
  let byLevel = samplerCache.get(host)
  if (!byLevel) {
    byLevel = new WeakMap()
    samplerCache.set(host, byLevel)
  }
  byLevel.set(level, {
    revision,
    hostMatrix: [...host.matrixWorld.elements],
    levelMatrix: [...level.matrixWorld.elements],
    sample,
  })
  return sample
}
