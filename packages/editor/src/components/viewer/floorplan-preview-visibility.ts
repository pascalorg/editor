import { type AnyNode, hidesDescendants } from '@pascal-app/core'

/**
 * A node draws in the plan unless it, or an ancestor whose flag reaches its
 * descendants, is hidden. A hidden Site keeps its buildings on the plan; see
 * `hidesDescendants`.
 */
export function isVisibleInFloorplan(node: AnyNode, nodes: Record<string, AnyNode>): boolean {
  if (node.visible === false) return false
  const seen = new Set<string>([node.id])
  let current: AnyNode | undefined = node.parentId ? nodes[node.parentId] : undefined
  while (current) {
    if (seen.has(current.id)) return true
    seen.add(current.id)
    if (current.visible === false && hidesDescendants(current)) return false
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return true
}
