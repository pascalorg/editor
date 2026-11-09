import type { WebGLRenderer } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

/**
 * Pascal's baked GLBs require EXT_meshopt_compression and carry KTX2 textures
 * (KHR_texture_basisu). No transcoder path is set on purpose: three's KTX2Loader
 * then resolves its own Basis transcoder through `new URL(..., import.meta.url)`,
 * so Vite bundles it as a hashed asset served from this site, matching the
 * installed three, with no CDN to allow in the Content-Security-Policy.
 */
export function createGltfLoader(renderer: WebGLRenderer) {
  const ktx2 = new KTX2Loader().detectSupport(renderer)
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2)
  return { loader, dispose: () => ktx2.dispose() }
}
