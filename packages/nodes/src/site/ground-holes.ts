import type { AnyNode, SlabNode } from '@pascal-app/core'

const polygonBounds = (polygon: ReadonlyArray<readonly [number, number]>) => {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ }
}

const signedArea2 = (polygon: ReadonlyArray<readonly [number, number]>) =>
  polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]
    if (!next) return sum
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)

const getAncestorChain = (node: AnyNode, nodesById: Record<string, AnyNode>) => {
  const chain: Array<{
    id: string
    type: string
    parentId: string | null
    level?: number
    position?: [number, number, number]
    rotation?: [number, number, number] | number
  }> = []
  let parentId = node.parentId

  while (parentId) {
    const parent = nodesById[parentId]
    if (!parent) break

    chain.push({
      id: parent.id,
      type: parent.type,
      parentId: parent.parentId,
      level: parent.type === 'level' ? parent.level : undefined,
      position: 'position' in parent ? (parent.position as [number, number, number]) : undefined,
      rotation:
        'rotation' in parent ? (parent.rotation as [number, number, number] | number) : undefined,
    })
    parentId = parent.parentId
  }

  return chain
}

export function collectRecessedSlabGroundHolePolygons(
  nodes: Record<string, AnyNode> | AnyNode[],
): [number, number][][] {
  const nodeList = Object.values(nodes)
  const nodesById = Object.fromEntries(nodeList.map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >

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
  const holes = recessedSlabs.map((node) => node.polygon as [number, number][])

  if (holes.length > 0) {
    console.log('[pascal:site:holes:collect]', {
      nodeCount: nodeList.length,
      levels: Array.from(levelIndexById.entries()).map(([id, level]) => ({ id, level })),
      lowestLevelIndex,
      slabs: recessedSlabs.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        elevation: node.elevation ?? 0.05,
        polygonPoints: node.polygon.length,
        bounds: polygonBounds(node.polygon),
        signedArea2: signedArea2(node.polygon),
        polygon: node.polygon,
        ancestorChain: getAncestorChain(node, nodesById),
      })),
      holes: holes.map((polygon) => ({
        pointCount: polygon.length,
        bounds: polygonBounds(polygon),
        signedArea2: signedArea2(polygon),
        polygon,
      })),
    })
  }

  return holes
}
