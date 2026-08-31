import type { SlotDeclaration } from '@pascal-app/core'

export type DoorSlotId = 'panel' | 'frame' | 'glass' | 'hardware'

// Picker swatches. Rendering falls back to the live body/glass/hardware defaults
// (which already track shading + theme), so these are just the indicator colours.
const PANEL_DEFAULT = 'library:preset-softwhite'
const FRAME_DEFAULT = 'library:preset-softwhite'
const GLASS_DEFAULT = 'library:preset-glass'
// Chrome — a flat (non-PBR) catalog metal finish.
const HARDWARE_DEFAULT = 'library:metal-chrome'

/**
 * A door exposes four paintable slots: `panel` (leaf faces), `frame`, `glass`,
 * and `hardware` (handle / hinges / closer / panic bar). The opening reveal
 * keeps its own material.
 */
export function doorSlots(): SlotDeclaration[] {
  return [
    { slotId: 'panel', label: 'Panel', default: PANEL_DEFAULT },
    { slotId: 'frame', label: 'Frame', default: FRAME_DEFAULT },
    { slotId: 'glass', label: 'Glass', default: GLASS_DEFAULT },
    { slotId: 'hardware', label: 'Hardware', default: HARDWARE_DEFAULT },
  ]
}
