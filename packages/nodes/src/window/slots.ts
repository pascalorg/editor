import type { SlotDeclaration } from '@pascal-app/core'

export type WindowSlotId = 'frame' | 'glass'

// Picker swatches. Rendering falls back to the live frame/glass defaults (which
// already track shading + theme), so these are just the indicator colours.
const FRAME_DEFAULT = '#f2f0ed'
const GLASS_DEFAULT = '#87ceeb'

/** A window exposes two paintable slots: the joinery frame and the glass. */
export function windowSlots(): SlotDeclaration[] {
  return [
    { slotId: 'frame', label: 'Frame', default: FRAME_DEFAULT },
    { slotId: 'glass', label: 'Glass', default: GLASS_DEFAULT },
  ]
}
