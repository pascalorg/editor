import type { AnyNode, SlabNode } from '@pascal-app/core'

export function collectRecessedSlabGroundHolePolygons(
  nodes: Record<string, AnyNode> | AnyNode[],
): [number, number][][] {
  const nodeList = Object.values(nodes)

  const levelIndexById = new Map<string, number>()
  let lowestLevelIndex = Number.POSITIVE_INFINITY
  nodeList.forEach((node) => {
    if (node.type !== 'level') return
    levelIndexById.set(node.id, node.level)
    lowestLevelIndex = Math.min(lowestLevelIndex, node.level)
  })

  const recessedSlabs = nodeList
    .filter(
      (node): node is SlabNode =>
        node.type === 'slab' &&
        node.visible &&
        node.polygon.length >= 3 &&
        (node.elevation ?? 0.05) < 0,
    )
    .filter((node) => {
      if (!Number.isFinite(lowestLevelIndex)) return true
      const parentLevel = node.parentId ? levelIndexById.get(node.parentId) : undefined
      return parentLevel === lowestLevelIndex
    })
  return recessedSlabs.map((node) => node.polygon as [number, number][])
}
