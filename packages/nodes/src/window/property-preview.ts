import { type AnyNodeId, useLiveNodeOverrides, useScene, type WindowNode } from '@pascal-app/core'

export function createWindowPropertyPreview(id: AnyNodeId) {
  let pending: Partial<WindowNode> | undefined
  const dirty = () => {
    const scene = useScene.getState()
    scene.markDirty(id)
    const parent = scene.nodes[id]?.parentId
    if (parent) scene.markDirty(parent as AnyNodeId)
  }
  const clear = () => {
    if (!pending) return
    useLiveNodeOverrides.getState().clearFields(id, Object.keys(pending))
    pending = undefined
    dirty()
  }
  return {
    preview(patch: Partial<WindowNode>) {
      pending = { ...pending, ...patch }
      useLiveNodeOverrides.getState().set(id, patch)
      dirty()
    },
    commit(patch?: Partial<WindowNode>) {
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
      if (Object.keys(updates).length && useScene.getState().nodes[id]?.type === 'window')
        useScene.getState().updateNode(id, updates)
      clear()
    },
    cancel: clear,
  }
}
