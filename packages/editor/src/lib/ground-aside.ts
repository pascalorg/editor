import { type AnyNode, type AnyNodeId, isLevelBelowGrade, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'

/**
 * Whether the site's ground steps aside: the storeys above the selected level are hidden and that
 * level lies below grade, so the ground would lie over its floor.
 */
export function groundAsideFor(
  viewer: { hideLevelsAboveSelection: boolean; selection: { levelId: string | null } },
  nodes: Record<AnyNodeId, AnyNode>,
): boolean {
  const { levelId } = viewer.selection
  return viewer.hideLevelsAboveSelection && levelId !== null && isLevelBelowGrade(nodes, levelId)
}

/**
 * Keeps the viewer's `groundAside` on {@link groundAsideFor} while the selection, the level display
 * and the scene change. The returned function stops and stands the ground back.
 */
export function followGroundAside(): () => void {
  const update = () => {
    const aside = groundAsideFor(useViewer.getState(), useScene.getState().nodes)
    if (useViewer.getState().groundAside !== aside) useViewer.setState({ groundAside: aside })
  }
  update()
  // The flag itself is watched too: the other host's level display, handing over, resets it.
  const stopViewer = useViewer.subscribe((state, previous) => {
    if (
      state.selection.levelId !== previous.selection.levelId ||
      state.hideLevelsAboveSelection !== previous.hideLevelsAboveSelection ||
      state.groundAside !== previous.groundAside
    )
      update()
  })
  const stopScene = useScene.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) update()
  })
  return () => {
    stopViewer()
    stopScene()
    useViewer.setState({ groundAside: false })
  }
}

/** The ground steps aside under a level below grade while `active`: a host's level display. */
export function useGroundAside(active: boolean) {
  useEffect(() => (active ? followGroundAside() : undefined), [active])
}
