import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadAssetUrl, saveAsset, useScene } from '@pascal-app/core'
import {
  bumpLocalAssetSceneEpoch,
  cancelLocalAssetDelete,
  clearPendingLocalAssetDeletes,
  collectSceneAssetUrls,
  scheduleLocalAssetDelete,
} from './local-asset-lifecycle'

function file(contents: string, name = 'test.txt'): File {
  return new File([contents], name, { type: 'text/plain' })
}

beforeEach(() => {
  clearPendingLocalAssetDeletes()
  useScene.getState().clearScene()
})

afterEach(() => {
  clearPendingLocalAssetDeletes()
})

describe('collectSceneAssetUrls', () => {
  test('collects url and src asset:// references', () => {
    const urls = collectSceneAssetUrls({
      a: { id: 'a', type: 'guide', url: 'asset://guide-1' } as never,
      b: { id: 'b', type: 'item', src: 'asset://model-1' } as never,
      c: { id: 'c', type: 'item', src: 'https://cdn.example.com/x.glb' } as never,
    })
    expect(urls.sort()).toEqual(['asset://guide-1', 'asset://model-1'])
  })
})

describe('scheduleLocalAssetDelete', () => {
  test('deletes after the grace period when nothing re-references the URL', async () => {
    const url = await saveAsset(file('delete-later'))
    scheduleLocalAssetDelete(url, 20)
    expect(await loadAssetUrl(url)).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(await loadAssetUrl(url)).toBeNull()
  })

  test('keeps the File when the node is restored (undo) before the timer fires', async () => {
    const url = await saveAsset(file('undo-me'))
    scheduleLocalAssetDelete(url, 50)

    useScene.getState().setScene(
      {
        guide_restored: { id: 'guide_restored', type: 'guide', url },
      } as never,
      ['guide_restored'] as never,
    )

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await loadAssetUrl(url)).not.toBeNull()
  })

  test('cancelLocalAssetDelete cancels a pending delete', async () => {
    const url = await saveAsset(file('cancelled'))
    scheduleLocalAssetDelete(url, 20)
    cancelLocalAssetDelete(url)

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(await loadAssetUrl(url)).not.toBeNull()
  })

  test('does not delete after a scene switch (another graph may still use the File)', async () => {
    const url = await saveAsset(file('other-scene'))
    scheduleLocalAssetDelete(url, 20)
    // Simulate applySceneGraphToEditor loading a different project.
    bumpLocalAssetSceneEpoch()
    useScene.getState().clearScene()

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(await loadAssetUrl(url)).not.toBeNull()
  })

  test('ignores non-asset URLs', () => {
    expect(() => scheduleLocalAssetDelete('https://cdn.example.com/a.glb')).not.toThrow()
  })
})
