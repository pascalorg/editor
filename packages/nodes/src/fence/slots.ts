import type { SlotDeclaration } from '@pascal-app/core'

export type FenceSlotId = 'surface'

export const FENCE_SLOT_DEFAULT = 'library:wood-finewood27'

export function fenceSlots(): SlotDeclaration[] {
  return [{ slotId: 'surface', label: 'Surface', default: FENCE_SLOT_DEFAULT }]
}
