import type { SlotDeclaration } from '@pascal-app/core'
import { PANEL_SLOT_ID } from '@pascal-app/viewer'

export { PANEL_SLOT_ID }

/** A panel has one paintable part: its face. */
export function panelSlots(): SlotDeclaration[] {
  return [{ slotId: PANEL_SLOT_ID, label: 'Surface' }]
}
