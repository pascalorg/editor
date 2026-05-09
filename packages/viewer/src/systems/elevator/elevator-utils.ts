import {
  resolveElevatorBuildingLevels,
  resolveElevatorServiceLevels,
  type AnyNode,
  type AnyNodeId,
  type ElevatorNode,
  type LevelNode,
} from '@pascal-app/core'
import { getLevelHeight } from '../level/level-utils'

export type ElevatorLevelEntry = {
  id: LevelNode['id']
  label: string
  baseY: number
}

export function resolveElevatorLevels(
  elevator: ElevatorNode,
  nodes: Record<AnyNodeId, AnyNode>,
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
    cumulativeY += getLevelHeight(level.id, nodes)
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
