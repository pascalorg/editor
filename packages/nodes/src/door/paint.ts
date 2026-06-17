import type { PaintResolveArgs } from '@pascal-app/core'
import { createSlotPaintCapability, previewSlotByUserData } from '../shared/slot-paint'

/**
 * Door paint on the unified slot model. The door's viewer system tags each built
 * mesh with `userData.slotId` (`panel` / `glass`), so the role resolves straight
 * from the pointer hit; commit writes `node.slots[slotId]`.
 */
function resolveDoorRole(args: PaintResolveArgs): string | null {
  const slotId = (args.hitObject?.userData as { slotId?: string | null } | undefined)?.slotId
  return typeof slotId === 'string' ? slotId : null
}

export const doorPaint = createSlotPaintCapability({
  resolveRole: resolveDoorRole,
  applyPreview: previewSlotByUserData,
})
