import type { AnyNode, AnyNodeId, GeometryContext } from '@pascal-app/core'

/** Geometry and export callers can supply either a snapshot or a resolver. */
export function siteContextNodes(node: AnyNode, ctx?: Partial<GeometryContext>) {
  const nodes: Record<string, AnyNode> = { ...ctx?.sceneNodes, [node.id]: node }
  const site = ctx?.parent?.type === 'site' ? ctx.parent : undefined
  if (site) {
    const pending: AnyNode[] = [site]
    const visited = new Set<string>()
    while (pending.length) {
      const current = pending.pop()!
      if (visited.has(current.id)) continue
      visited.add(current.id)
      nodes[current.id] = current
      if ('children' in current && Array.isArray(current.children)) {
        for (const id of current.children) {
          const child = ctx?.resolve?.(id as AnyNodeId)
          if (child) pending.push(child)
        }
      }
    }
  }
  return nodes
}

export function belongsToSite(
  node: AnyNode,
  siteId: string,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  let parentId = node.parentId
  const visited = new Set<string>([node.id])
  while (parentId && !visited.has(parentId)) {
    if (parentId === siteId) return true
    visited.add(parentId)
    parentId = nodes[parentId]?.parentId ?? null
  }
  return false
}
