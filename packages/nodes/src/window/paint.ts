import type { PaintResolveArgs } from '@pascal-app/core'
import { createSlotPaintCapability, previewSlotByUserData } from '../shared/slot-paint'

/**
 * Window paint on the unified slot model. The window's viewer system tags each
 * built mesh with `userData.slotId` (`frame` / `glass`), so the role resolves
 * straight from the pointer hit; commit writes `node.slots[slotId]`.
 */
function resolveWindowRole(args: PaintResolveArgs): string | null {
  const slotId = (args.hitObject?.userData as { slotId?: string | null } | undefined)?.slotId
  return typeof slotId === 'string' ? slotId : null
}

export const windowPaint = createSlotPaintCapability({
  resolveRole: resolveWindowRole,
  applyPreview: previewSlotByUserData,
})
