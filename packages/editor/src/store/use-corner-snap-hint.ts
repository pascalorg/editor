import type { CornerBlockReason } from '@pascal-app/core'
import { create } from 'zustand'

/**
 * What the window being placed or dragged near a wall end says: `join` when a window already waits
 * on the other wall, `new` when one would be created, the reason when the end is not a corner a
 * window can wrap, null away from a wall end. The tools write it; the HUD reads it, so the hint is
 * there only inside the zone.
 */
export type CornerSnapHint = 'join' | 'new' | CornerBlockReason | null

export const useCornerSnapHint = create<{
  hint: CornerSnapHint
  setHint: (hint: CornerSnapHint) => void
}>((set) => ({
  hint: null,
  setHint: (hint) => set((state) => (state.hint === hint ? state : { hint })),
}))

/** One line each, in the HUD's voice: what is in the way, not what to do about it. */
export const CORNER_BLOCK_NOTES: Record<CornerBlockReason, string> = {
  free_end: 'No wall meets here',
  several_walls: 'Three or more walls meet here',
  angle: 'The walls meet at too sharp or too flat an angle',
  curved: 'A curved wall takes no corner window',
  curtain: 'A curtain wall takes no corner window',
  no_room: 'No room for the matching window on the other wall',
  in_the_way: 'Another opening is in the way at the corner',
  too_tall: 'The window waiting there is taller than this wall',
}

export type CornerHintRow = { keys: string[]; label: string }

/** The HUD rows for a hint, shared by the placement tool and the move HUD. */
export function cornerHintRows(hint: CornerSnapHint): CornerHintRow[] {
  if (!hint) return []
  if (hint === 'join' || hint === 'new')
    return [
      {
        keys: ['Left click'],
        label: hint === 'join' ? 'Join as a corner window' : 'Corner window',
      },
      { keys: ['Alt'], label: 'Place without the corner snap' },
    ]
  // The HUD's notice row, as for a placement that does not fit: a note, not a key to press.
  return [{ keys: ['!'], label: CORNER_BLOCK_NOTES[hint] }]
}
