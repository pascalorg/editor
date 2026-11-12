import type { AnyNode, AnyNodeId, BuildingNode, LevelNode } from '@pascal-app/core'
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

function findBuildingAncestorId(
  nodeId: AnyNodeId,
  nodes: Record<string, AnyNode>,
): BuildingNode['id'] | null {
  let current: AnyNode | undefined = nodes[nodeId]
  for (let guard = 0; current && guard < 16; guard++) {
    if (current.type === 'building') return current.id
    current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
  }
  return null
}

/**
 * Selects a node a tool just made, on its own level when that is not the one in view: a roof drawn
 * over a storey's walls lands on the level above, which the editor hides while the storey is
 * selected, so selecting it there alone would leave it out of sight. A node parented to the
 * building itself (an elevator) has no level, so the floor in view stays active when it belongs
 * to that building.
 */
export function selectPlacedNode(nodeId: AnyNodeId) {
  const { nodes } = useScene.getState()
  const levelId = findLevelAncestorId(nodeId, nodes) as LevelNode['id'] | null
  const buildingId = findBuildingAncestorId(nodeId, nodes)
  const { selection, setSelection } = useViewer.getState()
  const updates: Partial<typeof selection> = { selectedIds: [nodeId] }
  if (buildingId && buildingId !== selection.buildingId) {
    updates.buildingId = buildingId
    updates.levelId =
      levelId ??
      (selection.levelId && findBuildingAncestorId(selection.levelId, nodes) === buildingId
        ? selection.levelId
        : null)
  } else if (levelId && levelId !== selection.levelId) {
    updates.levelId = levelId
  }
  setSelection(updates)
}
