import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'bun:test'
import { get, set } from 'idb-keyval'
import {
  deleteAsset,
  listLocalAssetUrls,
  loadAssetUrl,
  saveAsset,
  sweepLocalAssetsExcept,
} from '../index'

const ASSET_PREFIX = 'asset_data:'

function file(contents: string, name = 'test.txt'): File {
  return new File([contents], name, { type: 'text/plain' })
}

describe('saveAsset', () => {
  const originalRandomUUID = crypto.randomUUID

  afterEach(() => {
    crypto.randomUUID = originalRandomUUID
  })

  test('returns an asset:// URL', async () => {
    const url = await saveAsset(file('hello'))
    expect(url.startsWith('asset://')).toBe(true)
  })

  test('generates distinct ids across calls', async () => {
    const [a, b] = await Promise.all([saveAsset(file('a')), saveAsset(file('b'))])
    expect(a).not.toBe(b)
  })

  // Regression test: crypto.randomUUID() throws/`undefined`s on plain-HTTP
  // origins because it requires a secure context (HTTPS or localhost). Every
  // upload used to fail on such deployments (see packages/editor's
  // reference-panel.tsx, local-guide-image.ts, both of which call saveAsset).
  test('still works when crypto.randomUUID is unavailable (insecure context)', async () => {
    // @ts-expect-error simulating a browser without Web Crypto's randomUUID
    crypto.randomUUID = undefined

    const url = await saveAsset(file('insecure-context'))
    expect(url.startsWith('asset://')).toBe(true)

    const loaded = await loadAssetUrl(url)
    expect(loaded).not.toBeNull()
  })
})

describe('loadAssetUrl', () => {
  test('round-trips a saved asset back to an object URL', async () => {
    const url = await saveAsset(file('round-trip'))
    const objectUrl = await loadAssetUrl(url)
    expect(objectUrl?.startsWith('blob:')).toBe(true)
  })

  test('passes through blob: and http(s) URLs unchanged', async () => {
    expect(await loadAssetUrl('blob:http://example.com/1234')).toBe('blob:http://example.com/1234')
    expect(await loadAssetUrl('https://cdn.example.com/a.glb')).toBe(
      'https://cdn.example.com/a.glb',
    )
  })

  test('returns null for an unknown asset id', async () => {
    expect(await loadAssetUrl('asset://does-not-exist')).toBeNull()
  })

  test('returns null for an empty URL', async () => {
    expect(await loadAssetUrl('')).toBeNull()
  })
})

describe('deleteAsset', () => {
  test('removes the IndexedDB entry so later loads miss', async () => {
    const url = await saveAsset(file('delete-me'))
    expect(await loadAssetUrl(url)).not.toBeNull()

    expect(await deleteAsset(url)).toBe(true)
    expect(await loadAssetUrl(url)).toBeNull()
  })

  test('ignores non-asset URLs', async () => {
    expect(await deleteAsset('https://cdn.example.com/a.glb')).toBe(false)
    expect(await deleteAsset('')).toBe(false)
  })
})

describe('local asset record formats', () => {
  test('lists and deletes legacy Files and versioned byte records without touching other keys', async () => {
    const legacyId = crypto.randomUUID()
    const bytesId = crypto.randomUUID()
    const otherKey = `other:${crypto.randomUUID()}`
    const legacyUrl = `asset://${legacyId}`
    const bytesUrl = `asset://${bytesId}`
    const bytes = new TextEncoder().encode('portable').buffer
    const record = { assetVersion: 1, bytes, type: 'text/plain' }
    await set(`${ASSET_PREFIX}${legacyId}`, file('legacy'))
    await set(`${ASSET_PREFIX}${bytesId}`, record)
    await set(otherKey, 'unrelated')

    const urls = await listLocalAssetUrls()
    expect(urls).toContain(legacyUrl)
    expect(urls).toContain(bytesUrl)
    expect(urls).not.toContain(`asset://${otherKey}`)
    expect(await deleteAsset(legacyUrl)).toBe(true)
    expect(await get(`${ASSET_PREFIX}${legacyId}`)).toBeUndefined()
    expect(await get(`${ASSET_PREFIX}${bytesId}`)).toEqual(record)
    expect(await deleteAsset(bytesUrl)).toBe(true)
    expect(await get(`${ASSET_PREFIX}${bytesId}`)).toBeUndefined()
    expect(await get(otherKey)).toBe('unrelated')
  })

  test('preserves referenced byte records during an explicit sweep', async () => {
    const keepId = crypto.randomUUID()
    const orphanId = crypto.randomUUID()
    const record = { assetVersion: 1, bytes: new Uint8Array([1, 2, 3]).buffer, type: 'image/png' }
    await set(`${ASSET_PREFIX}${keepId}`, record)
    await set(`${ASSET_PREFIX}${orphanId}`, record)
    const keep = (await listLocalAssetUrls()).filter((url) => url !== `asset://${orphanId}`)

    expect(await sweepLocalAssetsExcept(keep)).toBe(1)
    expect(await get(`${ASSET_PREFIX}${keepId}`)).toEqual(record)
    expect(await get(`${ASSET_PREFIX}${orphanId}`)).toBeUndefined()
    await deleteAsset(`asset://${keepId}`)
  })
})
