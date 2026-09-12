import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import useScene from '../store/use-scene'
import { loadAssetUrl, saveAsset } from './asset-storage'
import {
  clearPendingLocalAssetDeletes,
  setLocalAssetDeleteGraceMsForTests,
} from './local-asset-lifecycle'

// updateNodesAction batches dirty marks in requestAnimationFrame.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame
}

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

  test('undo restores the node and keeps the File', async () => {
    const url = await saveAsset(file('undo-me'))
    const guideId = 'guide_undo' as never
    useScene.getState().setScene(
      {
        [guideId]: { id: guideId, type: 'guide', url, parentId: null, visible: true },
      } as never,
      [guideId] as never,
    )
    useScene.getState().deleteNode(guideId)
    // Undo via temporal store restores the node before the timer fires.
    useScene.getState().setScene(
      {
        [guideId]: { id: guideId, type: 'guide', url, parentId: null, visible: true },
      } as never,
      [guideId] as never,
    )
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await loadAssetUrl(url)).not.toBeNull()
  })

  test('url replacement keeps File when another node still shares it', async () => {
    const shared = await saveAsset(file('shared-replace'))
    const next = await saveAsset(file('next-replace'))
    const a = 'guide_ra' as never
    const b = 'guide_rb' as never
    useScene.getState().setScene(
      {
        [a]: { id: a, type: 'guide', url: shared, parentId: null, visible: true },
        [b]: { id: b, type: 'guide', url: shared, parentId: null, visible: true },
      } as never,
      [a, b] as never,
    )
    useScene.getState().updateNode(a, { url: next } as never)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await loadAssetUrl(shared)).not.toBeNull()
    expect(await loadAssetUrl(next)).not.toBeNull()
  })

  test('url replacement schedules delete of previous File when unreferenced', async () => {
    const old = await saveAsset(file('old-replace'))
    const next = await saveAsset(file('new-replace'))
    const id = 'guide_only' as never
    useScene.getState().setScene(
      {
        [id]: { id, type: 'guide', url: old, parentId: null, visible: true },
      } as never,
      [id] as never,
    )
    useScene.getState().updateNode(id, { url: next } as never)
    expect(useScene.getState().nodes[id]?.url).toBe(next)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await loadAssetUrl(old)).toBeNull()
    expect(await loadAssetUrl(next)).not.toBeNull()
  })

  test('clearScene / setScene bump epoch so pending deletes do not fire', async () => {
    const url = await saveAsset(file('epoch-clear'))
    const id = 'guide_epoch' as never
    useScene.getState().setScene(
      {
        [id]: { id, type: 'guide', url, parentId: null, visible: true },
      } as never,
      [id] as never,
    )
    useScene.getState().deleteNode(id)
    // Graph replacement without applySceneGraphToEditor — still invalidates.
    useScene.getState().setScene({}, [] as never)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await loadAssetUrl(url)).not.toBeNull()
  })
})
