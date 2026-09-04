import type { AnyNode, AnyNodeId } from '../schema/types'

export interface CycleHealingResult {
  nodes: Record<AnyNodeId, AnyNode>
  brokenCycleNodes: AnyNodeId[]
  orphanedNodesRepaired: AnyNodeId[]
}

/**
 * Deterministically detects and breaks directed cycles (e.g. A -> B -> A) and repairs
 * orphaned child nodes in the scene hierarchy.
 * Uses Tarjan's Strongly Connected Components (SCC) algorithm in O(|V| + |E|).
 */
export function healSceneCycles(
  nodesInput: Record<AnyNodeId, AnyNode>,
  rootSiteId: AnyNodeId | null = null,
): CycleHealingResult {
  const nodes = { ...nodesInput }
  const nodeIds = Object.keys(nodes) as AnyNodeId[]
  const brokenCycleNodes: AnyNodeId[] = []
  const orphanedNodesRepaired: AnyNodeId[] = []

  // 1. Repair orphaned child nodes (references to non-existent parentId)
  for (const id of nodeIds) {
    const node = nodes[id]
    if (!node) continue
    const parentId = node.parentId as AnyNodeId | null | undefined
    if (parentId && !nodes[parentId]) {
      if (rootSiteId && id !== rootSiteId) {
        nodes[id] = { ...node, parentId: rootSiteId } as AnyNode
        orphanedNodesRepaired.push(id)
      } else {
        nodes[id] = { ...node, parentId: null } as AnyNode
        orphanedNodesRepaired.push(id)
      }
    }
  }

  // 2. Tarjan's SCC Algorithm for Cycle Detection
  let index = 0
  const indices = new Map<AnyNodeId, number>()
  const lowlinks = new Map<AnyNodeId, number>()
  const onStack = new Set<AnyNodeId>()
  const stack: AnyNodeId[] = []
  const sccs: AnyNodeId[][] = []

  function strongConnect(v: AnyNodeId) {
    indices.set(v, index)
    lowlinks.set(v, index)
    index++
    stack.push(v)
    onStack.add(v)

    const parentId = nodes[v]?.parentId as AnyNodeId | null | undefined
    if (parentId && nodes[parentId]) {
      if (!indices.has(parentId)) {
        strongConnect(parentId)
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(parentId)!))
      } else if (onStack.has(parentId)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(parentId)!))
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: AnyNodeId[] = []
      let w: AnyNodeId | undefined
      do {
        w = stack.pop()
        if (w) {
          onStack.delete(w)
          scc.push(w)
        }
      } while (w && w !== v)

      const firstSccNode = scc[0]
      if (scc.length > 1 || (scc.length === 1 && firstSccNode && nodes[firstSccNode]?.parentId === firstSccNode)) {
        sccs.push(scc)
      }
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) {
      strongConnect(id)
    }
  }

  // 3. Deterministically Break Cycles at the lexicographically smallest ID
  for (const scc of sccs) {
    if (scc.length === 0) continue
    const sorted = [...scc].sort()
    const breakTargetId = sorted[0]
    if (!breakTargetId) continue
    const targetNode = nodes[breakTargetId]

    if (targetNode) {
      const fallbackParent = rootSiteId && breakTargetId !== rootSiteId ? rootSiteId : null
      nodes[breakTargetId] = {
        ...targetNode,
        parentId: fallbackParent,
      } as AnyNode
      brokenCycleNodes.push(breakTargetId)
    }
  }

  // 4. Rebuild parent.children arrays to maintain two-way hierarchy symmetry
  const childrenMap = new Map<AnyNodeId, AnyNodeId[]>()
  for (const id of Object.keys(nodes) as AnyNodeId[]) {
    const pId = nodes[id]?.parentId as AnyNodeId | null | undefined
    if (pId && nodes[pId]) {
      const list = childrenMap.get(pId) ?? []
      list.push(id)
      childrenMap.set(pId, list)
    }
  }

  for (const id of Object.keys(nodes) as AnyNodeId[]) {
    const node = nodes[id]
    if (node && 'children' in node && Array.isArray(node.children)) {
      const actualChildren = childrenMap.get(id) ?? []
      nodes[id] = { ...node, children: actualChildren } as AnyNode
    }
  }

  return { nodes, brokenCycleNodes, orphanedNodesRepaired }
}
