import type { SlotDeclaration } from '@pascal-app/core'

export type LeanToSlotId = 'flashing' | 'ledger' | 'beam' | 'framing' | 'posts' | 'footings'

export const LEAN_TO_SLOT_DEFAULTS: Partial<Record<LeanToSlotId, string>> = {
  flashing: 'library:metal-steel',
  posts: 'library:concrete-plaster',
  footings: 'library:concrete-plaster',
}

export function leanToSlots(): SlotDeclaration[] {
  return [
    { slotId: 'flashing', label: 'Flashing', default: LEAN_TO_SLOT_DEFAULTS.flashing },
    { slotId: 'ledger', label: 'Ledger / high beam', default: LEAN_TO_SLOT_DEFAULTS.ledger },
    { slotId: 'beam', label: 'Low beam', default: LEAN_TO_SLOT_DEFAULTS.beam },
    { slotId: 'framing', label: 'Framing', default: LEAN_TO_SLOT_DEFAULTS.framing },
    { slotId: 'posts', label: 'Posts', default: LEAN_TO_SLOT_DEFAULTS.posts },
    { slotId: 'footings', label: 'Footings', default: LEAN_TO_SLOT_DEFAULTS.footings },
  ]
}
