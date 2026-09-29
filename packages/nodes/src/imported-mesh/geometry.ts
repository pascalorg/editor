import { type AnyNodeId, type ImportedMeshNode, useScene } from '@pascal-app/core'
import { registerMaterialCacheCleanup } from '@pascal-app/viewer'
import {
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three'

// Primitives of one colour share a material, so the node batch can pack them
// (its batch key includes the material).
const importedMaterials = new Map<string, MeshStandardMaterial>()
registerMaterialCacheCleanup(() => {
  const previous = [...importedMaterials.values()]
  importedMaterials.clear()
  const state = useScene.getState()
  for (const node of Object.values(state.nodes)) {
    if (node.type === 'imported-mesh') state.markDirty(node.id as AnyNodeId)
  }
  return () => {
    for (const material of previous) material.dispose()
  }
})

function importedMaterial(color: string, opacity: number): MeshStandardMaterial {
  const key = `${color}|${opacity}`
  let material = importedMaterials.get(key)
  if (!material) {
    material = new MeshStandardMaterial({
      color,
      opacity,
      transparent: opacity < 1,
      depthWrite: opacity >= 1,
      metalness: 0.05,
      roughness: 0.8,
      side: FrontSide,
    })
    material.userData.__pascalCachedMaterial = true
    importedMaterials.set(key, material)
  }
  return material
}

/** Build serialized imported triangle buffers without source-format coupling. */
export function buildImportedMeshGeometry(node: ImportedMeshNode): Group {
  const group = new Group()
  for (const [primitiveIndex, primitive] of node.primitives.entries()) {
    if (primitive.positions.length < 9) continue
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(primitive.positions, 3))
    // The index must be set first: computeVertexNormals reads triangles from it when present.
    if (primitive.indices.length >= 3) geometry.setIndex(primitive.indices)
    if (primitive.normals?.length === primitive.positions.length) {
      geometry.setAttribute('normal', new Float32BufferAttribute(primitive.normals, 3))
    } else {
      geometry.computeVertexNormals()
    }
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    const mesh = new Mesh(geometry, importedMaterial(primitive.color, primitive.opacity))
    mesh.name = `${node.name ?? 'Imported mesh'} primitive ${primitiveIndex + 1}`
    group.add(mesh)
  }
  return group
}
