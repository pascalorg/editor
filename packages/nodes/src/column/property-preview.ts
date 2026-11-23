import { type AnyNodeId, type ColumnNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { planColumnEdit } from './hosted-resize'

/** A property gesture owns only the fields it previews, including hosted-child positions. */
export function createColumnPropertyPreview(id: AnyNodeId) {
  let pending: Partial<ColumnNode> = {}
  const fields = new Map<AnyNodeId, string[]>()
  const clear = () => {
    for (const [nodeId, keys] of fields) {
      useLiveNodeOverrides.getState().clearFields(nodeId, keys)
      if (useScene.getState().nodes[nodeId]) useScene.getState().markDirty(nodeId)
    }
    fields.clear()
  }
  return {
    preview(patch: Partial<ColumnNode>) {
      const next = { ...pending, ...patch }
      const updates = planColumnEdit(id, next)
      if (!updates || useScene.getState().readOnly) return
      pending = next
      clear()
      for (const [nodeId, data] of updates) fields.set(nodeId, Object.keys(data))
      useLiveNodeOverrides.getState().setMany(updates)
      for (const [nodeId] of updates) useScene.getState().markDirty(nodeId)
    },
    commit() {
      const updates = planColumnEdit(id, pending)
      try {
        if (!updates) return
        const nodes = useScene.getState().nodes
        const changed = updates.filter(([nodeId, data]) =>
          Object.entries(data).some(
            ([key, value]) =>
              JSON.stringify((nodes[nodeId] as Record<string, unknown> | undefined)?.[key]) !==
              JSON.stringify(value),
          ),
        )
        if (changed.length)
          useScene.getState().updateNodes(changed.map(([id, data]) => ({ id, data })))
      } finally {
        clear()
        pending = {}
      }
    },
    cancel() {
      clear()
      pending = {}
    },
  }
}
