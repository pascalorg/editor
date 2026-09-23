import { type AnyNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import type { OpeningPropertyPreviewDependencies } from './opening-property-preview'

export const openingPropertyPreviewHost: OpeningPropertyPreviewDependencies = {
  nodes: () => useScene.getState().nodes,
  override: (id) => useLiveNodeOverrides.getState().get(id),
  setOverride: (id, patch) => useLiveNodeOverrides.getState().set(id, patch),
  clearOverrideFields: (id, fields) => useLiveNodeOverrides.getState().clearFields(id, fields),
  markDirty: (id) => useScene.getState().markDirty(id),
  updateNode: (id, patch) => useScene.getState().updateNode(id, patch as Partial<AnyNode>),
  scheduleFrame: (callback) => {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
    callback(0)
    return 0
  },
  cancelFrame: (handle) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
  },
  scheduleDelay: (callback, delay) => setTimeout(callback, delay) as unknown as number,
  cancelDelay: (handle) => clearTimeout(handle),
}
