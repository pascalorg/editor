import { type AnyNodeId, foundationViewHiddenIds, useScene } from '@pascal-app/core'
import useViewer from '../store/use-viewer'

/** The building the foundation view is of: the selection's, else the selected level's. */
export function foundationViewBuildingId(): string | null {
  const { buildingId, levelId } = useViewer.getState().selection
  if (buildingId) return buildingId
  const level = levelId ? useScene.getState().nodes[levelId as AnyNodeId] : undefined
  return level?.type === 'level' ? (level.parentId ?? null) : null
}

const hiddenSets = new WeakMap<readonly string[], ReadonlySet<string>>()

/**
 * Whether the foundation view hides `nodeId` (`foundationViewHiddenIds`: the house over its
 * foundation). A hidden node takes no pointer, so a click goes through to the concrete and the
 * footings under it. The walkthrough shows the finished house: the view hides nothing there.
 */
export function hiddenByFoundationView(nodeId: string): boolean {
  const viewer = useViewer.getState()
  if (!viewer.foundationView || viewer.walkthroughMode) return false
  const buildingId = foundationViewBuildingId()
  if (!buildingId) return false
  const ids = foundationViewHiddenIds(useScene.getState().nodes, buildingId)
  let hidden = hiddenSets.get(ids)
  if (!hidden) {
    hidden = new Set(ids)
    hiddenSets.set(ids, hidden)
  }
  return hidden.has(nodeId)
}
