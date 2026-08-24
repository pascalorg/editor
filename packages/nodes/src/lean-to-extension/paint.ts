import { createSlotPaintCapability, previewGeometrySlot } from '../shared/slot-paint'
import type { LeanToSlotId } from './slots'

const SLOT_IDS = new Set<LeanToSlotId>([
  'flashing',
  'ledger',
  'beam',
  'framing',
  'posts',
  'footings',
])

export const leanToPaint = createSlotPaintCapability({
  resolveRole: ({ hitObject }) => {
    const slotId = hitObject?.userData?.slotId
    return typeof slotId === 'string' && SLOT_IDS.has(slotId as LeanToSlotId) ? slotId : null
  },
  applyPreview: previewGeometrySlot,
})
