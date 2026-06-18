import type { SlotDeclaration, StairNode } from '@pascal-app/core'

export type StairSlotId = 'treads' | 'body' | 'railing'

export const STAIR_TREADS_SLOT_DEFAULT = 'library:wood-woodplank48'
export const STAIR_BODY_SLOT_DEFAULT = 'library:preset-lightgrey'
export const STAIR_RAILING_SLOT_DEFAULT = 'library:metal-steel'

export function stairSlots(node: StairNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'treads', label: 'Treads', default: STAIR_TREADS_SLOT_DEFAULT },
    { slotId: 'body', label: 'Body', default: STAIR_BODY_SLOT_DEFAULT },
  ]

  if (node.railingMode && node.railingMode !== 'none') {
    slots.push({ slotId: 'railing', label: 'Railing', default: STAIR_RAILING_SLOT_DEFAULT })
  }

  return slots
}
