import { afterAll, afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { LoadingManager } from 'three'
import {
  cancelItemModelLoad,
  classifyItemModelLoadFailure,
  getUnavailableItemAsset,
  ItemGLTFLoader,
} from './model-loader'

const originalFetch = globalThis.fetch
const originalProgressEvent = globalThis.ProgressEvent

if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class TestProgressEvent extends Event {} as typeof ProgressEvent
}

afterAll(() => {
  globalThis.ProgressEvent = originalProgressEvent
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

const load = (loader: ItemGLTFLoader, url: string) =>
  new Promise<
    | { kind: 'loaded'; unavailable: ReturnType<typeof getUnavailableItemAsset> }
    | { error: unknown; kind: 'error' }
  >((resolve) => {
    loader.load(
      url,
      (gltf) => resolve({ kind: 'loaded', unavailable: getUnavailableItemAsset(gltf) }),
      undefined,
      (error) => resolve({ error, kind: 'error' }),
    )
  })

describe('classifyItemModelLoadFailure', () => {
  test('distinguishes unavailable, retryable, and unexpected failures', () => {
    expect(
      classifyItemModelLoadFailure(
        Object.assign(new Error('missing'), { response: { status: 404 } }),
      ),
    ).toBe('unavailable')
    expect(
      classifyItemModelLoadFailure(
        Object.assign(new Error('temporary'), { response: { status: 503 } }),
      ),
    ).toBe('retryable')
    expect(
      classifyItemModelLoadFailure(
        Object.assign(new Error('forbidden'), { response: { status: 403 } }),
      ),
    ).toBe('unavailable')
    expect(classifyItemModelLoadFailure(new TypeError('Failed to fetch'))).toBe('retryable')
    expect(classifyItemModelLoadFailure(new Error('Malformed glTF'))).toBe('unexpected')
  })
})

describe('ItemGLTFLoader', () => {
  test('resolves missing responses as an unavailable item instead of rejecting', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    try {
      globalThis.fetch = mock(async () => new Response(null, { status: 404 })) as typeof fetch

      const result = await load(
        new ItemGLTFLoader(undefined, []),
        'https://example.test/missing.glb',
      )

      expect(result.kind).toBe('loaded')
      if (result.kind !== 'loaded') return
      expect(result.unavailable).toMatchObject({ url: 'https://example.test/missing.glb' })
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  test('resolves exhausted network failures as an unavailable item', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    try {
      globalThis.fetch = mock(async () => {
        throw new TypeError('Failed to fetch')
      }) as typeof fetch

      const result = await load(
        new ItemGLTFLoader(undefined, []),
        'https://example.test/offline.glb',
      )

      expect(result.kind).toBe('loaded')
      if (result.kind !== 'loaded') return
      expect(result.unavailable?.message).toBe('Failed to fetch')
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  test('keeps malformed model data on the unexpected error path', async () => {
    globalThis.fetch = mock(
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    ) as typeof fetch

    const result = await load(new ItemGLTFLoader(undefined, []), 'https://example.test/broken.glb')

    expect(result.kind).toBe('error')
  })

  test('retries a transient response and can recover', async () => {
    const validGltf = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{}] })
    let attempt = 0
    globalThis.fetch = mock(async () => {
      attempt += 1
      return attempt === 1
        ? new Response(null, { status: 503 })
        : new Response(validGltf, { status: 200 })
    }) as typeof fetch

    const manager = new LoadingManager()
    let hostErrors = 0
    let hostLoads = 0
    manager.onError = () => {
      hostErrors += 1
    }
    manager.onLoad = () => {
      hostLoads += 1
    }

    const result = await load(new ItemGLTFLoader(manager, [0]), 'https://example.test/retry.glb')

    expect(result).toEqual({ kind: 'loaded', unavailable: null })
    expect(attempt).toBe(2)
    expect(hostErrors).toBe(0)
    expect(hostLoads).toBe(1)
  })

  test('does not retry after the last consumer cancels a missing asset', async () => {
    const url = 'https://example.test/cancelled.glb'
    const request = mock(async () => {
      throw new TypeError('Failed to fetch')
    })
    globalThis.fetch = request as typeof fetch
    const manager = new LoadingManager()
    let hostLoads = 0
    manager.onLoad = () => {
      hostLoads += 1
    }

    new ItemGLTFLoader(manager, [10]).load(url, () => {
      throw new Error('cancelled load must not resolve')
    })
    await Bun.sleep(0)
    cancelItemModelLoad(url)
    await Bun.sleep(20)

    expect(request).toHaveBeenCalledTimes(1)
    expect(hostLoads).toBe(1)
  })
})
