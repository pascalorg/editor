import { createSlotPaintCapability, previewGeometrySlot } from './slot-paint'

export const mechanicalPaint = createSlotPaintCapability({
  resolveRole: ({ hitObject }) => {
    const slot = hitObject?.userData?.slotId
    return typeof slot === 'string' ? slot : null
  },
  applyPreview: previewGeometrySlot,
})
