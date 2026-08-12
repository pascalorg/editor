import type { Material, Mesh, Object3D } from 'three'
import { SCENE_LAYER } from './layers'

export const GHOSTED_OPACITY = 0.4

export function isGhostedSceneMesh(object: Object3D): object is Mesh {
  return 'isMesh' in object && object.isMesh === true && object.layers.isEnabled(SCENE_LAYER)
}

export function createGhostedMaterial(material: Material): Material {
  const ghosted = material.clone()
  ghosted.name = material.name ? `${material.name}:ghosted` : 'ghosted'
  ghosted.transparent = true
  ghosted.opacity = Math.min(material.opacity, GHOSTED_OPACITY)
  ghosted.depthWrite = false
  ghosted.userData = { ...material.userData, __pascalGhostedMaterial: true }
  ghosted.needsUpdate = true
  return ghosted
}
