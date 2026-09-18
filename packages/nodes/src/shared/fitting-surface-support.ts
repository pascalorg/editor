import type { DuctFittingNode, PipeFittingNode } from '@pascal-app/core'
import { Mesh, Vector3 } from 'three'
import { buildDuctFittingGeometry } from '../duct-fitting/geometry'
import { buildPipeFittingGeometry } from '../pipe-fitting/geometry'

type Point = [number, number, number]

export function createFittingSurfaceSupport() {
  let key = ''
  let vertices: Vector3[] = []
  return (
    node: DuctFittingNode | PipeFittingNode,
    rotation: Point,
    position: Point,
    surfacePoint: Point,
    surfaceNormal: Point = [0, 1, 0],
  ): Point => {
    const nextKey = JSON.stringify([node, rotation])
    if (key !== nextKey) {
      const group =
        node.type === 'duct-fitting'
          ? buildDuctFittingGeometry({ ...node, rotation })
          : buildPipeFittingGeometry({ ...node, rotation })
      group.rotation.set(...rotation)
      group.updateMatrixWorld(true)
      vertices = []
      group.traverse((object) => {
        if (!(object instanceof Mesh)) return
        const points = object.geometry.getAttribute('position')
        for (let i = 0; i < points.count; i++) {
          vertices.push(
            new Vector3().fromBufferAttribute(points, i).applyMatrix4(object.matrixWorld),
          )
        }
        object.geometry.dispose()
      })
      key = nextKey
    }
    const normal = new Vector3(...surfaceNormal).normalize()
    if (normal.lengthSq() === 0) normal.set(0, 1, 0)
    let minimum = Infinity
    for (const vertex of vertices) minimum = Math.min(minimum, vertex.dot(normal))
    if (!Number.isFinite(minimum)) return position
    const result = new Vector3(...position)
    const distance = result
      .clone()
      .sub(new Vector3(...surfacePoint))
      .dot(normal)
    return result.addScaledVector(normal, -distance - minimum + 0.001).toArray()
  }
}
