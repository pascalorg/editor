import { useGLTF } from '@react-three/drei'
import { type ObjectMap, useThree } from '@react-three/fiber'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ensureKtx2Support, ktx2Loader } from '../lib/ktx2-loader'

type GLTFKTX2Path = string | string[]
type GLTFKTX2Result<T extends GLTFKTX2Path> = T extends string[]
  ? Array<GLTF & ObjectMap>
  : GLTF & ObjectMap

const useGLTFKTX2 = <T extends GLTFKTX2Path>(path: T): GLTFKTX2Result<T> => {
  const gl = useThree((state) => state.gl)

  return useGLTF(path, true, true, (loader) => {
    if (ensureKtx2Support(gl)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loader.setKTX2Loader(ktx2Loader as any)
    }
    loader.setMeshoptDecoder(MeshoptDecoder)
  }) as unknown as GLTFKTX2Result<T>
}

export { useGLTFKTX2 }
