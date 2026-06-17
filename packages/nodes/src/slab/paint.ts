import type { AnyNode, SlabNode } from '@pascal-app/core'
import { createSlotPaintCapability, previewGeometrySlot } from '../shared/slot-paint'

/**
 * Slab paint on the unified slot model. A slab has one paintable surface, so
 * every face resolves to the `surface` slot; commit writes `node.slots.surface`
 * (a shared scene-material or `library:` ref) like the shelf.
 */
export const slabPaint = createSlotPaintCapability({
  resolveRole: () => 'surface',
  applyPreview: previewGeometrySlot,
  legacyEffective: (node: AnyNode) => {
    const slab = node as SlabNode
    if (slab.materialPreset || slab.material) {
      return { material: slab.material, materialPreset: slab.materialPreset }
    }
    return null
  },
})
