import type { SlotDeclaration } from '@pascal-app/core'
import type { ColumnNode } from './schema'

export type ColumnSlotId = 'shaft' | 'base' | 'capital' | 'frame'

export const COLUMN_SHAFT_DEFAULT = 'library:concrete-plaster'
export const COLUMN_BASE_DEFAULT = 'library:concrete-plaster'
export const COLUMN_CAPITAL_DEFAULT = 'library:concrete-plaster'
export const COLUMN_FRAME_DEFAULT = 'library:metal-steel'

export function columnSlots(node: ColumnNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'shaft', label: 'Shaft', default: COLUMN_SHAFT_DEFAULT },
  ]

  if (node.baseStyle !== 'none') {
    slots.push({ slotId: 'base', label: 'Base', default: COLUMN_BASE_DEFAULT })
  }

  if (node.capitalStyle !== 'none') {
    slots.push({ slotId: 'capital', label: 'Capital', default: COLUMN_CAPITAL_DEFAULT })
  }

  if (node.supportStyle !== 'vertical') {
    slots.push({ slotId: 'frame', label: 'Frame', default: COLUMN_FRAME_DEFAULT })
  }

  return slots
}
