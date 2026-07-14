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
    const renderer: object = gl

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
      // drei's GLTFLoader.setKTX2Loader expects `three-stdlib`'s `KTX2Loader`,
      // but the transcoder instance is built from `@types/three`'s addon of the
      // same name. These are two separate packages, so their `KTX2Loader`
      // classes are nominally distinct and don't structurally overlap enough
      // for a direct cast, even though they are the same loader at runtime.
      // `three-stdlib` is not a direct dependency, so an `unknown` bridge to
      // the loader's own parameter type is unavoidable here.
      loader.setKTX2Loader(
        ktx2LoaderInstance as unknown as Parameters<typeof loader.setKTX2Loader>[0],
      )
    }

    loader.setMeshoptDecoder(MeshoptDecoder)
  })
}

export { useGLTFKTX2 }
