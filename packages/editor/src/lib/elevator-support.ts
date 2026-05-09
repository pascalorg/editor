import {
  type AnyNode,
  type AnyNodeId,
  type ElevatorNode,
  type LevelNode,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'

function getBuildingLevels(
  buildingId: string | null | undefined,
  nodes: Record<string, AnyNode>,
): LevelNode[] {
  if (!buildingId) return []
  const building = nodes[buildingId as AnyNodeId]
  if (building?.type !== 'building') return []

  return building.children
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((entry): entry is LevelNode => entry?.type === 'level')
    .sort((left, right) => left.level - right.level)
}

export function resolveElevatorSupportLevelId({
  buildingId,
  preferredLevelId,
}: {
  buildingId: string | null | undefined
  preferredLevelId?: string | null
}): LevelNode['id'] | null {
  const nodes = useScene.getState().nodes
  const levels = getBuildingLevels(buildingId, nodes)
  if (levels.length === 0) return null

  const preferred = preferredLevelId
    ? levels.find((level) => level.id === preferredLevelId)
    : undefined
  return preferred?.id ?? levels[0]?.id ?? null
}

export function resolveElevatorSupportY({
  buildingId,
  preferredLevelId,
  x,
  z,
}: {
  buildingId: string | null | undefined
  preferredLevelId?: string | null
  x: number
  z: number
}): number {
  const levelId = resolveElevatorSupportLevelId({ buildingId, preferredLevelId })
  if (!levelId) return 0

  return Math.max(0, spatialGridManager.getSlabElevationAt(levelId, x, z))
}

export function resolveElevatorNodeSupportY(
  node: ElevatorNode,
  position: [number, number, number] = node.position,
): number {
  return resolveElevatorSupportY({
    buildingId: node.parentId,
    preferredLevelId: node.fromLevelId ?? node.defaultLevelId,
    x: position[0],
    z: position[2],
  })
}
