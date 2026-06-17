import type { AnyNode, FenceNode, PaintResolveArgs } from '@pascal-app/core'
import { createSlotPaintCapability, previewGeometrySlot } from '../shared/slot-paint'

function resolveFenceRole(args: PaintResolveArgs): string | null {
  const slotId = (args.hitObject?.userData as { slotId?: unknown } | undefined)?.slotId
  return slotId === 'panel' || slotId === 'rail' ? slotId : null
}

export const fencePaint = createSlotPaintCapability({
  resolveRole: resolveFenceRole,
  applyPreview: previewGeometrySlot,
  legacyEffective: (node: AnyNode) => {
    const fence = node as FenceNode
    if (fence.materialPreset || fence.material) {
      return { material: fence.material, materialPreset: fence.materialPreset }
    }
    return null
  },
})
