import {
  createSlotPaintCapability,
  previewSlotByUserData,
  resolveSlotByReRaycast,
} from '../shared/slot-paint'

/**
 * Window paint on the unified slot model. The window's opening proxy (a proud,
 * invisible cutout) wins the shared scene raycast over the wall in front of the
 * recessed window, so `resolveSlotByReRaycast` re-raycasts the window's own
 * subtree to find the part (frame / glass) under the cursor.
 */
export const windowPaint = createSlotPaintCapability({
  resolveRole: resolveSlotByReRaycast,
  applyPreview: previewSlotByUserData,
})
