import { type AnyNode, type AnyNodeId, findLevelAncestorId, nodeRegistry } from '@pascal-app/core'

type Nodes = Readonly<Record<string, AnyNode>>

/** What a kind says about a node (`capabilities.exterior`): outdoors, never, or nothing. */
function declaredExterior(node: AnyNode, nodes: Nodes): boolean | undefined {
  const exterior = nodeRegistry.get(node.type)?.capabilities?.exterior
  return typeof exterior === 'function' ? exterior(node, nodes) : exterior
}

/**
 * Whether a change to this node is seen from outside, as its kind declares (`capabilities.exterior`:
 * a roof, a wall with an exterior face and an opening in it, a fence). A node whose kind says nothing
 * is outdoors when what holds it is (a chimney's cap), or when it stands in no building's storey
 * (outdoor furnishing, plants). A sofa, an interior wall and a finish inside are not: they are looked
 * at through a cutaway.
 */
export function isExteriorNode(nodes: Nodes, id: string): boolean {
  const node = nodes[id]
  if (!node) return false
  const own = declaredExterior(node, nodes)
  if (own !== undefined) return own
  // Standing under a node that is outdoors, up to the first one that never is (a storey).
  for (
    let at = node.parentId ? nodes[node.parentId] : undefined, guard = 0;
    at && guard < 16;
    at = at.parentId ? nodes[at.parentId] : undefined, guard += 1
  ) {
    const held = nodeRegistry.get(at.type)?.capabilities?.exterior
    if (held === true) return true
    if (held === false) break
  }
  return findLevelAncestorId(id as AnyNodeId, nodes as never) === null
}

/** Whether any of `ids` is a change seen from outside. */
export function anyExterior(nodes: Nodes, ids: readonly string[]): boolean {
  return ids.some((id) => isExteriorNode(nodes, id))
}
