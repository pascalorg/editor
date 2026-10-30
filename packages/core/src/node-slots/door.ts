import type { SlotDeclaration } from '../registry/types'

export type DoorSlotId = 'panel' | 'frame' | 'casing-a' | 'casing-b' | 'glass' | 'hardware'

// Picker swatches. Rendering falls back to the live body/glass/hardware defaults
// (which already track shading + theme), so these are just the indicator colours.
const PANEL_DEFAULT = 'library:preset-softwhite'
const FRAME_DEFAULT = 'library:preset-softwhite'
const GLASS_DEFAULT = 'library:preset-glass'
// Chrome — a flat (non-PBR) catalog metal finish.
const HARDWARE_DEFAULT = 'library:metal-chrome'

/**
 * A door exposes its panel, frame, glass, hardware and casing on each host-wall
 * face. The opening reveal keeps its own material.
 */
export function doorSlots(): SlotDeclaration[] {
  return [
    { slotId: 'panel', label: 'Panel', default: PANEL_DEFAULT },
    { slotId: 'frame', label: 'Frame', default: FRAME_DEFAULT },
    { slotId: 'casing-a', label: 'Casing A', default: FRAME_DEFAULT },
    { slotId: 'casing-b', label: 'Casing B', default: FRAME_DEFAULT },
    { slotId: 'glass', label: 'Glass', default: GLASS_DEFAULT },
    { slotId: 'hardware', label: 'Hardware', default: HARDWARE_DEFAULT },
  ]
}
