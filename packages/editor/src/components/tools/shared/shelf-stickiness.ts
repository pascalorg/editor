import {
  type AnyNodeId,
  createSceneApi,
  getSurfaceProvider,
  sceneRegistry,
  surfaceRegionContainsPoint,
  useScene,
} from '@pascal-app/core'
import { Box3, type Camera, Matrix4, Ray, Vector3 } from 'three'

export function createShelfStickiness() {
  const ray = new Ray()
  const box = new Box3()
  const matrix = new Matrix4()
  const cameraPosition = new Vector3()

  // A ray through a board gap can hit the floor behind the shelf while still targeting its volume.
  return (
    shelfId: string | null | undefined,
    camera: Camera,
    worldPoint: readonly [number, number, number],
  ) => {
    if (!shelfId) return false
    const mesh = sceneRegistry.nodes.get(shelfId)
    const shelf = useScene.getState().nodes[shelfId as AnyNodeId]
    if (!mesh || !shelf || (shelf.type !== 'shelf' && shelf.type !== 'cabinet')) return false
    camera.getWorldPosition(cameraPosition)
    ray.origin.copy(cameraPosition)
    ray.direction
      .set(...worldPoint)
      .sub(cameraPosition)
      .normalize()
    ray.applyMatrix4(matrix.copy(mesh.matrixWorld).invert())
    if (shelf.type === 'cabinet') {
      const surfaces =
        getSurfaceProvider(shelf).surfaces?.(shelf, { scene: createSceneApi(useScene) }) ?? []
      return surfaces.some((surface) => {
        if (Math.abs(ray.direction.y) < 1e-8) return false
        const distance = (surface.position[1] - ray.origin.y) / ray.direction.y
        if (distance < 0) return false
        const point = ray.at(distance, new Vector3())
        return surfaceRegionContainsPoint(surface.region, [
          point.x - surface.position[0],
          point.z - surface.position[2],
        ])
      })
    }
    if (!shelf.width || !shelf.depth || !shelf.height) return false
    const margin = 0.08
    box.min.set(-shelf.width / 2 - margin, -margin, -shelf.depth / 2 - margin)
    box.max.set(shelf.width / 2 + margin, shelf.height + margin, shelf.depth / 2 + margin)
    return ray.intersectsBox(box)
  }
}
