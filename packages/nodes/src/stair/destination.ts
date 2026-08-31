import type { AnyNode, StairNode } from '@pascal-app/core'

/**
 * Computes the stair patch for a destination ("To") switch.
 *
 * Attaching to a deck clears any explicit custom rise (the rise follows the
 * deck's elevation from now on) and disables the auto cutout — a deck stair
 * lands ON its destination slab, not through it. Switching a deck-attached
 * stair back to a level clears both again so the rise re-derives from the
 * storey height, and restores `slabOpeningMode: 'destination'` — the
 * placement default (the schema default is 'none', but the stair tool places
 * ordinary stairs with 'destination', so that is what a level-destination
 * stair regains). Plain level-to-level switches leave rise and opening mode
 * alone.
 */
export function getStairDestinationUpdates(
  stair: StairNode,
  target: AnyNode | undefined,
  targetId: string,
): Partial<StairNode> {
  if (target?.type === 'slab') {
    return { deckSlabId: targetId, totalRise: undefined, slabOpeningMode: 'none' }
  }
  const updates: Partial<StairNode> = { toLevelId: targetId, deckSlabId: undefined }
  if (stair.deckSlabId) {
    updates.totalRise = undefined
    updates.slabOpeningMode = 'destination'
  }
  return updates
}
