import { createSlotPaintCapability, previewGeometrySlot } from '../shared/slot-paint'

export const cabinetPaint = createSlotPaintCapability({
  materialTarget: 'cabinet',
  resolveRole: ({ hitObject }) => {
    const slotId = (hitObject?.userData as { slotId?: string | null } | undefined)?.slotId
    return typeof slotId === 'string' ? slotId : null
  },
  applyPreview: previewGeometrySlot,
  legacyEffective: (node, role) => {
    if (role === 'hardware') return null
    return {
      material: (node as { material?: unknown }).material as never,
      materialPreset: (node as { materialPreset?: string }).materialPreset,
    }
  },
})
