import type { AnyNode, AnyNodeId } from '@pascal-app/core'

export function collectQuickActionNodeFamily(
  nodes: Record<AnyNodeId, AnyNode>,
  selectedId: string,
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

  addSubtree(selected.id)
  addSubtree(selected.parentId)

  return collected
}
