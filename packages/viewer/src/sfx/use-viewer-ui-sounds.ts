'use client'

import { useEffect } from 'react'
import type useViewer from '../store/use-viewer'
import { playSound, preloadSounds } from './player'

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

/** Play selection and hover cues after user activation, except during walkthrough. */
export function useViewerUiSounds() {
  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    preloadSounds()
    void import('../store/use-viewer').then(({ default: viewer }) => {
      if (disposed) return
      unsubscribe = viewer.subscribe((state, previous) => {
        if (state.walkthroughMode || !globalThis.navigator?.userActivation?.hasBeenActive) return
        if (state.selection !== previous.selection) {
          const cue = selectionCue(previous.selection, state.selection)
          if (cue) playSound(cue)
        }
        if (state.hoveredId && state.hoveredId !== previous.hoveredId && !state.cameraDragging)
          playSound('viewerHover')
      })
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])
}
