import type { AnyNode, FloorOpeningNode } from '../schema'

export type FloorOpeningSurface = 'floor' | 'ceiling'
type Target = { levelId: string; surface: FloorOpeningSurface }
export type FloorOpeningIndex = {
  targets: Map<string, Target[]>
  surfaces: Map<string, FloorOpeningNode[]>
}

function levelOrder(nodes: Readonly<Record<string, AnyNode>>) {
  const buildings = new Map<string | null | undefined, Array<Extract<AnyNode, { type: 'level' }>>>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'level') continue
    const levels = buildings.get(node.parentId) ?? []
    levels.push(node)
    buildings.set(node.parentId, levels)
  }
  const neighbors = new Map<string, { below?: string; above?: string }>()
  for (const levels of buildings.values()) {
    levels.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))
    for (const [index, level] of levels.entries())
      neighbors.set(level.id, { below: levels[index - 1]?.id, above: levels[index + 1]?.id })
  }
  return neighbors
}

function targetsFor(
  nodes: Readonly<Record<string, AnyNode>>,
  opening: FloorOpeningNode,
  neighbors: Map<string, { below?: string; above?: string }>,
): Target[] {
  const levelId = opening.parentId
  if (!levelId || nodes[levelId]?.type !== 'level') return []
  if (opening.hostZoneId) {
    const host = nodes[opening.hostZoneId]
    return host?.type === 'zone' && host.parentId === levelId && host.floor?.support === 'open'
      ? [{ levelId, surface: 'floor' }]
      : []
  }
  const primary = opening.drawnOn
  const adjacent = neighbors.get(levelId)?.[primary === 'floor' ? 'below' : 'above']
  const targets: Target[] = [
    ...(opening.cutsPrimary ? [{ levelId, surface: primary }] : []),
    ...(opening.cutsAdjacent && adjacent
      ? [{ levelId: adjacent, surface: primary === 'floor' ? 'ceiling' : 'floor' } as Target]
      : []),
  ]
  for (const [surface, cuts] of [
    ['floor', opening.legacyPlateCuts],
    ['ceiling', opening.legacyCeilingCuts],
  ] as const)
    for (const surfaceId of Object.keys(cuts ?? {})) {
      const host = nodes[surfaceId]
      if (!host?.parentId || nodes[host.parentId]?.type !== 'level') continue
      if (!targets.some((target) => target.levelId === host.parentId && target.surface === surface))
        targets.push({ levelId: host.parentId, surface })
    }
  return targets
}

export function createFloorOpeningIndex(
  nodes: Readonly<Record<string, AnyNode>>,
): FloorOpeningIndex {
  const neighbors = levelOrder(nodes)
  const targets = new Map<string, Target[]>()
  const surfaces = new Map<string, FloorOpeningNode[]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'floor-opening') continue
    if (
      (node.source === 'stair' || node.source === 'elevator') &&
      node.ownerId &&
      nodes[node.ownerId]?.type !== node.source
    )
      continue
    const resolved = targetsFor(nodes, node, neighbors)
    targets.set(node.id, resolved)
    for (const target of resolved) {
      const key = `${target.levelId}:${target.surface}`
      const openings = surfaces.get(key) ?? []
      openings.push(node)
      surfaces.set(key, openings)
    }
  }
  for (const openings of surfaces.values()) openings.sort((a, b) => a.id.localeCompare(b.id))
  return { targets, surfaces }
}

export function adjacentLevelId(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
  direction: -1 | 1,
): string | undefined {
  const neighbor = levelOrder(nodes).get(levelId)
  return direction < 0 ? neighbor?.below : neighbor?.above
}

export function floorOpeningTargets(
  nodes: Readonly<Record<string, AnyNode>>,
  opening: FloorOpeningNode,
  index?: FloorOpeningIndex,
): Target[] {
  return index?.targets.get(opening.id) ?? targetsFor(nodes, opening, levelOrder(nodes))
}

export function openingsForSurface(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
  surface: FloorOpeningSurface,
  index?: FloorOpeningIndex,
): FloorOpeningNode[] {
  return (index ?? createFloorOpeningIndex(nodes)).surfaces.get(`${levelId}:${surface}`) ?? []
}
