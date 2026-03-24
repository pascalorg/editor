import type { AnyNodeId, BuildingNode, LevelNode } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

function getAdjacentLevelIdForDeletion(levelId: AnyNodeId): LevelNode['id'] | null {
  const { nodes } = useScene.getState()
  const level = nodes[levelId]
  if (!level || level.type !== 'level' || !level.parentId) return null

  const building = nodes[level.parentId as AnyNodeId]
  if (!building || building.type !== 'building') return null

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
