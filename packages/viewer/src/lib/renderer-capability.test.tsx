// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, mock, test } from 'bun:test'
import { UnsupportedGpuViewerFallback } from '../components/viewer/unsupported-gpu-fallback'
import {
  initializeGpuRenderer,
  type RendererBackendParameters,
  type RendererCapabilityCanvas,
} from './renderer-capability'

function canvasWithContexts(contexts: Partial<Record<'webgl2', unknown>>) {
  return {
    getContext: (contextId: 'webgl2') => contexts[contextId] ?? null,
  } satisfies RendererCapabilityCanvas
}

describe('GPU renderer capability and initialization', () => {
  test('uses a working WebGPU device without requiring WebGL', async () => {
    const device = {}
    const createRenderer = mock(() => ({ init: async () => undefined }))

    const result = await initializeGpuRenderer({
      createRenderer,
      gpu: {
        requestAdapter: async () => ({
          requestDevice: async () => device,
        }),
      },
    })

    expect(result.status).toBe('ready')
    expect(createRenderer).toHaveBeenCalledWith({ device })
  })

  test('reports unsupported when neither WebGPU nor WebGL is available', async () => {
    const createRenderer = mock(() => ({ init: async () => undefined }))

    const result = await initializeGpuRenderer({
      createRenderer,
      gpu: null,
      probeCanvas: canvasWithContexts({}),
    })

    expect(result.status).toBe('unsupported')
    expect(createRenderer).not.toHaveBeenCalled()
  })

  test('falls back to WebGL when WebGPU cannot provide a device', async () => {
    const webglContext = {}
    const init = mock(async () => undefined)
    const createRenderer = mock(() => ({ init }))

    const result = await initializeGpuRenderer({
      createRenderer,
      gpu: {
        requestAdapter: async () => ({
          requestDevice: async () => {
            throw new Error('device unavailable')
          },
        }),
      },
      probeCanvas: canvasWithContexts({ webgl2: webglContext }),
    })

    expect(result.status).toBe('ready')
    expect(createRenderer).toHaveBeenCalledWith({ forceWebGL: true })
    expect(init).toHaveBeenCalledTimes(1)
  })

  test('falls back to WebGL when WebGPU renderer initialization fails', async () => {
    const device = {}
    const webglContext = {}
    const displayGetContext = mock((_contextId: 'webgl2', attributes?: { antialias?: boolean }) =>
      attributes?.antialias ? webglContext : null,
    )
    const webgpuDispose = mock(() => undefined)
    const webglInit = mock(async () => undefined)
    const parameters: RendererBackendParameters[] = []

    const result = await initializeGpuRenderer({
      createRenderer: (backendParameters) => {
        parameters.push(backendParameters)
        if (backendParameters.device) {
          return {
            dispose: webgpuDispose,
            init: async () => {
              throw new Error('WebGPU renderer init failed')
            },
          }
        }
        return {
          init: async () => {
            if (!displayGetContext('webgl2', { antialias: true })) {
              throw new Error('WebGL context unavailable')
            }
            await webglInit()
          },
        }
      },
      gpu: {
        requestAdapter: async () => ({
          requestDevice: async () => device,
        }),
      },
    })

    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.backend).toBe('webgl')
    expect(parameters).toEqual([{ device }, { forceWebGL: true }])
    expect(displayGetContext).toHaveBeenCalledWith('webgl2', { antialias: true })
    expect(webgpuDispose).toHaveBeenCalledTimes(1)
    expect(webglInit).toHaveBeenCalledTimes(1)
  })

  test('isolates WebGL capability probing from the display canvas', async () => {
    const probeContext = {}
    const displayContext = {}
    const probeGetContext = mock(() => probeContext)
    const displayGetContext = mock((_contextId: 'webgl2', attributes?: { antialias?: boolean }) =>
      attributes?.antialias ? displayContext : null,
    )

    const result = await initializeGpuRenderer({
      createRenderer: (backendParameters) => ({
        init: async () => {
          expect(backendParameters).toEqual({ forceWebGL: true })
          expect(displayGetContext('webgl2', { antialias: true })).toBe(displayContext)
        },
      }),
      gpu: null,
      probeCanvas: { getContext: probeGetContext },
    })

    expect(result.status).toBe('ready')
    expect(probeGetContext).toHaveBeenCalledTimes(1)
    expect(probeGetContext).toHaveBeenCalledWith('webgl2')
    expect(displayGetContext).toHaveBeenCalledTimes(1)
    expect(displayGetContext).toHaveBeenCalledWith('webgl2', { antialias: true })
  })

  test('times out a hung WebGPU adapter request and falls back to WebGL', async () => {
    const createRenderer = mock(() => ({ init: async () => undefined }))

    const result = await initializeGpuRenderer({
      createRenderer,
      gpu: {
        requestAdapter: () => new Promise<never>(() => undefined),
      },
      probeCanvas: canvasWithContexts({ webgl2: {} }),
      webgpuTimeoutMs: 10,
    })

    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.backend).toBe('webgl')
    expect(createRenderer).toHaveBeenCalledWith({ forceWebGL: true })
  })

  test('reports unsupported after a hung WebGPU adapter times out without WebGL', async () => {
    const result = await initializeGpuRenderer({
      createRenderer: () => ({ init: async () => undefined }),
      gpu: {
        requestAdapter: () => new Promise<never>(() => undefined),
      },
      probeCanvas: canvasWithContexts({}),
      webgpuTimeoutMs: 10,
    })

    expect(result.status).toBe('unsupported')
    expect(JSON.stringify(UnsupportedGpuViewerFallback())).toContain('3D viewer unavailable')
  })

  test('times out hung WebGPU renderer initialization and falls back to WebGL', async () => {
    const device = {}
    const webgpuDispose = mock(() => undefined)
    const parameters: RendererBackendParameters[] = []

    const result = await initializeGpuRenderer({
      createRenderer: (backendParameters) => {
        parameters.push(backendParameters)
        return backendParameters.device
          ? {
              dispose: webgpuDispose,
              init: () => new Promise<never>(() => undefined),
            }
          : { init: async () => undefined }
      },
      gpu: {
        requestAdapter: async () => ({ requestDevice: async () => device }),
      },
      webgpuTimeoutMs: 10,
    })

    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.backend).toBe('webgl')
    expect(parameters).toEqual([{ device }, { forceWebGL: true }])
    expect(webgpuDispose).toHaveBeenCalledTimes(1)
  })

  test('reports unsupported when WebGPU device and WebGL are unavailable', async () => {
    const result = await initializeGpuRenderer({
      createRenderer: () => ({ init: async () => undefined }),
      gpu: {
        requestAdapter: async () => null,
      },
      probeCanvas: canvasWithContexts({}),
    })

    expect(result.status).toBe('unsupported')
  })

  test('catches renderer initialization failure and selects the fallback UI', async () => {
    const dispose = mock(() => undefined)

    const result = await initializeGpuRenderer({
      createRenderer: () => ({
        dispose,
        init: async () => {
          throw new Error('getSupportedExtensions on null context')
        },
      }),
      gpu: null,
      probeCanvas: canvasWithContexts({ webgl2: {} }),
    })

    expect(result.status).toBe('unsupported')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(UnsupportedGpuViewerFallback())).toContain('3D viewer unavailable')
  })
})
