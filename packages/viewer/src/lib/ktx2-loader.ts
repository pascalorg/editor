import { KTX2Loader } from 'three/examples/jsm/Addons.js'

/**
 * Single shared KTX2 loader for the whole viewer — used both by the GLB loader
 * (`use-gltf-ktx2`) and by catalog finish textures (`materials.ts`). KTX2 must
 * be transcoded at load via the Basis WASM, and `detectSupport(renderer)` has to
 * run once before any `.ktx2` is loaded so the loader picks a GPU format the
 * device supports. `ensureKtx2Support` is idempotent per renderer and is called
 * from the viewer root the moment the renderer is ready (even when no GLB is in
 * the scene, so catalog `.ktx2` finishes still load).
 */
export const ktx2Loader = new KTX2Loader()
ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/')

const configuredRenderers = new WeakSet<object>()
const warnedRenderers = new WeakSet<object>()

/** Returns true once support has been detected for this renderer (KTX2 safe to load). */
export function ensureKtx2Support(renderer: unknown): boolean {
  const key = renderer as object | null
  if (!key) return false
  if (configuredRenderers.has(key)) return true
  try {
    ;(ktx2Loader as unknown as { detectSupport: (r: unknown) => void }).detectSupport(renderer)
    configuredRenderers.add(key)
    return true
  } catch (error) {
    // Some WebGPU flows can transiently call this before backend init; don't
    // crash the scene — a later call (or the next render) retries.
    if (!warnedRenderers.has(key)) {
      console.warn('[viewer] Skipping KTX2 support detection for now.', error)
      warnedRenderers.add(key)
    }
    return false
  }
}

export function isKtx2Url(url: string): boolean {
  return url.toLowerCase().endsWith('.ktx2')
}
