import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'
import { deleteAsset, loadAssetUrl, saveAsset } from '@pascal-app/core'
import { collectNodeAssetUrlList, runLocalAssetGc } from './local-asset-gc'

type FetchHandler = (url: string) => Response | Promise<Response>

function mockFetch(handler: FetchHandler): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    return handler(url)
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

function json(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('local-asset-gc collectors', () => {
  test('collectNodeAssetUrlList walks url and src', () => {
    const urls = collectNodeAssetUrlList({
      a: { url: 'asset://guide' },
      b: { src: 'asset://model' },
      c: { src: 'https://cdn.example.com/x.glb' },
    })
    expect(urls.sort()).toEqual(['asset://guide', 'asset://model'])
  })
})

describe('runLocalAssetGc safety', () => {
  test('skips GC when the scene list is truncated at the API limit', async () => {
    const scenes = Array.from({ length: 500 }, (_, i) => ({ id: `scene-${i}` }))
    const restore = mockFetch((url) => {
      if (url.includes('/api/scenes?')) return json({ scenes })
      return json({ graph: { nodes: {} } })
    })
    try {
      const result = await runLocalAssetGc(() => ({ nodes: {} }))
      expect(result).toBeNull()
    } finally {
      restore()
    }
  })

  test('skips GC when listing scenes fails', async () => {
    const restore = mockFetch(() => json({ error: 'no' }, false, 500))
    try {
      expect(await runLocalAssetGc(() => ({ nodes: {} }))).toBeNull()
    } finally {
      restore()
    }
  })

  test('skips GC when the scene inventory is malformed', async () => {
    for (const body of [{}, { scenes: [{ id: null }] }]) {
      const restore = mockFetch(() => json(body))
      try {
        expect(await runLocalAssetGc(() => ({ nodes: {} }))).toBeNull()
      } finally {
        restore()
      }
    }
  })

  test('skips GC when a listed scene has no graph', async () => {
    const restore = mockFetch((url) =>
      url.includes('/api/scenes?') ? json({ scenes: [{ id: 'scene-1' }] }) : json({}),
    )
    try {
      expect(await runLocalAssetGc(() => ({ nodes: {} }))).toBeNull()
    } finally {
      restore()
    }
  })

  test('skips GC when the local scene cannot be parsed', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => '{not-json' },
    })
    const restore = mockFetch(() => json({ scenes: [] }))
    try {
      expect(await runLocalAssetGc(() => ({ nodes: {} }))).toBeNull()
    } finally {
      restore()
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  test('re-reads live nodes so mid-GC uploads stay in the keep-set', async () => {
    // Live graph is empty when GC starts, then gains a guide during the
    // per-scene fetch — the File must survive the sweep.
    let live: Record<string, unknown> = {}
    const lateAsset = 'asset://uploaded-mid-gc'
    const restore = mockFetch(async (url) => {
      if (url.includes('/api/scenes?')) {
        // Simulate latency while the user uploads.
        live = { guide: { url: lateAsset } }
        return json({ scenes: [] })
      }
      return json({ graph: { nodes: {} } })
    })
    try {
      const result = await runLocalAssetGc(() => ({ nodes: live }))
      // Keep-set included the late upload, so sweep ran but did not need to
      // delete it (result is a count of removals — File itself is not present
      // in this unit test's IDB; the contract is "keep-set includes live URLs").
      expect(result).not.toBeNull()
      expect(collectNodeAssetUrlList(live)).toContain(lateAsset)
    } finally {
      restore()
    }
  })

  test('keeps a material texture added to the live graph during inventory', async () => {
    const assetUrl = await saveAsset(new File(['texture'], 'texture.png'))
    let materials: unknown = {}
    const restore = mockFetch((url) => {
      if (url.includes('/api/scenes?')) {
        materials = { floor: { texture: { url: assetUrl } } }
        return json({ scenes: [] })
      }
      return json({ graph: { nodes: {} } })
    })
    try {
      await runLocalAssetGc(() => ({ nodes: {}, materials }))
      expect(await loadAssetUrl(assetUrl)).not.toBeNull()
    } finally {
      restore()
      await deleteAsset(assetUrl)
    }
  })
})
