import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'
import {
  listLocalAssetUrls,
  loadAssetUrl,
  saveAsset,
  sweepLocalAssetsExcept,
} from './asset-storage'
import { collectNodeAssetUrls, collectSceneAssetUrls } from './local-asset-lifecycle'

function file(contents: string, name = 'test.txt'): File {
  return new File([contents], name, { type: 'text/plain' })
}

describe('collectNodeAssetUrls', () => {
  test('collects url and src asset:// references', () => {
    const urls = [
      ...collectNodeAssetUrls({ id: 'a', type: 'guide', url: 'asset://guide-1' } as never),
      ...collectNodeAssetUrls({ id: 'b', type: 'item', src: 'asset://model-1' } as never),
      ...collectNodeAssetUrls({
        id: 'c',
        type: 'item',
        src: 'https://cdn.example.com/x.glb',
      } as never),
    ]
    expect(urls.sort()).toEqual(['asset://guide-1', 'asset://model-1'])
  })
})

describe('collectSceneAssetUrls', () => {
  test('walks url and src across nodes', () => {
    const urls = collectSceneAssetUrls({
      a: { id: 'a', type: 'guide', url: 'asset://g' } as never,
      b: { id: 'b', type: 'item', src: 'asset://s' } as never,
    })
    expect(urls.sort()).toEqual(['asset://g', 'asset://s'])
  })
})

describe('sweepLocalAssetsExcept', () => {
  test('keeps assets referenced by any persisted scene in the keep-set', async () => {
    const shared = await saveAsset(file('shared-by-two-scenes'))
    const orphan = await saveAsset(file('orphan'))

    // Simulate two persisted scenes sharing `shared`.
    const sceneA = collectSceneAssetUrls({
      guide: { id: 'guide', type: 'guide', url: shared } as never,
    })
    const sceneB = collectSceneAssetUrls({
      scan: { id: 'scan', type: 'scan', url: shared } as never,
    })
    const removed = await sweepLocalAssetsExcept([...sceneA, ...sceneB])

    expect(removed).toBeGreaterThanOrEqual(1)
    expect(await loadAssetUrl(shared)).not.toBeNull()
    expect(await loadAssetUrl(orphan)).toBeNull()
    expect((await listLocalAssetUrls()).includes(orphan)).toBe(false)
  })

  test('deletes Files referenced only by nothing', async () => {
    const url = await saveAsset(file('unreferenced'))
    await sweepLocalAssetsExcept([])
    expect(await loadAssetUrl(url)).toBeNull()
  })
})
