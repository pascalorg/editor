import { type AnyNodeId, useLiveNodeOverrides, useScene, type WallNode } from '@pascal-app/core'

export function createWallPropertyPreview(id: AnyNodeId) {
  let pending: Partial<WallNode> | undefined
  const clear = () => {
    if (!pending) return
    useLiveNodeOverrides.getState().clearFields(id, Object.keys(pending))
    pending = undefined
    useScene.getState().markDirty(id)
  }
  return {
    preview(patch: Partial<WallNode>) {
      pending = { ...pending, ...patch }
      useLiveNodeOverrides.getState().set(id, patch)
      useScene.getState().markDirty(id)
    },
    commit(patch?: Partial<WallNode>) {
      const live = useLiveNodeOverrides.getState().get(id)
      const current =
        pending && live
          ? Object.fromEntries(
              Object.keys(pending)
                .filter((key) => key in live)
                .map((key) => [key, live[key]]),
            )
          : undefined
      const updates = { ...current, ...patch }
      if (Object.keys(updates).length && useScene.getState().nodes[id]?.type === 'wall')
        useScene.getState().updateNode(id, updates)
      clear()
    },
    cancel: clear,
  }
}
