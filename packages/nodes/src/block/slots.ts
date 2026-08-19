import type { BlockNode, SlotDeclaration } from '@pascal-app/core'
import { BLOCK_BODY_SLOT_ID, blockMaterialSlotIds } from './material-slots'

export const BLOCK_SLOT_ID = BLOCK_BODY_SLOT_ID

function slotLabel(slotId: string): string {
  if (slotId === BLOCK_SLOT_ID) return 'Body'
  return slotId
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

export function blockSlots(node: BlockNode): SlotDeclaration[] {
  return blockMaterialSlotIds(node.topology, node.slots, node.slotNames).map((slotId) => ({
    slotId,
    label: node.slotNames?.[slotId]?.trim() || slotLabel(slotId),
  }))
}
