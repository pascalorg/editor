// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, mock, test } from 'bun:test'
import { UnsupportedGpuViewerFallback } from '../components/viewer/unsupported-gpu-fallback'
import { initializeGpuRenderer, type RendererCapabilityCanvas } from './renderer-capability'

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
      canvas: canvasWithContexts({}),
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
      canvas: canvasWithContexts({}),
      createRenderer,
      gpu: null,
    })

    expect(result.status).toBe('unsupported')
    expect(createRenderer).not.toHaveBeenCalled()
  })

  test('falls back to WebGL when WebGPU cannot provide a device', async () => {
    const webglContext = {}
    const init = mock(async () => undefined)
    const createRenderer = mock(() => ({ init }))

    const result = await initializeGpuRenderer({
      canvas: canvasWithContexts({ webgl2: webglContext }),
      createRenderer,
      gpu: {
        requestAdapter: async () => ({
          requestDevice: async () => {
            throw new Error('device unavailable')
          },
        }),
      },
    })

    expect(result.status).toBe('ready')
    expect(createRenderer).toHaveBeenCalledWith({ context: webglContext, forceWebGL: true })
    expect(init).toHaveBeenCalledTimes(1)
  })

  test('reports unsupported when WebGPU device and WebGL are unavailable', async () => {
    const result = await initializeGpuRenderer({
      canvas: canvasWithContexts({}),
      createRenderer: () => ({ init: async () => undefined }),
      gpu: {
        requestAdapter: async () => null,
      },
    })

    expect(result.status).toBe('unsupported')
  })

  test('catches renderer initialization failure and selects the fallback UI', async () => {
    const dispose = mock(() => undefined)

    const result = await initializeGpuRenderer({
      canvas: canvasWithContexts({ webgl2: {} }),
      createRenderer: () => ({
        dispose,
        init: async () => {
          throw new Error('getSupportedExtensions on null context')
        },
      }),
      gpu: null,
    })

    expect(result.status).toBe('unsupported')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(UnsupportedGpuViewerFallback())).toContain('3D viewer unavailable')
  })
})
