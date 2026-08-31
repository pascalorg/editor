import { createSlotPaintCapability, previewSlotByUserData } from '../shared/slot-paint'

export const elevatorPaint = createSlotPaintCapability({
  resolveRole: (args) => (args.hitObject?.userData?.slotId as string) ?? null,
  applyPreview: previewSlotByUserData,
  legacyEffective: () => null,
})
