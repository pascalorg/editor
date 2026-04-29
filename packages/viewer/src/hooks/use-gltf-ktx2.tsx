import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { KTX2Loader } from 'three/examples/jsm/Addons.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

const ktx2LoaderInstance = new KTX2Loader()
ktx2LoaderInstance.setTranscoderPath('https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/')
const ktx2ConfiguredRenderers = new WeakSet<object>()
const ktx2WarningLoggedRenderers = new WeakSet<object>()

const useGLTFKTX2 = (path: string): ReturnType<typeof useGLTF> => {
  const gl = useThree((state) => state.gl)

  return useGLTF(path, true, true, (loader) => {
    const renderer = gl as unknown as object

    if (!ktx2ConfiguredRenderers.has(renderer)) {
      try {
        ktx2LoaderInstance.detectSupport(gl)
        ktx2ConfiguredRenderers.add(renderer)
      } catch (error) {
        // Some WebGPU flows can transiently call this before backend init.
        // Avoid crashing the whole scene; scans may render without KTX2 on this pass.
        if (!ktx2WarningLoggedRenderers.has(renderer)) {
          console.warn('[viewer] Skipping KTX2 support detection for now.', error)
          ktx2WarningLoggedRenderers.add(renderer)
        }
      }
    }

    if (ktx2ConfiguredRenderers.has(renderer)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loader.setKTX2Loader(ktx2LoaderInstance as any)
    }

    loader.setMeshoptDecoder(MeshoptDecoder)
  })
}
export { useGLTFKTX2 }
