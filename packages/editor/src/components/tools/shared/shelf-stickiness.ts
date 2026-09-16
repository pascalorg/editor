import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
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
    if (!mesh || shelf?.type !== 'shelf' || !shelf.width || !shelf.depth || !shelf.height)
      return false
    camera.getWorldPosition(cameraPosition)
    ray.origin.copy(cameraPosition)
    ray.direction
      .set(...worldPoint)
      .sub(cameraPosition)
      .normalize()
    ray.applyMatrix4(matrix.copy(mesh.matrixWorld).invert())
    const margin = 0.08
    box.min.set(-shelf.width / 2 - margin, -margin, -shelf.depth / 2 - margin)
    box.max.set(shelf.width / 2 + margin, shelf.height + margin, shelf.depth / 2 + margin)
    return ray.intersectsBox(box)
  }
}
