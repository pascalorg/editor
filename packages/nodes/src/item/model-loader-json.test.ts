import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { LoadingManager } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  classifyItemModelLoadFailure,
  getPendingItemModelLoadCount,
  getUnavailableItemAsset,
  ItemGLTFLoader,
} from './model-loader'

const originalFetch = globalThis.fetch
const originalProgressEvent = globalThis.ProgressEvent

if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class TestProgressEvent extends Event {} as typeof ProgressEvent
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

afterAll(() => {
  globalThis.ProgressEvent = originalProgressEvent
})

const invalidJson = 'owned deliberately invalid GLB'
const validJson = JSON.stringify({
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ name: 'control-scene', nodes: [0] }],
  nodes: [{ name: 'json-control', extras: { marker: 'preserved' } }],
})

function glb(json: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(json)
  const chunkLength = Math.ceil(encoded.length / 4) * 4
  const buffer = new ArrayBuffer(20 + chunkLength)
  const header = new DataView(buffer)
  // glTF 2.0 binary header followed by one space-padded JSON chunk; no external assets.
  header.setUint32(0, 0x46546c67, true)
  header.setUint32(4, 2, true)
  header.setUint32(8, buffer.byteLength, true)
  header.setUint32(12, chunkLength, true)
  header.setUint32(16, 0x4e4f534a, true)
  const chunk = new Uint8Array(buffer, 20)
  chunk.fill(0x20)
  chunk.set(encoded)
  return buffer
}

function respondWith(body: string | ArrayBuffer) {
  const request = mock(async () => new Response(body, { status: 200 }))
  globalThis.fetch = request as typeof fetch
  return request
}

function expectControl(gltf: GLTF) {
  expect(gltf.asset.version).toBe('2.0')
  expect(gltf.scene.name).toBe('control-scene')
  expect(gltf.scene.getObjectByName('json-control')?.userData).toEqual({
    name: 'json-control',
    marker: 'preserved',
  })
  expect(getUnavailableItemAsset(gltf)).toBeNull()
}

// Protect asset unavailability without swallowing programmer errors or changing native GLB parsing.
// These checks use real parser/load entry points; only HTTP responses are supplied in memory.
describe('ItemGLTFLoader JSON failure boundaries', () => {
  for (const [format, data] of [
    ['text', invalidJson],
    ['buffer', new TextEncoder().encode(invalidJson).buffer],
  ] as const) {
    test(`tags only the actual invalid JSON ${format} parse error as unavailable`, async () => {
      const manager = new LoadingManager()
      const loader = new ItemGLTFLoader(manager, [])
      const error = await loader.parseAsync(data, '').catch((error: unknown) => error)

      expect(error).toBeInstanceOf(SyntaxError)
      expect(classifyItemModelLoadFailure(error)).toBe('unavailable')
      expect(classifyItemModelLoadFailure(new SyntaxError((error as Error).message))).toBe(
        'unexpected',
      )
      expect(getPendingItemModelLoadCount(manager)).toBe(0)
    })
  }

  test('loads an HTTP 200 invalid JSON body as unavailable with its exact URL and error', async () => {
    const manager = new LoadingManager()
    const loader = new ItemGLTFLoader(manager, [])
    const url = 'https://example.test/model-loader-json/invalid-body.glb'
    const request = respondWith(invalidJson)
    let expectedError: unknown
    try {
      JSON.parse(invalidJson)
    } catch (error) {
      expectedError = error
    }
    expect(expectedError).toBeInstanceOf(SyntaxError)

    const result = await loader.loadAsync(url)

    expect(getUnavailableItemAsset(result)).toEqual({
      url,
      message: (expectedError as SyntaxError).message,
    })
    expect(getPendingItemModelLoadCount(manager)).toBe(0)
    expect(request).toHaveBeenCalledTimes(1)
  })

  for (const [format, data] of [
    ['text', validJson],
    ['buffer', new TextEncoder().encode(validJson).buffer],
    ['GLB', glb(validJson)],
  ] as const) {
    test(`preserves the named scene and extras when parsing and loading valid ${format}`, async () => {
      const manager = new LoadingManager()
      const loader = new ItemGLTFLoader(manager, [])
      const request = respondWith(data)

      expectControl(await loader.parseAsync(data, ''))
      expectControl(await loader.loadAsync(`https://example.test/model-loader-json/${format}.glb`))
      expect(getPendingItemModelLoadCount(manager)).toBe(0)
      expect(request).toHaveBeenCalledTimes(1)
    })
  }

  test('keeps malformed native GLB JSON on the unexpected SyntaxError path', async () => {
    const manager = new LoadingManager()
    const loader = new ItemGLTFLoader(manager, [])
    const data = glb(invalidJson)
    const request = respondWith(data)
    const parseError = await loader.parseAsync(data, '').catch((error: unknown) => error)
    const loadError = await loader
      .loadAsync('https://example.test/model-loader-json/invalid-chunk.glb')
      .catch((error: unknown) => error)

    expect(parseError).toBeInstanceOf(SyntaxError)
    expect(classifyItemModelLoadFailure(parseError)).toBe('unexpected')
    expect(loadError).toBeInstanceOf(SyntaxError)
    expect(classifyItemModelLoadFailure(loadError)).toBe('unexpected')
    expect(getPendingItemModelLoadCount(manager)).toBe(0)
    expect(request).toHaveBeenCalledTimes(1)
  })

  for (const ErrorType of [SyntaxError, Error]) {
    for (const [format, data] of [
      ['JSON', validJson],
      ['GLB', glb(validJson)],
    ] as const) {
      test(`preserves a plugin ${ErrorType.name} identity when parsing and loading valid ${format}`, async () => {
        const manager = new LoadingManager()
        const loader = new ItemGLTFLoader(manager, [])
        const original = new ErrorType('plugin factory bug')
        loader.register(() => {
          throw original
        })
        const request = respondWith(data)

        await expect(loader.parseAsync(data, '')).rejects.toBe(original)
        expect(classifyItemModelLoadFailure(original)).toBe('unexpected')
        await expect(
          loader.loadAsync(
            `https://example.test/model-loader-json/plugin-${ErrorType.name}-${format}.glb`,
          ),
        ).rejects.toBe(original)
        expect(classifyItemModelLoadFailure(original)).toBe('unexpected')
        expect(getPendingItemModelLoadCount(manager)).toBe(0)
        expect(request).toHaveBeenCalledTimes(1)
      })
    }
  }
})
