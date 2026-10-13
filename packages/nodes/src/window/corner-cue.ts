import type { CornerBlock, CornerSnap } from '@pascal-app/core'
import { getActiveSnapContext, getActiveSnappingMode, useCornerSnapHint } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

// What a window placed or dragged near a corner shows: the HUD hint says what a click will do, and
// the window already waiting on the other wall is outlined in the editor's hover colour, so the
// join is visible before it happens. Where a wall end is not a corner a window can wrap, the HUD
// says why instead of showing nothing.

let outlined: string | null = null

/** Show the cue for `snap`, or clear it when null: away from a corner, a new tool, a cancel. */
export function showCornerCue(snap: CornerSnap | null, block: CornerBlock | null = null) {
  useCornerSnapHint
    .getState()
    .setHint(snap ? (snap.waitingId ? 'join' : 'new') : (block?.reason ?? null))
  const next = snap?.waitingId ?? null
  if (next === outlined) return
  const viewer = useViewer.getState()
  // Only what this cue outlined is ever cleared: a hover that is something else's stays.
  if (next === null) {
    if (viewer.hoveredId === outlined) viewer.setHoveredId(null)
  } else {
    viewer.setHoveredId(next as never)
  }
  outlined = next
}

/**
 * Whether the person turned snapping off for what they are doing (no context, no choice made):
 * the corner snap is a snap, and goes with it.
 */
export const snappingTurnedOff = () =>
  getActiveSnapContext() !== null && getActiveSnappingMode() === 'off'
