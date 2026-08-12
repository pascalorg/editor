import { createSlotPaintCapability, previewGeometrySlot } from '../shared/slot-paint'
import { CUSTOM_MESH_SLOT_ID } from './slots'

export const customMeshPaint = createSlotPaintCapability({
  resolveRole: () => CUSTOM_MESH_SLOT_ID,
  applyPreview: previewGeometrySlot,
})
