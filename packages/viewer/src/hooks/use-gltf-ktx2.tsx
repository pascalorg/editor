import { useGLTF } from "@react-three/drei"
import { useThree } from "@react-three/fiber"
import { KTX2Loader } from "three/examples/jsm/Addons.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"

const ktx2LoaderInstance = new KTX2Loader()
ktx2LoaderInstance.setTranscoderPath('https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/')

const useGLTFKTX2 = (path: string) => {
  const gl = useThree((state) => state.gl)

  return useGLTF(path, true, true, (loader) => {
    ktx2LoaderInstance.detectSupport(gl)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader.setKTX2Loader(ktx2LoaderInstance as any)
    loader.setMeshoptDecoder(MeshoptDecoder)
  })
}
export { useGLTFKTX2 }