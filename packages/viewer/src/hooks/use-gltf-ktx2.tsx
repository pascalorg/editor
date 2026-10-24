import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { preserveGltfUnlit } from '../lib/gltf-unlit'
import { configureKtx2Support } from '../lib/ktx2-loader'

const useGLTFKTX2 = (path: string): ReturnType<typeof useGLTF> => {
  const gl = useThree((state) => state.gl)

  return useGLTF(path, true, true, (loader) => {
    loader.register(preserveGltfUnlit)
    configureKtx2Support(loader, gl)
    loader.setMeshoptDecoder(MeshoptDecoder)
  })
}

export { useGLTFKTX2 }
