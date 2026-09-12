import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { deleteAsset, loadAssetUrl, saveAsset } from './asset-storage'
import {
  bumpLocalAssetSceneEpoch,
  cancelLocalAssetDelete,
  clearPendingLocalAssetDeletes,
  collectNodeAssetUrls,
  collectSceneAssetUrls,
  scheduleLocalAssetCleanupForRemovedNodes,
  scheduleLocalAssetDelete,
} from './local-asset-lifecycle'

function file(contents: string, name = 'test.txt'): File {
  return new File([contents], name, { type: 'text/plain' })
}

beforeEach(() => {
  clearPendingLocalAssetDeletes()
})

afterEach(() => {
  clearPendingLocalAssetDeletes()
})

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

describe('scheduleLocalAssetDelete', () => {
  test('deletes after the grace period when nothing re-references the URL', async () => {
    const url = await saveAsset(file('delete-later'))
    scheduleLocalAssetDelete(url, 20)
    expect(await loadAssetUrl(url)).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await loadAssetUrl(url)).toBeNull()
  })

  test('cancelLocalAssetDelete cancels a pending delete', async () => {
    const url = await saveAsset(file('cancelled'))
    scheduleLocalAssetDelete(url, 20)
    cancelLocalAssetDelete(url)

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await loadAssetUrl(url)).not.toBeNull()
  })

  test('does not delete after a scene epoch bump', async () => {
    const url = await saveAsset(file('other-scene'))
    scheduleLocalAssetDelete(url, 20)
    bumpLocalAssetSceneEpoch()

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await loadAssetUrl(url)).not.toBeNull()
  })
})

describe('scheduleLocalAssetCleanupForRemovedNodes', () => {
  test('schedules only URLs no remaining node still references', async () => {
    const shared = await saveAsset(file('shared'))
    const orphan = await saveAsset(file('orphan'))

    const removed = [
      { id: 'g1', type: 'guide', url: orphan },
      { id: 'g2', type: 'guide', url: shared },
    ] as never[]
    const remaining = {
      keep: { id: 'keep', type: 'guide', url: shared },
    } as never

    scheduleLocalAssetCleanupForRemovedNodes(removed, () => remaining, 20)
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(await loadAssetUrl(shared)).not.toBeNull()
    expect(await loadAssetUrl(orphan)).toBeNull()
  })

  test('collectSceneAssetUrls walks url and src', () => {
    const urls = collectSceneAssetUrls({
      a: { id: 'a', type: 'guide', url: 'asset://g' } as never,
      b: { id: 'b', type: 'item', src: 'asset://s' } as never,
    })
    expect(urls.sort()).toEqual(['asset://g', 'asset://s'])
  })
})

describe('deleteAsset', () => {
  test('removes the IndexedDB entry', async () => {
    const url = await saveAsset(file('gone'))
    expect(await deleteAsset(url)).toBe(true)
    expect(await loadAssetUrl(url)).toBeNull()
  })
})
