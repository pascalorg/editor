import {
  type AnyNode,
  type AnyNodeId,
  buildingGroundBox,
  type GroundBox,
  type LevelGradeStanding,
  levelGradeStanding,
  levelGroundBox,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'

type LevelDisplay = {
  hideLevelsAboveSelection: boolean
  selection: { levelId: string | null; buildingId?: string | null }
}

/**
 * The shown level's standing against the ground: the storeys above the selected level are
 * hidden and that level's floor lies under the ground — all of it, or the part of it a
 * hillside stands over — which is then veiled over it.
 */
export function gradeStandingShown(
  viewer: LevelDisplay,
  nodes: Record<AnyNodeId, AnyNode>,
): LevelGradeStanding {
  const { levelId } = viewer.selection
  if (!viewer.hideLevelsAboveSelection || levelId === null) return 'at-grade'
  return levelGradeStanding(nodes, levelId)
}

/** Whether the level shown lies below grade, on all of its footprint or part of it. */
export function belowGradeShown(viewer: LevelDisplay, nodes: Record<AnyNodeId, AnyNode>): boolean {
  return gradeStandingShown(viewer, nodes) !== 'at-grade'
}

/**
 * Keeps the viewer's `belowGrade` and `gradeStanding` on the shown level while the
 * selection, the level display and the scene change. The returned function stops, and the
 * ground stands solid again.
 */
export function followBelowGrade(): () => void {
  const update = () => {
    const gradeStanding = gradeStandingShown(useViewer.getState(), useScene.getState().nodes)
    const viewer = useViewer.getState()
    if (
      viewer.gradeStanding !== gradeStanding ||
      viewer.belowGrade !== (gradeStanding !== 'at-grade')
    )
      useViewer.setState({ gradeStanding, belowGrade: gradeStanding !== 'at-grade' })
  }
  update()
  // The flag itself is watched too: the other host's level display, handing over, resets it.
  const stopViewer = useViewer.subscribe((state, previous) => {
    if (
      state.selection.levelId !== previous.selection.levelId ||
      state.hideLevelsAboveSelection !== previous.hideLevelsAboveSelection ||
      state.belowGrade !== previous.belowGrade ||
      state.gradeStanding !== previous.gradeStanding
    )
      update()
  })
  const stopScene = useScene.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) update()
  })
  return () => {
    stopViewer()
    stopScene()
    useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' })
  }
}

/** A host's level display marks a level below grade as shown while `active`. */
export function useBelowGrade(active: boolean) {
  useEffect(() => (active ? followBelowGrade() : undefined), [active])
}

/**
 * The box the ground window opens for: the shown level while the editor's level display
 * hides what is above it, the whole building when it stands whole (Preview).
 */
export function groundWindowBoxShown(
  viewer: LevelDisplay,
  nodes: Record<AnyNodeId, AnyNode>,
): GroundBox | null {
  const { levelId, buildingId } = viewer.selection
  if (viewer.hideLevelsAboveSelection && levelId !== null) return levelGroundBox(nodes, levelId)
  return buildingGroundBox(nodes, buildingId ?? null)
}

function sameBox(a: GroundBox | null, b: GroundBox | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.min.every((value, axis) => value === b.min[axis]) &&
    a.max.every((value, axis) => value === b.max[axis])
  )
}

/**
 * Keeps the viewer's `groundWindowBox` on {@link groundWindowBoxShown} while the selection,
 * the level display and the scene change. The returned function stops, and the window closes.
 */
export function followGroundWindowBox(): () => void {
  const update = () => {
    const box = groundWindowBoxShown(useViewer.getState(), useScene.getState().nodes)
    if (!sameBox(useViewer.getState().groundWindowBox, box))
      useViewer.setState({ groundWindowBox: box })
  }
  update()
  const stopViewer = useViewer.subscribe((state, previous) => {
    if (
      state.selection.levelId !== previous.selection.levelId ||
      state.selection.buildingId !== previous.selection.buildingId ||
      state.hideLevelsAboveSelection !== previous.hideLevelsAboveSelection ||
      state.groundWindowBox !== previous.groundWindowBox
    )
      update()
  })
  const stopScene = useScene.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) update()
  })
  return () => {
    stopViewer()
    stopScene()
    useViewer.setState({ groundWindowBox: null })
  }
}

/** The ground window follows the shown level or building while `active` (not on the site). */
export function useGroundWindowBox(active: boolean) {
  useEffect(() => (active ? followGroundWindowBox() : undefined), [active])
}
