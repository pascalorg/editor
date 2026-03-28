import { useGLTF } from '@react-three/drei/core/Gltf'
import type { ObjectMap } from '@react-three/fiber'
import { useMemo } from 'react'
import type { Material, Mesh } from 'three'
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu'

const defaultMaterial = new MeshStandardNodeMaterial({
  color: 0xff_ff_ff,
  roughness: 1,
  metalness: 0,
})

const glassMaterial = new MeshStandardNodeMaterial({
  name: 'glass',
  color: 'lightgray',
  roughness: 0.8,
  metalness: 0,
  transparent: true,
  opacity: 0.35,
  side: DoubleSide,
  depthWrite: false,
})

function getMaterialForOriginal(original: Material): MeshStandardNodeMaterial {
  if (original.name.toLowerCase() === 'glass') {
    return glassMaterial
  }
  return defaultMaterial
}

interface GLTFWithObjectMap extends ObjectMap {
  scene: import('three').Group
  nodes: Record<string, import('three').Object3D>
  animations: import('three').AnimationClip[]
}

const gltfCache = new Map<string, GLTFWithObjectMap>()

function processSceneMaterials(scene: import('three').Group) {
  scene.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh
      if (mesh.name === 'cutout') {
        child.visible = false
        return
      }

      let hasGlass = false

      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((mat) => getMaterialForOriginal(mat))
        hasGlass = mesh.material.some((mat) => mat.name === 'glass')
      } else {
        mesh.material = getMaterialForOriginal(mesh.material)
        hasGlass = mesh.material.name === 'glass'
      }
      mesh.castShadow = !hasGlass
      mesh.receiveShadow = !hasGlass
    }
  })
}

export function useCachedGLTF(url: string): GLTFWithObjectMap {
  const gltf = useGLTF(url) as GLTFWithObjectMap

  return useMemo(() => {
    if (!gltfCache.has(url)) {
      processSceneMaterials(gltf.scene)
      gltfCache.set(url, gltf)
    }
    return gltfCache.get(url)!
  }, [url, gltf])
}

export function clearGLTFCache() {
  gltfCache.clear()
}
