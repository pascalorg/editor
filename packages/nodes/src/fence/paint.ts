import type { AnyNode, FenceNode, PaintResolveArgs } from '@pascal-app/core'
import { createSlotPaintCapability, previewGeometrySlot } from '../shared/slot-paint'

const FENCE_SLOT_IDS = new Set<string>(['posts', 'infill', 'base', 'rail'])

function resolveFenceRole(args: PaintResolveArgs): string | null {
  const slotId = (args.hitObject?.userData as { slotId?: unknown } | undefined)?.slotId
  return typeof slotId === 'string' && FENCE_SLOT_IDS.has(slotId) ? slotId : null
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
