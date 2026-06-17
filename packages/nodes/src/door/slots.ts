import type { SlotDeclaration } from '@pascal-app/core'

export type DoorSlotId = 'panel' | 'glass'

// Picker swatches. Rendering falls back to the live body/glass defaults (which
// already track shading + theme), so these are just the indicator colours.
const PANEL_DEFAULT = '#f2f0ed'
const GLASS_DEFAULT = '#87ceeb'

/**
 * A door exposes two paintable slots: `panel` (the door body — frame casing +
 * leaf) and `glass`. The opening reveal keeps its own material.
 */
export function doorSlots(): SlotDeclaration[] {
  return [
    { slotId: 'panel', label: 'Panel', default: PANEL_DEFAULT },
    { slotId: 'glass', label: 'Glass', default: GLASS_DEFAULT },
  ]
}
