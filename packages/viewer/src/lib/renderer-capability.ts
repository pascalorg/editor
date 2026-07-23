export type RendererCapabilityCanvas = {
  getContext(contextId: 'webgl2'): unknown
}

type RendererGpuAdapter = {
  features?: Iterable<string>
  requestDevice(descriptor?: { requiredFeatures?: string[] }): Promise<unknown>
}

type RendererGpu = {
  requestAdapter(options?: Record<string, unknown>): Promise<RendererGpuAdapter | null>
}

export type RendererCapability =
  | { backend: 'webgpu'; device: unknown; status: 'supported' }
  | { backend: 'webgl'; status: 'supported' }
  | { error?: unknown; status: 'unsupported' }

export type RendererBackendParameters = {
  device?: unknown
  forceWebGL?: boolean
}

type InitializableRenderer = {
  dispose?: () => void
  init: () => Promise<unknown>
}

export type RendererInitializationResult<Renderer> =
  | { backend: 'webgpu' | 'webgl'; renderer: Renderer; status: 'ready' }
  | { error?: unknown; status: 'unsupported' }

const WEBGPU_INITIALIZATION_TIMEOUT_MS = 4000

function browserGpu(): RendererGpu | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { gpu?: RendererGpu }).gpu ?? null
}

function browserCanvas(): RendererCapabilityCanvas | null {
  if (typeof document === 'undefined') return null
  return document.createElement('canvas')
}

function withTimeout<Result>(promise: Promise<Result>, timeoutMs: number, operation: string) {
  let timeout: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout))
}

async function requestWebGpuDevice(gpu: RendererGpu) {
  const adapter = await gpu.requestAdapter({ featureLevel: 'compatibility' })
  if (!adapter) return null

  const requiredFeatures = adapter.features ? Array.from(adapter.features) : undefined
  return adapter.requestDevice(requiredFeatures?.length ? { requiredFeatures } : undefined)
}

export async function detectRendererCapability({
  canvas = browserCanvas(),
  gpu = browserGpu(),
  webgpuTimeoutMs = WEBGPU_INITIALIZATION_TIMEOUT_MS,
}: {
  canvas?: RendererCapabilityCanvas | null
  gpu?: RendererGpu | null
  webgpuTimeoutMs?: number
} = {}): Promise<RendererCapability> {
  let capabilityError: unknown

  if (gpu) {
    try {
      const device = await withTimeout(
        requestWebGpuDevice(gpu),
        webgpuTimeoutMs,
        'WebGPU adapter/device request',
      )
      if (device) return { backend: 'webgpu', device, status: 'supported' }
    } catch (error) {
      capabilityError = error
    }
  }

  if (canvas) {
    try {
      const context = canvas.getContext('webgl2')
      if (context) return { backend: 'webgl', status: 'supported' }
    } catch (error) {
      capabilityError ??= error
    }
  }

  return { error: capabilityError, status: 'unsupported' }
}

export async function initializeGpuRenderer<Renderer extends InitializableRenderer>({
  createRenderer,
  gpu,
  probeCanvas = browserCanvas(),
  webgpuTimeoutMs = WEBGPU_INITIALIZATION_TIMEOUT_MS,
}: {
  createRenderer: (parameters: RendererBackendParameters) => Renderer
  gpu?: RendererGpu | null
  probeCanvas?: RendererCapabilityCanvas | null
  webgpuTimeoutMs?: number
}): Promise<RendererInitializationResult<Renderer>> {
  const capability = await detectRendererCapability({
    canvas: probeCanvas,
    gpu,
    webgpuTimeoutMs,
  })
  if (capability.status === 'unsupported') return capability

  let renderer: Renderer | undefined
  try {
    renderer = createRenderer(
      capability.backend === 'webgpu' ? { device: capability.device } : { forceWebGL: true },
    )
    const initPromise = renderer.init()
    await (capability.backend === 'webgpu'
      ? withTimeout(initPromise, webgpuTimeoutMs, 'WebGPU renderer initialization')
      : initPromise)
    return { backend: capability.backend, renderer, status: 'ready' }
  } catch (error) {
    try {
      renderer?.dispose?.()
    } catch {}
    if (capability.backend !== 'webgpu') return { error, status: 'unsupported' }

    renderer = undefined
    try {
      renderer = createRenderer({ forceWebGL: true })
      await renderer.init()
      return { backend: 'webgl', renderer, status: 'ready' }
    } catch (fallbackError) {
      try {
        renderer?.dispose?.()
      } catch {}
      return { error: fallbackError, status: 'unsupported' }
    }
  }
}
