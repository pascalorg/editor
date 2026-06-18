import type { SlotDeclaration } from '@pascal-app/core'
import type { ShelfNode } from './schema'

export type ShelfSlotId = 'shelves' | 'frame' | 'back'

// Visual parity with the retired DEFAULT_SHELF_MATERIAL (off-white).
export const SHELF_SLOT_DEFAULT_COLOR = '#ffffff'

/** Map a builder mesh name to its slot id (null = not a paintable shelf part). */
export function shelfSlotIdForMeshName(name: string): ShelfSlotId | null {
  if (name.startsWith('shelf-board')) return 'shelves'
  if (name === 'shelf-back') return 'back'
  if (
    name.startsWith('shelf-side') ||
    name.startsWith('shelf-post') ||
    name.startsWith('shelf-divider') ||
    name.startsWith('shelf-bracket') ||
    name.startsWith('shelf-brace')
  ) {
    return 'frame'
  }
  return null
}

/** Which slots a given shelf actually exposes (depends on style/flags). */
export function shelfSlots(node: ShelfNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'shelves', label: 'Shelves', default: SHELF_SLOT_DEFAULT_COLOR },
  ]
  const hasFrame = !(node.style === 'wall-shelf' && node.bracketStyle === 'hidden')
  if (hasFrame) slots.push({ slotId: 'frame', label: 'Frame', default: SHELF_SLOT_DEFAULT_COLOR })
  const hasBack = node.style === 'cubby' || (node.style === 'bookshelf' && node.withBack)
  if (hasBack) slots.push({ slotId: 'back', label: 'Back', default: SHELF_SLOT_DEFAULT_COLOR })
  return slots
}
