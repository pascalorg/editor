import { type PaintCapability, slotDefaultPaintMaterial, slotPaintMaterial } from '@pascal-app/core'
import { openingCasingPaintLabel } from '../shared/opening-casing'
import {
  createSlotPaintCapability,
  declaredSlotLook,
  previewSlotByUserData,
  resolveSlotByReRaycast,
} from '../shared/slot-paint'

/**
 * Window paint on the unified slot model. The window's opening proxy (a proud,
 * invisible cutout) wins the shared scene raycast over the wall in front of the
 * recessed window, so `resolveSlotByReRaycast` re-raycasts the window's own
 * subtree to find the part (frame / glass) under the cursor.
 */
const base = createSlotPaintCapability({
  resolveRole: resolveSlotByReRaycast,
  applyPreview: previewSlotByUserData,
  erasedLook: ({ node, role, materials = {} }) => {
    if (role !== 'casing-a' && role !== 'casing-b') return declaredSlotLook(node, role)
    if (node.type !== 'window' || node.source) return null
    const frame =
      slotPaintMaterial(node.slots?.frame, materials) ?? slotDefaultPaintMaterial(node.slots?.frame)
    if (frame) return frame
    if (node.material) return { material: node.material }
    return declaredSlotLook(node, 'frame')
  },
  legacyEffective: (node, role) =>
    node.type === 'window' && !node.source && node.material && role === 'frame'
      ? { material: node.material, materialPreset: undefined }
      : null,
})

export const windowPaint: PaintCapability = {
  ...base,
  roleLabel: (_node, role) => openingCasingPaintLabel(role),
  getEffectiveMaterial: (args) => {
    const own = base.getEffectiveMaterial?.(args)
    if (own || (args.role !== 'casing-a' && args.role !== 'casing-b')) return own ?? null
    return base.getEffectiveMaterial?.({ ...args, role: 'frame' }) ?? null
  },
}
