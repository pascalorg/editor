import type { AnyNode, FenceNode } from '@pascal-app/core'
import { createSlotPaintCapability, previewGeometrySlot } from '../shared/slot-paint'

export const fencePaint = createSlotPaintCapability({
  resolveRole: () => 'surface',
  applyPreview: previewGeometrySlot,
  legacyEffective: (node: AnyNode) => {
    const fence = node as FenceNode
    if (fence.materialPreset || fence.material) {
      return { material: fence.material, materialPreset: fence.materialPreset }
    }
    return null
  },
})
