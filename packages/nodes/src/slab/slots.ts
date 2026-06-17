import type { SlotDeclaration } from '@pascal-app/core'

export type SlabSlotId = 'surface'

// Declared default appearance for an unpainted slab surface in colored mode —
// a catalog `library:<id>` finish or a `#rrggbb` colour. Textures-off collapses
// to the themed floor role (the escape hatch).
export const SLAB_SLOT_DEFAULT = 'library:wood-woodplank48'

/** A slab exposes a single paintable floor surface. */
export function slabSlots(): SlotDeclaration[] {
  return [{ slotId: 'surface', label: 'Surface', default: SLAB_SLOT_DEFAULT }]
}
