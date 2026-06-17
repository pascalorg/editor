import type { SlotDeclaration } from '@pascal-app/core'

export type CeilingSlotId = 'surface'

// Visual parity with the retired DEFAULT_CEILING_MATERIAL (warm beige).
export const CEILING_SLOT_DEFAULT_COLOR = '#f5f5dc'

/** A ceiling exposes a single paintable underside surface. */
export function ceilingSlots(): SlotDeclaration[] {
  return [{ slotId: 'surface', label: 'Surface', default: CEILING_SLOT_DEFAULT_COLOR }]
}
