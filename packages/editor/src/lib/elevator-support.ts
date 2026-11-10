import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type ElevatorNode,
  type LevelNode,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'

function getBuildingLevels(
  buildingId: string | null | undefined,
  nodes: Readonly<Record<string, AnyNode>>,
): LevelNode[] {
  if (!buildingId) return []
  const building = nodes[buildingId as AnyNodeId]
  if (building?.type !== 'building') return []

  return building.children
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((entry): entry is LevelNode => entry?.type === 'level')
    .sort((left, right) => left.level - right.level)
}

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

export function resolveElevatorSupportLevelId({
  buildingId,
  preferredLevelId,
  nodes = useScene.getState().nodes,
}: {
  buildingId: string | null | undefined
  preferredLevelId?: string | null
  nodes?: Readonly<Record<string, AnyNode>>
}): LevelNode['id'] | null {
  const preferred = preferredLevelId ? nodes[preferredLevelId as AnyNodeId] : undefined
  const levels = getBuildingLevels(buildingId, nodes)
  const preferredInBuilding = preferredLevelId
    ? levels.find((level) => level.id === preferredLevelId)
    : undefined

  if (preferredInBuilding) return preferredInBuilding.id
  if (levels.length === 0) return preferred?.type === 'level' ? preferred.id : null

  return levels[0]?.id ?? null
}

export function resolveElevatorSupportY({
  buildingId,
  preferredLevelId,
  x,
  z,
  nodes,
}: {
  buildingId: string | null | undefined
  preferredLevelId?: string | null
  x: number
  z: number
  nodes?: Readonly<Record<string, AnyNode>>
}): number {
  const levelId = resolveElevatorSupportLevelId({ buildingId, preferredLevelId, nodes })
  if (!levelId) return 0

  return Math.max(0, spatialGridManager.getSlabElevationAt(levelId, x, z))
}

export function resolveElevatorNodeSupportY(
  node: ElevatorNode,
  position: [number, number, number] = node.position,
  nodes?: Readonly<Record<string, AnyNode>>,
): number {
  return resolveElevatorSupportY({
    buildingId: node.parentId,
    preferredLevelId: node.fromLevelId ?? node.defaultLevelId,
    x: position[0],
    z: position[2],
    nodes,
  })
}
