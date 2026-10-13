import { type AnyNode, type AnyNodeId, isLevelBelowGrade, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'

/**
 * Whether the level shown lies below grade: the storeys above the selected level are hidden and
 * that level's floor lies under the ground, which is then veiled over it.
 */
export function belowGradeShown(
  viewer: { hideLevelsAboveSelection: boolean; selection: { levelId: string | null } },
  nodes: Record<AnyNodeId, AnyNode>,
): boolean {
  const { levelId } = viewer.selection
  return viewer.hideLevelsAboveSelection && levelId !== null && isLevelBelowGrade(nodes, levelId)
}

/**
 * Keeps the viewer's `belowGrade` on {@link belowGradeShown} while the selection, the level display
 * and the scene change. The returned function stops, and the ground stands solid again.
 */
export function followBelowGrade(): () => void {
  const update = () => {
    const belowGrade = belowGradeShown(useViewer.getState(), useScene.getState().nodes)
    if (useViewer.getState().belowGrade !== belowGrade) useViewer.setState({ belowGrade })
  }
  update()
  // The flag itself is watched too: the other host's level display, handing over, resets it.
  const stopViewer = useViewer.subscribe((state, previous) => {
    if (
      state.selection.levelId !== previous.selection.levelId ||
      state.hideLevelsAboveSelection !== previous.hideLevelsAboveSelection ||
      state.belowGrade !== previous.belowGrade
    )
      update()
  })
  const stopScene = useScene.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) update()
  })
  return () => {
    stopViewer()
    stopScene()
    useViewer.setState({ belowGrade: false })
  }
}

/** A host's level display marks a level below grade as shown while `active`. */
export function useBelowGrade(active: boolean) {
  useEffect(() => (active ? followBelowGrade() : undefined), [active])
}
