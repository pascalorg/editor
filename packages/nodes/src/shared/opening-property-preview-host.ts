import { type AnyNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import type { OpeningPropertyPreviewDependencies } from './opening-property-preview'

export const openingPropertyPreviewHost: OpeningPropertyPreviewDependencies = {
  nodes: () => useScene.getState().nodes,
  override: (id) => useLiveNodeOverrides.getState().get(id),
  setOverride: (id, patch) => useLiveNodeOverrides.getState().set(id, patch),
  clearOverrideFields: (id, fields) => useLiveNodeOverrides.getState().clearFields(id, fields),
  markDirty: (id) => useScene.getState().markDirty(id),
  updateNode: (id, patch) => useScene.getState().updateNode(id, patch as Partial<AnyNode>),
}
