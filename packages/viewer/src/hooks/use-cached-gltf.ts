import { useGLTF } from '@react-three/drei/core/Gltf'
import { useMemo } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gltfCache = new Map<string, any>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useCachedGLTF(url: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gltf: any = useGLTF(url)

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
