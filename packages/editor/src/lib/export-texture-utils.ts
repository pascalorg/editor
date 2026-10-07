import { initializeGpuRenderer } from '@pascal-app/viewer'
import type * as THREE from 'three'
import { texture as textureNode, uv } from 'three/tsl'
import { CanvasTexture, NodeMaterial, QuadMesh, WebGPURenderer } from 'three/webgpu'

/**
 * GPU decompressor handed to three's GLTF/USDZ exporters for compressed (KTX2)
 * textures. One instance lives for the duration of an export and is disposed
 * with it.
 */
export type ExportTextureUtils = {
  decompress(texture: THREE.Texture, maxTextureSize?: number): Promise<THREE.Texture>
  dispose(): Promise<void>
}

// The WebGL probe context initializeGpuRenderer opens on this canvas is never
// released, so one canvas serves every export instead of one per export.
let probeCanvas: HTMLCanvasElement | null | undefined

async function initializeDecompressRenderer(): Promise<WebGPURenderer> {
  probeCanvas ??= typeof document === 'undefined' ? null : document.createElement('canvas')
  const result = await initializeGpuRenderer({
    probeCanvas,
    createRenderer: (parameters) =>
      new WebGPURenderer(parameters as ConstructorParameters<typeof WebGPURenderer>[0]),
  })
  if (result.status !== 'ready') {
    throw new Error('Could not start a GPU renderer to decompress textures for export.', {
      cause: result.error,
    })
  }
  return result.renderer
}

function releaseDevice(renderer: WebGPURenderer) {
  // initializeGpuRenderer hands three a caller-owned device, which
  // WebGPUBackend.dispose() deliberately leaves alive.
  const backend = renderer.backend as { device?: { destroy?: () => void } | null }
  try {
    backend.device?.destroy?.()
  } catch {}
}

/**
 * Mirrors three's `WebGPUTextureUtils.decompress` but keeps a single renderer
 * for the whole export. The stock helper creates, initialises and disposes a
 * WebGPURenderer — adapter and device request included, with no timeout — for
 * every compressed texture it is handed, so a furnished scene paid that cost
 * dozens of times and hung outright when one device request stalled. Handing
 * it a renderer is not an option: it resizes whatever renderer it receives
 * (the live viewer's canvas) and, in r186, throws on the first call that
 * supplies one.
 */
export function createExportTextureUtils(
  initialize: () => Promise<WebGPURenderer> = initializeDecompressRenderer,
): ExportTextureUtils {
  let pending: Promise<WebGPURenderer> | null = null
  let disposed = false
  const quad = new QuadMesh()

  return {
    async decompress(texture, maxTextureSize = Number.POSITIVE_INFINITY) {
      if (disposed) {
        throw new Error('The export was abandoned before this texture was decompressed.')
      }
      pending ??= initialize()
      const renderer = await pending

      // Everything below the await is synchronous, which is what lets
      // overlapping calls share `quad` and the renderer's colour space.
      const image = texture.image as { width: number; height: number }
      const width = Math.min(image.width, maxTextureSize)
      const height = Math.min(image.height, maxTextureSize)

      const material = new NodeMaterial()
      material.fragmentNode = textureNode(texture, uv().flipY())
      const previousColorSpace = renderer.outputColorSpace
      renderer.setSize(width, height)
      renderer.outputColorSpace = texture.colorSpace
      quad.material = material
      try {
        quad.render(renderer)
      } finally {
        renderer.outputColorSpace = previousColorSpace
        material.dispose()
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Could not create a 2D canvas to read back a decompressed texture.')
      }
      context.drawImage(renderer.domElement, 0, 0, width, height)

      const readable = new CanvasTexture(canvas)
      readable.minFilter = texture.minFilter
      readable.magFilter = texture.magFilter
      readable.wrapS = texture.wrapS
      readable.wrapT = texture.wrapT
      readable.colorSpace = texture.colorSpace
      readable.name = texture.name
      return readable
    },

    async dispose() {
      disposed = true
      const started = pending
      pending = null
      if (!started) return
      const renderer = await started.catch(() => null)
      if (!renderer) return
      try {
        await renderer.dispose()
      } finally {
        releaseDevice(renderer)
      }
    },
  }
}
