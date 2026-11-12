import type { AnyNode, AnyNodeId, BuildingNode, LevelNode } from '@pascal-app/core'

export function resolveCurrentBuildingId({
  buildingId,
  levelId,
  nodes,
}: {
  buildingId: BuildingNode['id'] | null
  levelId: LevelNode['id'] | null
  nodes: Record<string, AnyNode>
}): BuildingNode['id'] | null {
  if (buildingId) return buildingId
  if (!levelId) return null

  const level = nodes[levelId as AnyNodeId]
  if (
    level?.type === 'level' &&
    level.parentId &&
    nodes[level.parentId as AnyNodeId]?.type === 'building'
  ) {
    return level.parentId as BuildingNode['id']
  }

  return null
}
