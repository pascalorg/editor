import {
  createSlotPaintCapability,
  previewGeometrySlot,
  resolveSlotByReRaycast,
} from '../shared/slot-paint'

/** The panel mesh is built by `def.geometry` and tagged with its slot id. */
export const panelPaint = createSlotPaintCapability({
  resolveRole: resolveSlotByReRaycast,
  applyPreview: previewGeometrySlot,
})
