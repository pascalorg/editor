import type { AnyNode, AnyNodeId, NodeQuickActionNodeScope } from '@pascal-app/core'

export function collectQuickActionNodeScope(
  nodes: Record<AnyNodeId, AnyNode>,
  selectedId: string,
  scope: NodeQuickActionNodeScope = 'family',
): Record<AnyNodeId, AnyNode> | null {
  const selected = nodes[selectedId as AnyNodeId]
  if (!selected) return null

  const collected: Record<AnyNodeId, AnyNode> = {}
  const addSubtree = (rootId: string | null | undefined) => {
    if (!rootId) return
    const pending = [rootId]

    while (pending.length > 0) {
      const id = pending.pop()
      if (!id || collected[id as AnyNodeId]) continue
      const node = nodes[id as AnyNodeId]
      if (!node) continue

      collected[node.id as AnyNodeId] = node
      for (const childId of (node as { children?: readonly string[] }).children ?? []) {
        pending.push(childId)
      }
    }
  }

  if (scope === 'level') {
    const visited = new Set<AnyNodeId>()
    let current: AnyNode | undefined = selected
    while (current && !visited.has(current.id as AnyNodeId)) {
      visited.add(current.id as AnyNodeId)
      if (current.type === 'level') {
        addSubtree(current.id)
        return collected
      }
      current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
    }
    return null
  }

  addSubtree(selected.id)
  addSubtree(selected.parentId)

  return collected
}
