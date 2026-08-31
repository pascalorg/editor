import {
  type AnyNode,
  getRenderableSlabPolygon,
  type SlabNode,
  type SlabPolygonContext,
  type WallNode,
} from '@pascal-app/core'

export function getRecessedSlabGroundHoles(
  nodes: Record<string, AnyNode>,
): Array<Array<[number, number]>> {
  const nodeList = Object.values(nodes)
  const levelIndexById = new Map<string, number>()
  const wallsByLevel = new Map<string | null, WallNode[]>()
  const slabsByLevel = new Map<string | null, SlabNode[]>()
  let lowestLevelIndex = Number.POSITIVE_INFINITY

  const pushByLevel = <T>(map: Map<string | null, T[]>, levelId: string | null, node: T) => {
    const entries = map.get(levelId)
    if (entries) entries.push(node)
    else map.set(levelId, [node])
  }

  for (const node of nodeList) {
    if (node.type === 'level') {
      levelIndexById.set(node.id, node.level)
      lowestLevelIndex = Math.min(lowestLevelIndex, node.level)
      continue
    }

    const levelId = node.parentId ?? null
    if (node.type === 'wall') pushByLevel(wallsByLevel, levelId, node)
    else if (node.type === 'slab') pushByLevel(slabsByLevel, levelId, node)
  }

  return nodeList
    .filter(
      (node): node is SlabNode =>
        node.type === 'slab' && node.visible && node.polygon.length >= 3 && node.recessed === true,
    )
    .filter((slab) => {
      if (!Number.isFinite(lowestLevelIndex)) return true
      const parentLevel = slab.parentId ? levelIndexById.get(slab.parentId) : undefined
      return parentLevel === lowestLevelIndex
    })
    .map((slab) => {
      const levelId = slab.parentId ?? null
      const context: SlabPolygonContext = {
        walls: wallsByLevel.get(levelId) ?? [],
        siblingSlabs: (slabsByLevel.get(levelId) ?? []).filter((sibling) => sibling.id !== slab.id),
      }
      return getRenderableSlabPolygon(slab, context)
    })
}
