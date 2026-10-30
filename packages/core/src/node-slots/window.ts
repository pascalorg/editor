import type { SlotDeclaration } from '../registry/types'

export type WindowSlotId = 'frame' | 'casing-a' | 'casing-b' | 'glass'

// Picker swatches. Rendering falls back to the live frame/glass defaults (which
// already track shading + theme), so these are just the indicator colours.
const FRAME_DEFAULT = 'library:preset-softwhite'
const GLASS_DEFAULT = 'library:preset-glass'

/** A window exposes its frame, glass and casing on each host-wall face. */
export function windowSlots(): SlotDeclaration[] {
  return [
    { slotId: 'frame', label: 'Frame', default: FRAME_DEFAULT },
    { slotId: 'casing-a', label: 'Casing A', default: FRAME_DEFAULT },
    { slotId: 'casing-b', label: 'Casing B', default: FRAME_DEFAULT },
    { slotId: 'glass', label: 'Glass', default: GLASS_DEFAULT },
  ]
}
