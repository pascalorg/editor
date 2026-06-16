import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { ensureKtx2Support, ktx2Loader } from '../lib/ktx2-loader'

const useGLTFKTX2 = (path: string): ReturnType<typeof useGLTF> => {
  const gl = useThree((state) => state.gl)

  return useGLTF(path, true, true, (loader) => {
    if (ensureKtx2Support(gl)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loader.setKTX2Loader(ktx2Loader as any)
    }
    loader.setMeshoptDecoder(MeshoptDecoder)
  })
}

export { useGLTFKTX2 }
