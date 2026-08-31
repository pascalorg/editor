import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'bun:test'
import { loadAssetUrl, saveAsset } from './asset-storage'

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
