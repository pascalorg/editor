import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'

/**
 * Assemblies hosted directly by `hostId`. Exported for the opening move tools,
 * which know the wall they are dropping onto before the opening's `parentId`
 * has been rewritten.
 */
export function formworkAssembliesOnHost(
  hostId: string,
  nodes: Record<string, AnyNode>,
): AnyNodeId[] {
  const out: AnyNodeId[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'formwork-assembly') continue
    if (node.parentId === hostId) out.push(node.id as AnyNodeId)
  }
  return out
}

/**
 * Every formwork assembly whose geometry an edit on `nodeId` can change.
 * `updateNode` dirties only the edited node and its parent — never children,
 * never siblings — so the assemblies have to be named explicitly.
 *
 * Scope differs by what was edited, because the two edits reach different
 * distances:
 *
 * - A **construction edit on a wall or column** is level-wide. Coverage is
 *   decided by *relative* cast order, so raising one wall's `castOrder` past a
 *   neighbour's moves the stop-end from one wall to the other; the neighbour
 *   would otherwise keep rendering the faces it had before the reorder.
 * - An **opening edit** reaches only its host. Moving or resizing a door
 *   re-cuts that wall's panels and moves its reveal box-out, but no
 *   neighbour's coverage depends on it.
 */
export function formworkAssembliesAffectedBy(
  nodeId: AnyNodeId,
  nodes: Record<string, AnyNode>,
): AnyNodeId[] {
  const node = nodes[nodeId]
  if (!node) return []

  if (node.type === 'door' || node.type === 'window') {
    const hostId = node.wallId ?? node.parentId
    return hostId ? formworkAssembliesOnHost(hostId, nodes) : []
  }

  const levelId = node.parentId
  const out: AnyNodeId[] = []
  for (const candidate of Object.values(nodes)) {
    if (candidate.type !== 'formwork-assembly') continue
    const host = candidate.parentId ? nodes[candidate.parentId] : undefined
    if (!host) continue
    if (host.id !== nodeId && host.parentId !== levelId) continue
    out.push(candidate.id as AnyNodeId)
  }
  return out
}
