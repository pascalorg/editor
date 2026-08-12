import type { CustomMeshNode, SlotDeclaration } from '@pascal-app/core'
import { CUSTOM_MESH_BODY_SLOT_ID, customMeshMaterialSlotIds } from './material-slots'

export const CUSTOM_MESH_SLOT_ID = CUSTOM_MESH_BODY_SLOT_ID

function slotLabel(slotId: string): string {
  if (slotId === CUSTOM_MESH_SLOT_ID) return 'Body'
  return slotId
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

export function customMeshSlots(node: CustomMeshNode): SlotDeclaration[] {
  return customMeshMaterialSlotIds(node.topology, node.slots).map((slotId) => ({
    slotId,
    label: slotLabel(slotId),
  }))
}
