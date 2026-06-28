import type { AnyNode, SlabNode } from '@pascal-app/core'
import { createSlotPaintCapability, previewGeometrySlot } from '../shared/slot-paint'

/**
 * Slab paint on the unified slot model. A slab exposes two faces — `surface`
 * (top) and `side` (walls + underside) — each its own mesh tagged with
 * `userData.slotId`, so the clicked face resolves to its slot; commit writes
 * `node.slots[slotId]` (a shared scene-material or `library:` ref) like the shelf.
 */
export const slabPaint = createSlotPaintCapability({
  roomScope: true,
  resolveRole: ({ hitObject }) => {
    const slotId = (hitObject?.userData as { slotId?: string } | undefined)?.slotId
    return slotId === 'side' ? 'side' : 'surface'
  },
  applyPreview: previewGeometrySlot,
  // Legacy inline material applied to the whole slab → maps onto the top only;
  // the side picker shows its own default.
  legacyEffective: (node: AnyNode, role: string) => {
    if (role !== 'surface') return null
    const slab = node as SlabNode
    if (slab.materialPreset || slab.material) {
      return { material: slab.material, materialPreset: slab.materialPreset }
    }
    return null
  },
})
