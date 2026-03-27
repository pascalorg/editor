import { useGLTF } from '@react-three/drei/core/Gltf'
import type { ObjectMap } from '@react-three/fiber'
import { useMemo } from 'react'

interface GLTFWithObjectMap extends ObjectMap {
  scene: import('three').Group
  nodes: Record<string, import('three').Object3D>
  animations: import('three').AnimationClip[]
}

const gltfCache = new Map<string, GLTFWithObjectMap>()

export function useCachedGLTF(url: string): GLTFWithObjectMap {
  const gltf = useGLTF(url) as GLTFWithObjectMap

  return useMemo(() => {
    if (!gltfCache.has(url)) {
      gltfCache.set(url, gltf)
    }
    return gltfCache.get(url)!
  }, [url, gltf])
}

export function clearGLTFCache() {
  gltfCache.clear()
}
