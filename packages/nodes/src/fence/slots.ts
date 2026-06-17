import type { SlotDeclaration } from '@pascal-app/core'

export type FenceSlotId = 'panel' | 'rail'

// Body (posts / base / infill) reads as a dark composite by default; the rail
// cap as wood. Both are repaintable per slot.
export const FENCE_PANEL_SLOT_DEFAULT = 'library:preset-charcoal'
export const FENCE_RAIL_SLOT_DEFAULT = 'library:wood-finewood27'

export function fenceSlots(): SlotDeclaration[] {
  return [
    { slotId: 'panel', label: 'Panel', default: FENCE_PANEL_SLOT_DEFAULT },
    { slotId: 'rail', label: 'Rail', default: FENCE_RAIL_SLOT_DEFAULT },
  ]
}
