import {
  type CompressedTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import { KTX2Loader } from 'three/examples/jsm/Addons.js'

/** The private KTX2Loader surface this module relies on (stable across three
 *  releases but not part of the public types). */
type KTX2LoaderInternals = {
  transcoderPath: string
  workerConfig: Record<string, boolean> | null
  _createTexture(buffer: ArrayBuffer, config?: Record<string, unknown>): Promise<unknown>
}

/** Base width/height of a Basis-supercompressed KTX2 payload needing transcode
 *  (vkFormat 0 = ETC1S/UASTC) whose dimensions aren't block-aligned, or null
 *  for anything safe. Little-endian u32s: vkFormat at byte 12, pixelWidth at
 *  20, pixelHeight at 24. */
function readMisalignedBasisSize(buffer: ArrayBuffer): { width: number; height: number } | null {
  if (buffer.byteLength < 28) return null
  const view = new DataView(buffer)
  const vkFormat = view.getUint32(12, true)
  if (vkFormat !== 0) return null
  const width = view.getUint32(20, true)
  const height = view.getUint32(24, true)
  return width % 4 !== 0 || height % 4 !== 0 ? { width, height } : null
}

/**
 * KTX2Loader that survives block-misaligned textures. WebGPU rejects
 * block-compressed textures whose base dimensions aren't multiples of 4;
 * three's KTX2Loader only warns and transcodes anyway, and the resulting
 * invalid texture poisons every render pass that binds it (endless
 * "Invalid BindGroup … Invalid CommandBuffer" spam — baked GLBs carrying an
 * odd-sized user-item texture triggered exactly this). Such payloads are
 * routed to a fallback loader whose support flags report no compressed
 * formats, which makes the transcoder emit plain RGBA32 — uncompressed
 * textures have no alignment requirement.
 */
class AlignmentSafeKTX2Loader extends KTX2Loader {
  private rgbaFallback: KTX2Loader | null = null

  private fallbackLoader(): KTX2LoaderInternals {
    if (!this.rgbaFallback) {
      this.rgbaFallback = new KTX2Loader(this.manager)
      this.rgbaFallback.setTranscoderPath((this as unknown as KTX2LoaderInternals).transcoderPath)
      // All formats unsupported → getTranscoderFormat falls through to RGBA32.
      ;(this.rgbaFallback as unknown as KTX2LoaderInternals).workerConfig = {
        astcSupported: false,
        astcHDRSupported: false,
        etc1Supported: false,
        etc2Supported: false,
        dxtSupported: false,
        bptcSupported: false,
        pvrtcSupported: false,
      }
    }
    return this.rgbaFallback as unknown as KTX2LoaderInternals
  }

  /** Both `load()` and GLTFLoader's KHR_texture_basisu path funnel through
   *  this internal — overriding it covers every entry point. */
  async _createTexture(buffer: ArrayBuffer, config?: Record<string, unknown>): Promise<unknown> {
    const misaligned = readMisalignedBasisSize(buffer)
    if (misaligned) {
      console.warn(
        `[viewer] KTX2 texture is ${misaligned.width}x${misaligned.height} (not multiple-of-4); ` +
          'transcoding uncompressed so WebGPU can create it.',
      )
      const transcoded = (await this.fallbackLoader()._createTexture(
        buffer,
        config,
      )) as CompressedTexture
      // The RGBA32 result still arrives as a CompressedTexture; three's WebGPU
      // texture upload treats every CompressedTexture as block-compressed and
      // crashes looking up a block descriptor for rgba8. Repackage the decoded
      // pixels as a plain DataTexture instead.
      const mip = (
        transcoded.mipmaps as Array<{ data: Uint8Array; width: number; height: number }>
      )?.[0]
      if (!mip) return transcoded
      const texture = new DataTexture(mip.data, mip.width, mip.height, RGBAFormat, UnsignedByteType)
      texture.colorSpace = transcoded.colorSpace
      texture.generateMipmaps = true
      texture.minFilter = LinearMipmapLinearFilter
      texture.magFilter = LinearFilter
      texture.needsUpdate = true
      transcoded.dispose()
      return texture
    }
    return (KTX2Loader.prototype as unknown as KTX2LoaderInternals)._createTexture.call(
      this,
      buffer,
      config,
    )
  }

  dispose(): this {
    this.rgbaFallback?.dispose()
    this.rgbaFallback = null
    super.dispose()
    return this
  }
}

/**
 * Single shared KTX2 loader for the whole viewer — used both by the GLB loader
 * (`use-gltf-ktx2`) and by catalog finish textures (`materials.ts`). KTX2 must
 * be transcoded at load via the Basis WASM, and `detectSupport(renderer)` has to
 * run once before any `.ktx2` is loaded so the loader picks a GPU format the
 * device supports. `ensureKtx2Support` is idempotent per renderer and is called
 * from the viewer root the moment the renderer is ready (even when no GLB is in
 * the scene, so catalog `.ktx2` finishes still load).
 */
export const ktx2Loader = new AlignmentSafeKTX2Loader()
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
