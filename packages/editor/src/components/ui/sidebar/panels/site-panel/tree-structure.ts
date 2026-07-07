import { type AnyNode, type AnyNodeId, nodeRegistry } from '@pascal-app/core'

/**
 * Child ids the sidebar tree renders under a node: the kind's
 * `def.tree.childIds` override when declared, otherwise the node's own
 * `children`. Kind-agnostic — kinds that reshape their subtree (hidden
 * derived nodes, flattened containers) do so via the registry hook.
 */
export function resolveTreeChildIds(
  nodeId: AnyNodeId,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): AnyNodeId[] {
  const node = nodes[nodeId]
  if (!node) return []
  const childIds = nodeRegistry.get(node.type)?.tree?.childIds
  if (childIds) return childIds(node, nodes)
  const children = (node as { children?: unknown }).children
  return Array.isArray(children) ? (children as AnyNodeId[]) : []
}

/**
 * Whether `targetId` appears anywhere under `nodeId` in the *rendered*
 * sidebar tree (i.e. walking registry-overridden child ids, not the raw
 * scene graph). Drives auto-expansion when a descendant gets selected.
 */
export function treeContainsDescendant(
  nodeId: AnyNodeId,
  targetId: AnyNodeId,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): boolean {
  for (const childId of resolveTreeChildIds(nodeId, nodes)) {
    if (childId === targetId) return true
    if (treeContainsDescendant(childId, targetId, nodes)) return true
  }
  return false
}
