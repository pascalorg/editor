import type { RenderQuality } from '../store/use-viewer'

/** What the browser tells us about the device: capabilities, never measured frame rate. */
export type DeviceSignals = {
  backend: 'webgpu' | 'webgl'
  /** GPU identity: WebGPU adapter info plus the WebGL renderer string, lower-cased. */
  gpu: string
  /** WebGPU fell back to a software adapter. */
  fallbackAdapter: boolean
  /** `navigator.deviceMemory` in GB (Chromium only, capped at 8). */
  memoryGb?: number
  cores?: number
  /** A phone or tablet: coarse primary pointer, or an iPad passing as a Mac. */
  touch: boolean
  /** The screen's short side in CSS px. */
  screenShortSide: number
  mac: boolean
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/
const DISCRETE =
  /nvidia|geforce|quadro|radeon\s*(rx|pro|r9|vii)|intel.*arc\s*a\d|intel.*arc\(tm\)\s*a\d/
const OLD_INTEL = /intel.*(hd graphics|uhd graphics)|gen-(7|8|9)\b/
const APPLE_BIG = /apple m\d+\s*(pro|max|ultra)/
const APPLE_BASE = /apple m\d+/

/**
 * The quality tier a device starts on, from what it is rather than how fast it ran a frame:
 * - Low: no WebGPU, software rendering, 4 GB or less, phones, older Intel integrated graphics.
 * - High: discrete GPUs, Apple Pro/Max/Ultra (Safari hides the model: Macs with 10+ cores).
 * - Medium: tablets, other integrated GPUs, base Apple M chips, and anything unrecognized.
 */
export function classifyDevice(signals: DeviceSignals): RenderQuality {
  const gpu = signals.gpu
  if (signals.backend === 'webgl' || signals.fallbackAdapter || SOFTWARE.test(gpu)) return 'low'
  if (signals.memoryGb !== undefined && signals.memoryGb <= 4) return 'low'
  if (signals.touch) return signals.screenShortSide < 600 ? 'low' : 'medium'
  if (DISCRETE.test(gpu)) return 'high'
  if (OLD_INTEL.test(gpu) && !/iris|arc/.test(gpu)) return 'low'
  if (APPLE_BIG.test(gpu)) return 'high'
  if (APPLE_BASE.test(gpu)) return 'medium'
  if (signals.mac && /apple/.test(gpu) && (signals.cores ?? 0) >= 10) return 'high'
  return 'medium'
}

/** Rendering on the CPU (a software adapter or rasterizer): every frame competes with the app. */
export function isSoftwareRenderer(signals: DeviceSignals): boolean {
  return signals.fallbackAdapter || SOFTWARE.test(signals.gpu)
}

type AdapterInfo = { vendor?: string; architecture?: string; description?: string; device?: string }

/** The device's signals, read once the renderer is up (its backend and WebGPU device). */
export function readDeviceSignals(backend: 'webgpu' | 'webgl', device?: unknown): DeviceSignals {
  const info = (device as { adapterInfo?: AdapterInfo & { isFallbackAdapter?: boolean } } | null)
    ?.adapterInfo
  const nav = navigator as Navigator & { deviceMemory?: number }
  const mac = /mac/i.test(nav.platform || nav.userAgent)
  const touch =
    window.matchMedia?.('(pointer: coarse)').matches === true || (mac && nav.maxTouchPoints > 1)
  return {
    backend,
    gpu: [info?.vendor, info?.architecture, info?.device, info?.description, webglRenderer()]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    fallbackAdapter: info?.isFallbackAdapter === true,
    memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    cores: nav.hardwareConcurrency || undefined,
    touch,
    screenShortSide: Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0),
    mac,
  }
}

/** The WebGL renderer string (the GPU model on Chromium; masked on Safari and Firefox). */
function webglRenderer(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return ''
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return name
  } catch {
    return ''
  }
}
