import type { ImportedMeshNode } from '@pascal-app/core'
import {
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three'

/** Build serialized imported triangle buffers without source-format coupling. */
export function buildImportedMeshGeometry(node: ImportedMeshNode): Group {
  const group = new Group()
  for (const [primitiveIndex, primitive] of node.primitives.entries()) {
    if (primitive.positions.length < 9) continue
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(primitive.positions, 3))
    if (primitive.normals?.length === primitive.positions.length) {
      geometry.setAttribute('normal', new Float32BufferAttribute(primitive.normals, 3))
    } else {
      geometry.computeVertexNormals()
    }
    if (primitive.indices.length >= 3) geometry.setIndex(primitive.indices)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    const material = new MeshStandardMaterial({
      color: primitive.color,
      opacity: primitive.opacity,
      transparent: primitive.opacity < 1,
      depthWrite: primitive.opacity >= 1,
      metalness: 0.05,
      roughness: 0.8,
      side: FrontSide,
    })
    const mesh = new Mesh(geometry, material)
    mesh.name = `${node.name ?? 'Imported mesh'} primitive ${primitiveIndex + 1}`
    group.add(mesh)
  }
  return group
}
