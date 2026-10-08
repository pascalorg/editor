import type { SlotDeclaration } from '../registry/types'
import type { BlockNode, BlockTopology } from '../schema/nodes/block'

export const BLOCK_BODY_SLOT_ID = 'body'

export function blockMaterialSlotIds(
  topology: BlockTopology,
  slots: Record<string, string> | undefined,
  slotNames?: Record<string, string>,
): string[] {
  const slotIds = new Set<string>([BLOCK_BODY_SLOT_ID])
  for (const slotId of Object.keys(slotNames ?? {})) slotIds.add(slotId)
  for (const slotId of Object.keys(slots ?? {})) slotIds.add(slotId)
  for (const face of topology.faces) slotIds.add(face.materialSlot)
  return [...slotIds]
}

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
