import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  type LevelNode as LevelNodeType,
  resolveBuildingForLevel,
  type StairNode,
} from '@pascal-app/core'

function sortLevelsByHeight(levels: LevelNodeType[]) {
  return [...levels].sort((left, right) => left.level - right.level)
}

function isLevelNode(node: AnyNode | undefined): node is LevelNodeType {
  return node?.type === 'level'
}

function getAllSceneLevels(nodes: Record<string, AnyNode>) {
  return sortLevelsByHeight(
    Object.values(nodes).filter((entry): entry is LevelNodeType => entry?.type === 'level'),
  )
}

function getBuildingLevels(
  nodes: Record<string, AnyNode>,
  buildingId: AnyNodeId | string | null | undefined,
  source?: LevelNodeType,
) {
  if (!buildingId) return source ? [source] : []
  const building = nodes[buildingId as AnyNodeId]
  if (building?.type !== 'building') return source ? [source] : []

  const levels = new Map<string, LevelNodeType>()
  if (source) levels.set(source.id, source)

  for (const childId of building.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (isLevelNode(child)) levels.set(child.id, child)
  }

  for (const candidate of Object.values(nodes)) {
    if (isLevelNode(candidate) && candidate.parentId === building.id) {
      levels.set(candidate.id, candidate)
    }
  }

  return sortLevelsByHeight(Array.from(levels.values()))
}

export function getBuildingLevelsForLevel(
  nodes: Record<string, AnyNode>,
  levelId: AnyNodeId | string | null | undefined,
) {
  if (!levelId) return []
  const source = nodes[levelId as AnyNodeId]
  if (!isLevelNode(source)) return []

  const buildingId = resolveBuildingForLevel(
    source.id as AnyNodeId,
    nodes as Record<AnyNodeId, AnyNode>,
  )
  return getBuildingLevels(nodes, buildingId, source)
}

export function getStairLevelOptions(nodes: Record<string, AnyNode>, stair: StairNode) {
  for (const candidateId of [stair.fromLevelId, stair.parentId, stair.toLevelId]) {
    if (isLevelNode(nodes[candidateId as AnyNodeId])) {
      return getBuildingLevelsForLevel(nodes, candidateId)
    }
  }

  return getAllSceneLevels(nodes)
}

export function resolveStairPlacementLevelId(
  nodes: Record<string, AnyNode>,
  preferredLevelId: AnyNodeId | string | null | undefined,
  preferredBuildingId?: AnyNodeId | string | null,
) {
  if (isLevelNode(nodes[preferredLevelId as AnyNodeId])) {
    return preferredLevelId as LevelNodeType['id']
  }

  const buildingLevels = getBuildingLevels(nodes, preferredBuildingId)
  return buildingLevels[0]?.id ?? getAllSceneLevels(nodes)[0]?.id ?? null
}

export function resolveStairFromLevelId(
  nodes: Record<string, AnyNode>,
  stair: StairNode,
  levels = getStairLevelOptions(nodes, stair),
) {
  const optionIds = new Set<string>(levels.map((level) => level.id))
  if (stair.fromLevelId && optionIds.has(stair.fromLevelId)) return stair.fromLevelId
  if (stair.parentId && optionIds.has(stair.parentId)) return stair.parentId

  const toLevel = stair.toLevelId ? nodes[stair.toLevelId as AnyNodeId] : undefined
  if (isLevelNode(toLevel)) {
    const lowerLevel = [...levels].reverse().find((level) => level.level < toLevel.level)
    if (lowerLevel) return lowerLevel.id
  }

  return levels[0]?.id ?? null
}

export function resolveStairToLevelId(
  nodes: Record<string, AnyNode>,
  stair: StairNode,
  fromLevelId: AnyNodeId | string | null | undefined,
  levels = getStairLevelOptions(nodes, stair),
) {
  const optionIds = new Set<string>(levels.map((level) => level.id))
  if (stair.toLevelId && stair.toLevelId !== fromLevelId && optionIds.has(stair.toLevelId)) {
    return stair.toLevelId
  }

  const fromLevel = fromLevelId ? nodes[fromLevelId as AnyNodeId] : undefined
  if (isLevelNode(fromLevel)) {
    return levels.find((level) => level.level > fromLevel.level)?.id ?? fromLevel.id
  }

  return levels[0]?.id ?? null
}

export function resolveStairDestinationLevel({
  createMissing,
  fromLevelId,
  nodes,
}: {
  createMissing?: boolean
  fromLevelId: AnyNodeId | string | null | undefined
  nodes: Record<string, AnyNode>
}) {
  if (!fromLevelId) return null
  const fromLevel = nodes[fromLevelId as AnyNodeId]
  if (!isLevelNode(fromLevel)) return null

  const buildingId = resolveBuildingForLevel(
    fromLevel.id as AnyNodeId,
    nodes as Record<AnyNodeId, AnyNode>,
  )
  const levels = getBuildingLevelsForLevel(nodes, fromLevel.id)
  const nextExistingLevel = levels.find((level) => level.level > fromLevel.level) ?? null
  if (nextExistingLevel) {
    return {
      buildingId,
      createdLevel: null,
      fromLevel,
      levels,
      toLevel: nextExistingLevel,
    }
  }

  if (createMissing && buildingId) {
    const createdLevel = LevelNode.parse({
      children: [],
      level: fromLevel.level + 1,
      parentId: buildingId,
    })

    return {
      buildingId,
      createdLevel,
      fromLevel,
      levels: sortLevelsByHeight([...levels, createdLevel]),
      toLevel: createdLevel,
    }
  }

  return {
    buildingId,
    createdLevel: null,
    fromLevel,
    levels,
    toLevel: fromLevel,
  }
}
