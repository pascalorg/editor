import { describe, expect, test } from 'bun:test'
import { collectNodeAssetUrlList, collectLocalStorageSceneAssetUrls } from './local-asset-gc'

describe('local-asset-gc collectors', () => {
  test('collectNodeAssetUrlList walks url and src', () => {
    const urls = collectNodeAssetUrlList({
      a: { url: 'asset://guide' },
      b: { src: 'asset://model' },
      c: { src: 'https://cdn.example.com/x.glb' },
    })
    expect(urls.sort()).toEqual(['asset://guide', 'asset://model'])
  })

  test('collectLocalStorageSceneAssetUrls tolerates missing storage', () => {
    // In Node/Bun without a populated key this is empty, not a throw.
    expect(Array.isArray(collectLocalStorageSceneAssetUrls())).toBe(true)
  })
})
