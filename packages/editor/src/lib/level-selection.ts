import type { AnyNodeId, BuildingNode, LevelNode } from '@pascal-app/core'
import { findLevelAncestorId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

function getAdjacentLevelIdForDeletion(levelId: AnyNodeId): LevelNode['id'] | null {
  const { nodes } = useScene.getState()
  const level = nodes[levelId]
  if (level?.type !== 'level' || !level.parentId) return null

  const building = nodes[level.parentId as AnyNodeId]
  if (building?.type !== 'building') return null

  const siblingLevelIds = (building as BuildingNode).children.filter(
    (childId): childId is LevelNode['id'] => nodes[childId as AnyNodeId]?.type === 'level',
  )
  const currentIndex = siblingLevelIds.indexOf(level.id)
  if (currentIndex === -1) return null

  return siblingLevelIds[currentIndex - 1] ?? siblingLevelIds[currentIndex + 1] ?? null
}

export function deleteLevelWithFallbackSelection(levelId: AnyNodeId) {
  const isSelectedLevel = useViewer.getState().selection.levelId === levelId
  const nextLevelId = getAdjacentLevelIdForDeletion(levelId)

  useScene.getState().deleteNode(levelId)

  if (isSelectedLevel) {
    useViewer.getState().setSelection({ levelId: nextLevelId })
  }
}

/**
 * Selects a node a tool just made, on its own level when that is not the one in view: a roof drawn
 * over a storey's walls lands on the level above, which the editor hides while the storey is
 * selected, so selecting it there alone would leave it out of sight.
 */
export function selectPlacedNode(nodeId: AnyNodeId) {
  const levelId = findLevelAncestorId(nodeId, useScene.getState().nodes)
  const { selection, setSelection } = useViewer.getState()
  setSelection(
    levelId && levelId !== selection.levelId
      ? { levelId: levelId as LevelNode['id'], selectedIds: [nodeId] }
      : { selectedIds: [nodeId] },
  )
}
