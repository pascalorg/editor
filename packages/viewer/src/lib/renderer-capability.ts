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
  | { backend: 'webgl'; context: unknown; status: 'supported' }
  | { error?: unknown; status: 'unsupported' }

export type RendererBackendParameters = {
  context?: unknown
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

function browserGpu(): RendererGpu | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { gpu?: RendererGpu }).gpu ?? null
}

function browserCanvas(): RendererCapabilityCanvas | null {
  if (typeof document === 'undefined') return null
  return document.createElement('canvas')
}

export async function detectRendererCapability({
  canvas = browserCanvas(),
  gpu = browserGpu(),
}: {
  canvas?: RendererCapabilityCanvas | null
  gpu?: RendererGpu | null
} = {}): Promise<RendererCapability> {
  let capabilityError: unknown

  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter({ featureLevel: 'compatibility' })
      if (adapter) {
        const requiredFeatures = adapter.features ? Array.from(adapter.features) : undefined
        const device = await adapter.requestDevice(
          requiredFeatures?.length ? { requiredFeatures } : undefined,
        )
        if (device) return { backend: 'webgpu', device, status: 'supported' }
      }
    } catch (error) {
      capabilityError = error
    }
  }

  if (canvas) {
    try {
      const context = canvas.getContext('webgl2')
      if (context) return { backend: 'webgl', context, status: 'supported' }
    } catch (error) {
      capabilityError ??= error
    }
  }

  return { error: capabilityError, status: 'unsupported' }
}

export async function initializeGpuRenderer<Renderer extends InitializableRenderer>({
  canvas,
  createRenderer,
  gpu,
}: {
  canvas?: RendererCapabilityCanvas | null
  createRenderer: (parameters: RendererBackendParameters) => Renderer
  gpu?: RendererGpu | null
}): Promise<RendererInitializationResult<Renderer>> {
  const capability = await detectRendererCapability({ canvas, gpu })
  if (capability.status === 'unsupported') return capability

  let renderer: Renderer | undefined
  try {
    renderer = createRenderer(
      capability.backend === 'webgpu'
        ? { device: capability.device }
        : { context: capability.context, forceWebGL: true },
    )
    await renderer.init()
    return { backend: capability.backend, renderer, status: 'ready' }
  } catch (error) {
    try {
      renderer?.dispose?.()
    } catch {}
    return { error, status: 'unsupported' }
  }
}
