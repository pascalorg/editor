import type { SlotDeclaration } from '@pascal-app/core'

export const CUSTOM_MESH_SLOT_ID = 'body'

export function customMeshSlots(): SlotDeclaration[] {
  return [{ slotId: CUSTOM_MESH_SLOT_ID, label: 'Whole mesh' }]
}
