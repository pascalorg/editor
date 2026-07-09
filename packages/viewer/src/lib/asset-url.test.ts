// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { resolveAssetUrl, resolveCdnUrl } from './asset-url'

describe('asset URL resolution without an explicit CDN', () => {
  test('keeps root-relative catalog assets on the current origin', () => {
    expect(resolveCdnUrl('/items/fridge-compact/model.glb')).toBe(
      '/items/fridge-compact/model.glb',
    )
  })

  test('normalizes relative catalog assets to root-relative paths', () => {
    expect(resolveCdnUrl('items/tv-stand/model.glb')).toBe('/items/tv-stand/model.glb')
  })

  test('keeps external assets unchanged', async () => {
    const url = 'https://example.com/items/model.glb'
    expect(resolveCdnUrl(url)).toBe(url)
    expect(await resolveAssetUrl(url)).toBe(url)
  })

  test('uses the same-origin rule in the async resolver', async () => {
    expect(await resolveAssetUrl('/items/shoe-cabinet/model.glb')).toBe(
      '/items/shoe-cabinet/model.glb',
    )
  })
})
