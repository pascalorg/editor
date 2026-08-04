import type { AnyNode, AnyNodeId, ElevatorNode, LevelNode } from '../../schema'
import { getLevelElevations } from '../../services/storey'

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
  const levelElevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)

  const serviceLevels = resolveElevatorServiceLevels(elevator, nodes)
  const entries = serviceLevels.map((level) => ({
    id: level.id,
    label: String(level.level),
    baseY: levelElevations.get(level.id)?.baseY ?? 0,
  }))

  const defaultEntry =
    entries.find((entry) => entry.id === elevator.defaultLevelId) ??
    entries.find((entry) => entry.id === elevator.fromLevelId) ??
    entries[0] ??
    null
  const firstServedLevel = serviceLevels[0] ?? null
  const lastServedLevel = serviceLevels[serviceLevels.length - 1] ?? null
  const shaftBaseY = firstServedLevel ? (levelElevations.get(firstServedLevel.id)?.baseY ?? 0) : 0
  const lastServedIndex = lastServedLevel
    ? allLevels.findIndex((level) => level.id === lastServedLevel.id)
    : -1
  const nextLevel = lastServedIndex >= 0 ? allLevels[lastServedIndex + 1] : null
  // Highest ceiling in the stack, not the topmost level's: a negative
  // baseElevation on the top level can put its ceiling below the level
  // beneath it, and a shaft top under a served level would clip the cab.
  let stackTopY = 0
  for (const level of allLevels) {
    const elevation = levelElevations.get(level.id)
    if (!elevation) continue
    stackTopY = Math.max(stackTopY, elevation.baseY + elevation.height)
  }
  const shaftTopY = nextLevel
    ? (levelElevations.get(nextLevel.id)?.baseY ?? stackTopY)
    : lastServedLevel
      ? stackTopY
      : elevator.cabHeight + 0.3

  return {
    entries,
    defaultEntry,
    shaftBaseY,
    shaftTopY,
    totalHeight: Math.max(shaftTopY - shaftBaseY, elevator.cabHeight + 0.3),
  }
}
