import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadAssetUrl, saveAsset } from './asset-storage'
import {
  clearPendingLocalAssetDeletes,
  setLocalAssetDeleteGraceMsForTests,
} from './local-asset-lifecycle'
import useScene from '../store/use-scene'

function file(contents: string, name = 'test.txt'): File {
  return new File([contents], name, { type: 'text/plain' })
}

beforeEach(() => {
  clearPendingLocalAssetDeletes()
  setLocalAssetDeleteGraceMsForTests(20)
  useScene.getState().clearScene()
})

afterEach(() => {
  clearPendingLocalAssetDeletes()
  setLocalAssetDeleteGraceMsForTests(120_000)
})

/**
 * Regression for #733 review: keyboard Delete calls
 * `useScene.getState().deleteNode(...)` directly (use-keyboard.ts), bypassing
 * the Site panel. Cleanup must run from the core deletion lifecycle.
 */
describe('deleteNode local asset cleanup', () => {
  test('schedules orphaned asset:// after grace period (keyboard path)', async () => {
    const url = await saveAsset(file('keyboard-delete'))
    const guideId = 'guide_kb' as never
    useScene.getState().setScene(
      {
        [guideId]: {
          id: guideId,
          type: 'guide',
          url,
          parentId: null,
          visible: true,
        },
      } as never,
      [guideId] as never,
    )
    expect(useScene.getState().nodes[guideId]).toBeDefined()

    useScene.getState().deleteNode(guideId)
    expect(useScene.getState().nodes[guideId]).toBeUndefined()
    expect(await loadAssetUrl(url)).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await loadAssetUrl(url)).toBeNull()
  })

  test('keeps asset when another live node still references it', async () => {
    const url = await saveAsset(file('shared-asset'))
    const a = 'guide_a' as never
    const b = 'guide_b' as never
    useScene.getState().setScene(
      {
        [a]: { id: a, type: 'guide', url, parentId: null, visible: true },
        [b]: { id: b, type: 'guide', url, parentId: null, visible: true },
      } as never,
      [a, b] as never,
    )

    useScene.getState().deleteNode(a)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await loadAssetUrl(url)).not.toBeNull()
  })
})
