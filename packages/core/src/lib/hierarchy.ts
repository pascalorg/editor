import type { AnyNode, AnyNodeId } from '../schema/types'

type NodeMap = Readonly<Record<string, Pick<AnyNode, 'parentId'>>>

/**
 * Whether assigning `newParentId` to `nodeId` would make its parent chain
 * cyclic. A pre-existing cycle on that chain is unsafe to extend as well.
 */
export function wouldCreateHierarchyCycle(
  nodeId: AnyNodeId,
  newParentId: AnyNodeId | null,
  nodes: NodeMap,
): boolean {
  if (!newParentId) return false

  const seen = new Set<AnyNodeId>()
  let currentId: AnyNodeId | null = newParentId
  while (currentId) {
    if (currentId === nodeId || seen.has(currentId)) return true
    seen.add(currentId)
    currentId = (nodes[currentId]?.parentId as AnyNodeId | null | undefined) ?? null
  }
  return false
}

/** Return each distinct cycle encoded by `parentId` links. */
export function findHierarchyCycles(nodes: NodeMap): AnyNodeId[][] {
  const visited = new Set<AnyNodeId>()
  const cycles: AnyNodeId[][] = []

  for (const startId of Object.keys(nodes) as AnyNodeId[]) {
    if (visited.has(startId)) continue

    const chain: AnyNodeId[] = []
    const positions = new Map<AnyNodeId, number>()
    let currentId: AnyNodeId | null = startId
    while (currentId && nodes[currentId] && !visited.has(currentId)) {
      const position = positions.get(currentId)
      if (position !== undefined) {
        cycles.push(chain.slice(position))
        break
      }
      positions.set(currentId, chain.length)
      chain.push(currentId)
      currentId = (nodes[currentId]?.parentId as AnyNodeId | null | undefined) ?? null
    }
    for (const id of chain) visited.add(id)
  }

  return cycles
}
