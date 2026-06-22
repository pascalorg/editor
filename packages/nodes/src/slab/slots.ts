import type { SlotDeclaration } from '@pascal-app/core'

export type SlabSlotId = 'surface' | 'side'

// Declared default appearances for an unpainted slab in colored mode — a
// catalog `library:<id>` finish or a `#rrggbb` colour. Textures-off collapses
// both to the themed floor role (the escape hatch).
//
// `surface` (top face) keeps the wood floor default and the slot id used before
// the top/side split, so existing painted slabs keep their floor finish. `side`
// (walls + underside) defaults to a light grey so a slab's edges read as a
// distinct trim rather than wood end-grain.
export const SLAB_TOP_SLOT_DEFAULT = 'library:wood-woodplank48'
export const SLAB_SIDE_SLOT_DEFAULT = '#cccccc'

/**
 * A slab exposes two paintable faces: the top floor surface and its sides
 * (vertical walls + underside).
 */
export function slabSlots(): SlotDeclaration[] {
  return [
    { slotId: 'surface', label: 'Top', default: SLAB_TOP_SLOT_DEFAULT },
    { slotId: 'side', label: 'Sides', default: SLAB_SIDE_SLOT_DEFAULT },
  ]
}
