import type { SlotDeclaration } from '../registry/types'

export const DUCT_BODY_SLOT_ID = 'body'
export const DUCT_BODY_SLOT_DEFAULT = '#ffffff'

export function ductBodySlots(): SlotDeclaration[] {
  return [{ slotId: DUCT_BODY_SLOT_ID, label: 'Body', default: DUCT_BODY_SLOT_DEFAULT }]
}
