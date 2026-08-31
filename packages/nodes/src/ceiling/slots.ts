import type { SlotDeclaration } from '@pascal-app/core'

export type CeilingSlotId = 'surface'

// Soft white — the default underside colour for an unpainted ceiling. (A
// ceiling renders flat-tinted, so this is a colour, not a `library:` finish.)
export const CEILING_SLOT_DEFAULT_COLOR = '#f2eee6'

/** A ceiling exposes a single paintable underside surface. */
export function ceilingSlots(): SlotDeclaration[] {
  return [{ slotId: 'surface', label: 'Surface', default: CEILING_SLOT_DEFAULT_COLOR }]
}
