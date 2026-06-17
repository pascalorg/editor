import type { SlotDeclaration } from '@pascal-app/core'

export type SlabSlotId = 'surface'

// Visual parity with the retired DEFAULT_SLAB_MATERIAL (light grey).
export const SLAB_SLOT_DEFAULT_COLOR = '#e5e5e5'

/** A slab exposes a single paintable floor surface. */
export function slabSlots(): SlotDeclaration[] {
  return [{ slotId: 'surface', label: 'Surface', default: SLAB_SLOT_DEFAULT_COLOR }]
}
