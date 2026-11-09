import { DUCT_BODY_SLOT_ID } from '@pascal-app/core'
import { createSlotPaintCapability, previewGeometrySlot } from './slot-paint'

export const ductBodyPaint = createSlotPaintCapability({
  resolveRole: ({ hitObject }) => {
    const slotId = (hitObject?.userData as { slotId?: unknown } | undefined)?.slotId
    return slotId === DUCT_BODY_SLOT_ID ? DUCT_BODY_SLOT_ID : null
  },
  applyPreview: previewGeometrySlot,
})
