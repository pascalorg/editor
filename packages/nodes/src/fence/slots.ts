import type { SlotDeclaration } from '@pascal-app/core'
import type { FenceNode } from './schema'

// Slots map 1:1 to the fence panel's build options: the end posts, the infill
// slats (the showInfill toggle), the base kickboard, and the top rail.
export type FenceSlotId = 'posts' | 'infill' | 'base' | 'rail'

export const FENCE_POSTS_SLOT_DEFAULT = 'library:preset-charcoal'
export const FENCE_INFILL_SLOT_DEFAULT = 'library:preset-charcoal'
export const FENCE_BASE_SLOT_DEFAULT = 'library:preset-greige'
export const FENCE_RAIL_SLOT_DEFAULT = 'library:preset-greige'

export const FENCE_SLOT_DEFAULTS: Record<FenceSlotId, string> = {
  posts: FENCE_POSTS_SLOT_DEFAULT,
  infill: FENCE_INFILL_SLOT_DEFAULT,
  base: FENCE_BASE_SLOT_DEFAULT,
  rail: FENCE_RAIL_SLOT_DEFAULT,
}

export function fenceSlots(node: FenceNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'posts', label: 'Posts', default: FENCE_POSTS_SLOT_DEFAULT },
  ]
  if (node.showInfill !== false) {
    slots.push({ slotId: 'infill', label: 'Infill', default: FENCE_INFILL_SLOT_DEFAULT })
  }
  if (node.baseStyle !== 'floating') {
    slots.push({ slotId: 'base', label: 'Base', default: FENCE_BASE_SLOT_DEFAULT })
  }
  slots.push({ slotId: 'rail', label: 'Rail', default: FENCE_RAIL_SLOT_DEFAULT })
  return slots
}
