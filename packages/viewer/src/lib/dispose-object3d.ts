import type { BufferGeometry, Material, Object3D } from 'three'

function isCachedMaterial(material: Material): boolean {
  return Boolean(material.userData?.__pascalCachedMaterial)
}

/** Dispose geometry and non-cached materials owned by an Object3D subtree. */
export function disposeObject3DResources(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()

  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: BufferGeometry
      material?: Material | Material[]
    }
    if (renderable.geometry) geometries.add(renderable.geometry)
    const objectMaterials = renderable.material
    if (Array.isArray(objectMaterials)) {
      for (const material of objectMaterials) materials.add(material)
    } else if (objectMaterials) {
      materials.add(objectMaterials)
    }
  })

  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) {
    if (!isCachedMaterial(material)) material.dispose()
  }
}
