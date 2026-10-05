import { afterAll, afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { DefaultLoadingManager, LoadingManager } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  cancelItemModelLoad,
  classifyItemModelLoadFailure,
  createUnavailableItemGltf,
  getPendingItemModelLoadCount,
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

const validGltf = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{}] })

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
      expect(getPendingItemModelLoadCount()).toBe(0)
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
      expect(getPendingItemModelLoadCount()).toBe(0)
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
    expect(getPendingItemModelLoadCount()).toBe(0)
  })

  test('retries a transient response and can recover', async () => {
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
    expect(getPendingItemModelLoadCount(manager)).toBe(0)
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
    expect(getPendingItemModelLoadCount(manager)).toBe(1)
    cancelItemModelLoad(url)
    await Bun.sleep(20)

    expect(request).toHaveBeenCalledTimes(1)
    expect(hostLoads).toBe(1)
    expect(getPendingItemModelLoadCount(manager)).toBe(0)
  })

  test('counts concurrent transactions separately from shared URLs and other host loads', async () => {
    const request = Promise.withResolvers<Response>()
    globalThis.fetch = mock(() => request.promise) as typeof fetch
    const url = 'https://example.test/shared.glb'
    DefaultLoadingManager.itemStart(url)
    try {
      const first = load(new ItemGLTFLoader(), url)
      const second = load(new ItemGLTFLoader(), url)
      expect(getPendingItemModelLoadCount()).toBe(2)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      request.resolve(new Response(validGltf, { status: 200 }))
      await Promise.all([first, second])
      expect(getPendingItemModelLoadCount()).toBe(0)
    } finally {
      DefaultLoadingManager.itemEnd(url)
    }
  })

  test('keeps custom loading managers separate from the default manager', async () => {
    const firstRequest = Promise.withResolvers<Response>()
    const secondRequest = Promise.withResolvers<Response>()
    let index = 0
    globalThis.fetch = mock(() =>
      index++ === 0 ? firstRequest.promise : secondRequest.promise,
    ) as typeof fetch
    const manager = new LoadingManager()
    const ordinary = load(new ItemGLTFLoader(), 'https://example.test/default.glb')
    const custom = load(new ItemGLTFLoader(manager), 'https://example.test/custom.glb')
    expect(getPendingItemModelLoadCount()).toBe(1)
    expect(getPendingItemModelLoadCount(manager)).toBe(1)
    firstRequest.resolve(new Response(validGltf, { status: 200 }))
    await ordinary
    expect(getPendingItemModelLoadCount()).toBe(0)
    expect(getPendingItemModelLoadCount(manager)).toBe(1)
    secondRequest.resolve(new Response(validGltf, { status: 200 }))
    await custom
    expect(getPendingItemModelLoadCount(manager)).toBe(0)
  })

  test('retains one owned transaction throughout a retry and clears it on success', async () => {
    const retryStarted = Promise.withResolvers<void>()
    const retry = Promise.withResolvers<Response>()
    let attempt = 0
    globalThis.fetch = mock(async () => {
      attempt += 1
      if (attempt === 1) return new Response(null, { status: 503 })
      retryStarted.resolve()
      return retry.promise
    }) as typeof fetch
    const result = load(new ItemGLTFLoader(undefined, [0]), 'https://example.test/retry-count.glb')
    expect(getPendingItemModelLoadCount()).toBe(1)
    await retryStarted.promise
    expect(getPendingItemModelLoadCount()).toBe(1)
    retry.resolve(new Response(validGltf, { status: 200 }))
    await result
    expect(getPendingItemModelLoadCount()).toBe(0)
  })

  test('cancellation balances the count once without delivering the completed asset', async () => {
    const request = Promise.withResolvers<Response>()
    globalThis.fetch = mock(() => request.promise) as typeof fetch
    const manager = new LoadingManager()
    const ended = Promise.withResolvers<void>()
    manager.onLoad = () => ended.resolve()
    const onLoad = mock(() => {})
    const onError = mock(() => {})
    const url = 'https://example.test/cancel-in-flight.glb'
    new ItemGLTFLoader(manager).load(url, onLoad, undefined, onError)
    expect(getPendingItemModelLoadCount(manager)).toBe(1)
    cancelItemModelLoad(url)
    request.resolve(new Response(validGltf, { status: 200 }))
    await ended.promise
    expect(getPendingItemModelLoadCount(manager)).toBe(0)
    expect(onLoad).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  test('balances a synchronous loader failure', () => {
    const error = new Error('cannot start request')
    const start = spyOn(GLTFLoader.prototype, 'load').mockImplementation(() => {
      throw error
    })
    try {
      const manager = new LoadingManager()
      const onError = mock(() => {})
      const itemEnd = spyOn(manager, 'itemEnd')
      new ItemGLTFLoader(manager).load('invalid', () => {}, undefined, onError)
      expect(onError).toHaveBeenCalledWith(error)
      expect(itemEnd).toHaveBeenCalledTimes(1)
      expect(getPendingItemModelLoadCount(manager)).toBe(0)
    } finally {
      start.mockRestore()
    }
  })

  test('balances throwing consumer and manager callbacks without ending twice', () => {
    for (const failure of ['onLoad', 'onError', 'managerError', 'managerStart'] as const) {
      const error = new Error(failure)
      const manager = new LoadingManager()
      const itemEnd = spyOn(manager, 'itemEnd')
      if (failure === 'managerError')
        manager.onError = () => {
          throw error
        }
      if (failure === 'managerStart')
        manager.onStart = () => {
          throw error
        }
      const start = spyOn(GLTFLoader.prototype, 'load').mockImplementation(
        (url, complete, _, fail) => {
          if (failure === 'onLoad') complete(createUnavailableItemGltf(url, 'unavailable'))
          else fail?.(new Error('invalid model'))
        },
      )
      try {
        expect(() =>
          new ItemGLTFLoader(manager).load(
            'https://example.test/callback.glb',
            () => {
              throw error
            },
            undefined,
            () => {
              if (failure === 'onError') throw error
            },
          ),
        ).toThrow(error)
        expect(getPendingItemModelLoadCount(manager)).toBe(0)
        expect(itemEnd).toHaveBeenCalledTimes(1)
      } finally {
        start.mockRestore()
      }
    }
  })
})
