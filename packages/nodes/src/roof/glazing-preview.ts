import {
  type AnyNodeId,
  getEffectiveNode,
  getRoofGlazing,
  type RoofGlazing,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'

/** A roof panel edits several segments as one gesture without writing the scene per tick. */
export function createRoofGlazingPreview(ids: readonly AnyNodeId[]) {
  const pending = new Map<AnyNodeId, Partial<RoofSegmentNode>>()
  const clear = () => {
    for (const [id, patch] of pending) {
      useLiveNodeOverrides.getState().clearFields(id, Object.keys(patch))
      useScene.getState().markDirty(id)
    }
    pending.clear()
  }
  const commit = (patch?: Partial<RoofSegmentNode>) => {
    const updates = ids.flatMap((id) => {
      if (useScene.getState().nodes[id]?.type !== 'roof-segment') return []
      const data = { ...pending.get(id), ...patch }
      return Object.keys(data).length ? [{ id, data }] : []
    })
    if (updates.length) useScene.getState().updateNodes(updates)
    clear()
  }
  return {
    previewFields(data: Partial<RoofSegmentNode>) {
      for (const id of ids) {
        if (useScene.getState().nodes[id]?.type !== 'roof-segment') continue
        pending.set(id, { ...pending.get(id), ...data })
        useLiveNodeOverrides.getState().set(id, data)
        useScene.getState().markDirty(id)
      }
    },
    previewGlazing(update: (config: RoofGlazing) => RoofGlazing) {
      for (const id of ids) {
        const stored = useScene.getState().nodes[id]
        if (stored?.type !== 'roof-segment') continue
        const data = { glazing: update(getRoofGlazing(getEffectiveNode(stored))) }
        pending.set(id, { ...pending.get(id), ...data })
        useLiveNodeOverrides.getState().set(id, data)
        useScene.getState().markDirty(id)
      }
    },
    commit,
    finish: () => commit(),
    cancel: clear,
  }
}
