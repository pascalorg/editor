import type { SlotDeclaration } from '@pascal-app/core'
import { createSlotPaintCapability, previewGeometrySlot } from './slot-paint'

export const DUCT_BODY_SLOT_ID = 'body'
export const DUCT_BODY_SLOT_DEFAULT = '#ffffff'

export function ductBodySlots(): SlotDeclaration[] {
  return [{ slotId: DUCT_BODY_SLOT_ID, label: 'Body', default: DUCT_BODY_SLOT_DEFAULT }]
}

export const ductBodyPaint = createSlotPaintCapability({
  resolveRole: ({ hitObject }) => {
    const slotId = (hitObject?.userData as { slotId?: unknown } | undefined)?.slotId
    return slotId === DUCT_BODY_SLOT_ID ? DUCT_BODY_SLOT_ID : null
  },
  applyPreview: previewGeometrySlot,
})
