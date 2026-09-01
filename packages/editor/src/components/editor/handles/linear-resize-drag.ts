import {
  type AnyNode,
  type AnyNodeId,
  type HandleDragModifiers,
  type LinearResizeHandle,
  type SceneApi,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { replacePreviewOverrideIds } from './preview-overrides'

export function createLinearResizeDragBinding({
  descriptor,
  initialNode,
  nodeId,
  sceneApi,
  initialModifiers,
}: {
  descriptor: LinearResizeHandle<AnyNode>
  initialNode: AnyNode
  nodeId: AnyNodeId
  sceneApi: SceneApi
  initialModifiers: HandleDragModifiers
}) {
  const overrideId = descriptor.overrideTarget?.(initialNode, sceneApi) ?? nodeId
  let lastModifiers = initialModifiers
  let previewOverrideIds = new Set<AnyNodeId>()

  return {
    overrideId,
    commit: descriptor.commit
      ? (patch: Partial<AnyNode>) =>
          descriptor.commit?.(initialNode, patch, sceneApi, lastModifiers)
      : undefined,
    apply(next: number, modifiers: HandleDragModifiers): Partial<AnyNode> {
      lastModifiers = modifiers
      const patch = descriptor.apply(initialNode, next, sceneApi, modifiers) as Partial<AnyNode>
      const previewEntries = descriptor.previewOverrides?.(initialNode, next, sceneApi, modifiers)
      if (!previewEntries) return patch

      previewOverrideIds = replacePreviewOverrideIds(
        previewOverrideIds,
        previewEntries,
        (previewId) => {
          useLiveNodeOverrides.getState().clear(previewId)
          useScene.getState().markDirty(previewId)
        },
      )
      useLiveNodeOverrides
        .getState()
        .setMany(
          previewEntries.map(([id, previewPatch]) => [id, previewPatch as Record<string, unknown>]),
        )
      for (const [previewId] of previewEntries) {
        useScene.getState().markDirty(previewId)
      }
      return patch
    },
    clearPreview(): void {
      for (const previewId of previewOverrideIds) {
        useLiveNodeOverrides.getState().clear(previewId)
        useScene.getState().markDirty(previewId)
      }
      previewOverrideIds = new Set()
    },
  }
}
