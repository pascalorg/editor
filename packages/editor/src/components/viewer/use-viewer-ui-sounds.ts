'use client'

import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { playSFX } from '../../lib/sfx-player'

type Selection = ReturnType<typeof useViewer.getState>['selection']

/** Which tick a selection change plays: anything newly picked selects, anything let go deselects. */
export function selectionCue(
  previous: Selection,
  next: Selection,
): 'viewerSelect' | 'viewerDeselect' | null {
  const picked =
    (next.levelId && next.levelId !== previous.levelId) ||
    (next.zoneId && next.zoneId !== previous.zoneId) ||
    next.selectedIds.some((id) => !previous.selectedIds.includes(id))
  if (picked) return 'viewerSelect'
  const released =
    (previous.levelId && !next.levelId) ||
    (previous.zoneId && !next.zoneId) ||
    previous.selectedIds.some((id) => !next.selectedIds.includes(id))
  return released ? 'viewerDeselect' : null
}

/**
 * The viewer's pointer ticks, as on the marketing house: a faint one when the
 * pointer finds something new, one on select and a softer one on deselect.
 * Silent in walkthrough, and until the person has interacted with the page, so
 * loading a scene with a default selection makes no sound.
 */
export function useViewerUiSounds() {
  useEffect(
    () =>
      useViewer.subscribe((state, previous) => {
        if (state.walkthroughMode || !navigator.userActivation?.hasBeenActive) return
        if (state.selection !== previous.selection) {
          const cue = selectionCue(previous.selection, state.selection)
          if (cue) playSFX(cue)
        }
        if (state.hoveredId && state.hoveredId !== previous.hoveredId && !state.cameraDragging)
          playSFX('viewerHover')
      }),
    [],
  )
}
