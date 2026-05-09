import type { AnyNode, AnyNodeId, ElevatorNode, LevelNode } from '../../schema'

function getBuildingLevels(elevator: ElevatorNode, nodes: Record<string, AnyNode>): LevelNode[] {
  const building =
    elevator.parentId && nodes[elevator.parentId as AnyNodeId]?.type === 'building'
      ? nodes[elevator.parentId as AnyNodeId]
      : null

  if (building?.type !== 'building') return []

  return building.children
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((node): node is LevelNode => node?.type === 'level')
    .sort((left, right) => left.level - right.level)
}

function findLevelIndex(levels: LevelNode[], levelId: string | null | undefined) {
  if (!levelId) return -1
  return levels.findIndex((level) => level.id === levelId)
}

function getDefaultToIndex(levels: LevelNode[], fromIndex: number) {
  if (levels.length === 0) return -1
  if (fromIndex < 0) return Math.min(1, levels.length - 1)
  return Math.min(fromIndex + 1, levels.length - 1)
}

export function resolveElevatorBuildingLevels(
  elevator: ElevatorNode,
  nodes: Record<string, AnyNode>,
): LevelNode[] {
  return getBuildingLevels(elevator, nodes)
}

export function resolveElevatorServiceLevelIds(
  elevator: ElevatorNode,
  nodes: Record<string, AnyNode>,
): string[] {
  return resolveElevatorServiceLevels(elevator, nodes).map((level) => level.id)
}

export function resolveElevatorServiceLevels(
  elevator: ElevatorNode,
  nodes: Record<string, AnyNode>,
): LevelNode[] {
  const levels = getBuildingLevels(elevator, nodes)
  if (levels.length === 0) return []

  const hasServiceBounds = Boolean(elevator.fromLevelId || elevator.toLevelId)
  let legacyServedLevels: LevelNode[] = []
  if (!hasServiceBounds && elevator.servedLevelIds && elevator.servedLevelIds.length > 0) {
    const servedIds = new Set(elevator.servedLevelIds)
    legacyServedLevels = levels.filter((level) => servedIds.has(level.id))
  }

  const legacyFromLevelId = legacyServedLevels[0]?.id ?? null
  const legacyToLevelId = legacyServedLevels[legacyServedLevels.length - 1]?.id ?? null
  const explicitFromIndex = findLevelIndex(levels, elevator.fromLevelId ?? legacyFromLevelId)
  const defaultFromIndex = findLevelIndex(levels, elevator.defaultLevelId)
  const fromIndex = explicitFromIndex >= 0 ? explicitFromIndex : Math.max(defaultFromIndex, 0)
  const toIndex = findLevelIndex(levels, elevator.toLevelId ?? legacyToLevelId)
  const resolvedToIndex = toIndex >= 0 ? toIndex : getDefaultToIndex(levels, fromIndex)
  const minIndex = Math.min(fromIndex, resolvedToIndex)
  const maxIndex = Math.max(fromIndex, resolvedToIndex)

  return levels.slice(minIndex, maxIndex + 1)
}
