import type { Material, Mesh, Object3D } from 'three'

export function importedUnlitMaterial(material: Material | null): boolean {
  return material?.userData.pascalImportedUnlit === true
}

/** Native basic materials still use AO; imported unlit assets already own their lighting. */
export function preserveGltfUnlit() {
  return {
    name: 'PASCAL_imported_unlit',
    afterRoot({ scenes }: { scenes: Object3D[] }) {
      for (const scene of scenes) {
        scene.traverse((object) => {
          const mesh = object as Mesh
          if (!mesh.isMesh) return
          for (const material of [mesh.material].flat()) {
            if ('isMeshBasicMaterial' in material) material.userData.pascalImportedUnlit = true
          }
        })
      }
      return null
    },
  }
}
