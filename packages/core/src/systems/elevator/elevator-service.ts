import type {
  AnyNode,
  AnyNodeId,
  CeilingNode,
  ElevatorNode,
  LevelNode,
  WallNode,
} from '../../schema'

export const DEFAULT_ELEVATOR_LEVEL_HEIGHT = 2.5

export type ElevatorLevelEntry = {
  id: LevelNode['id']
  label: string
  baseY: number
}

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

export function getElevatorLevelHeight(levelId: string, nodes: Record<string, AnyNode>): number {
  const level = nodes[levelId as AnyNodeId] as LevelNode | undefined
  if (level?.type !== 'level') return DEFAULT_ELEVATOR_LEVEL_HEIGHT

  let maxTop = 0

  for (const childId of level.children) {
    const child = nodes[childId as AnyNodeId]
    if (!child) continue

    if (child.type === 'ceiling') {
      const height = (child as CeilingNode).height ?? DEFAULT_ELEVATOR_LEVEL_HEIGHT
      if (height > maxTop) maxTop = height
    } else if (child.type === 'wall') {
      const height = (child as WallNode).height ?? DEFAULT_ELEVATOR_LEVEL_HEIGHT
      if (height > maxTop) maxTop = height
    }
  }

  return maxTop > 0 ? maxTop : DEFAULT_ELEVATOR_LEVEL_HEIGHT
}

export function resolveElevatorLevels(
  elevator: ElevatorNode,
  nodes: Record<string, AnyNode>,
): {
  entries: ElevatorLevelEntry[]
  defaultEntry: ElevatorLevelEntry | null
  shaftBaseY: number
  shaftTopY: number
  totalHeight: number
} {
  const allLevels = resolveElevatorBuildingLevels(elevator, nodes)

  const baseYByLevelId = new Map<string, number>()
  let cumulativeY = 0
  for (const level of allLevels) {
    baseYByLevelId.set(level.id, cumulativeY)
    cumulativeY += getElevatorLevelHeight(level.id, nodes)
  }

  const serviceLevels = resolveElevatorServiceLevels(elevator, nodes)
  const entries = serviceLevels.map((level) => ({
    id: level.id,
    label: String(level.level),
    baseY: baseYByLevelId.get(level.id) ?? 0,
  }))

  const defaultEntry =
    entries.find((entry) => entry.id === elevator.defaultLevelId) ??
    entries.find((entry) => entry.id === elevator.fromLevelId) ??
    entries[0] ??
    null
  const firstServedLevel = serviceLevels[0] ?? null
  const lastServedLevel = serviceLevels[serviceLevels.length - 1] ?? null
  const shaftBaseY = firstServedLevel ? (baseYByLevelId.get(firstServedLevel.id) ?? 0) : 0
  const lastServedIndex = lastServedLevel
    ? allLevels.findIndex((level) => level.id === lastServedLevel.id)
    : -1
  const nextLevel = lastServedIndex >= 0 ? allLevels[lastServedIndex + 1] : null
  const shaftTopY = nextLevel
    ? (baseYByLevelId.get(nextLevel.id) ?? cumulativeY)
    : lastServedLevel
      ? cumulativeY
      : elevator.cabHeight + 0.3

  return {
    entries,
    defaultEntry,
    shaftBaseY,
    shaftTopY,
    totalHeight: Math.max(shaftTopY - shaftBaseY, elevator.cabHeight + 0.3),
  }
}
