import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import type { CaptureMode } from '../store/use-editor'

/**
 * Whether the editor shows every level. Preview and the walkthrough show the
 * whole building; a scene capture shows what its level picker says (the
 * whole building, or a level and the ones below it). A preset capture frames
 * its isolated item and keeps the editing rule.
 */
export function showsWholeBuilding(state: {
  isPreviewMode: boolean
  isFirstPersonMode: boolean
  captureMode: CaptureMode
  captureLevelId: string | null
}): boolean {
  if (state.captureMode.mode === 'standard') return state.captureLevelId === null
  return state.isPreviewMode || state.isFirstPersonMode
}

/**
 * The editor's one level display: stacked, with every level above the
 * selected one hidden — the selected level and the ones below stay, so the
 * storey being worked on is never covered. There is no Stack / Exploded /
 * Solo choice while editing; a mode left over from the viewer (or persisted
 * by an older build) is set back to stacked, and kept there.
 *
 * The walkthrough shows the whole building, so the upper levels come back
 * while it is on; Preview hands the display to the viewer's own floor rule
 * (`useViewerFloorDisplay`).
 */
export function useEditorLevelDisplay(showWholeBuilding: boolean) {
  useEffect(() => {
    if (showWholeBuilding) return
    const keepStacked = (mode: string) => {
      if (mode !== 'stacked') useViewer.getState().setLevelMode('stacked')
    }
    useViewer.setState({ hideLevelsAboveSelection: true })
    keepStacked(useViewer.getState().levelMode)
    const unsubscribe = useViewer.subscribe((state, previous) => {
      if (state.levelMode !== previous.levelMode) keepStacked(state.levelMode)
    })
    return () => {
      unsubscribe()
      useViewer.setState({ hideLevelsAboveSelection: false })
    }
  }, [showWholeBuilding])
}
