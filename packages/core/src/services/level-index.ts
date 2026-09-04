import type { AnyNode, AnyNodeId, LevelNode } from '../schema'

export type LevelIndex = {
  /**
   * Levels grouped by owning building id, each group sorted by ordinal
   * ascending. Keyed `null` for levels with no resolvable building (the
   * legacy stack `getLevelElevations` also recognises).
   */
  levelsByBuilding: ReadonlyMap<string | null, readonly LevelNode[]>
  /** Owning building id per level id — same resolution as `resolveBuildingForLevel`. */
  buildingOfLevel: ReadonlyMap<string, string | null>
  /**
   * Level id per direct child id, from the levels' own `children` arrays.
   * First claim wins in node-iteration order, matching what a linear
   * `Object.values(nodes).find(…children.includes(id))` returned.
   */
  levelOfChild: ReadonlyMap<string, string>
}

// Identity-keyed memo, same contract as `getLevelElevations`: the nodes record
// is an immutable store slice, so object identity means "scene unchanged".
// Weakly keyed so a closed project's graph is not pinned by the memo.
const indexMemo = new WeakMap<object, LevelIndex>()

/**
 * One linear pass over the scene answering "which levels does this building
 * have" and "which level owns this child" — the two questions the stair
 * opening/rise sync used to answer by rescanning every node per stair per
 * surface. In a 4 900-node scene with 93 slabs and 13 stairs that rescan was
 * the entire visible cost of adding a level (~2.6 s); against the index the
 * same pass is a map lookup.
 *
 * Building resolution matches `resolveBuildingForLevel`: a `parentId`
 * pointing at a building wins; a level only listed in some building's
 * `children` resolves through that membership; otherwise `null`.
 */
export function getLevelIndex(nodes: Record<AnyNodeId, AnyNode>): LevelIndex {
  const memoized = indexMemo.get(nodes)
  if (memoized) return memoized

  const levels: LevelNode[] = []
  const membership = new Map<string, string>()
  for (const node of Object.values(nodes)) {
    if (node?.type === 'level') {
      levels.push(node as LevelNode)
      continue
    }
    if (node?.type !== 'building') continue
    for (const childId of node.children ?? []) {
      if (!membership.has(childId)) membership.set(childId, node.id)
    }
  }

  const levelsByBuilding = new Map<string | null, LevelNode[]>()
  const buildingOfLevel = new Map<string, string | null>()
  const levelOfChild = new Map<string, string>()

  for (const level of levels) {
    const directParent = level.parentId ? nodes[level.parentId as AnyNodeId] : undefined
    const buildingId =
      directParent?.type === 'building' ? directParent.id : (membership.get(level.id) ?? null)
    buildingOfLevel.set(level.id, buildingId)
    const group = levelsByBuilding.get(buildingId)
    if (group) group.push(level)
    else levelsByBuilding.set(buildingId, [level])

    for (const childId of level.children ?? []) {
      if (!levelOfChild.has(childId)) levelOfChild.set(childId, level.id)
    }
  }

  for (const group of levelsByBuilding.values()) {
    group.sort((left, right) => left.level - right.level)
  }

  const index: LevelIndex = { levelsByBuilding, buildingOfLevel, levelOfChild }
  indexMemo.set(nodes, index)
  return index
}
