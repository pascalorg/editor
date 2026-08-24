import {
  type AnyNode,
  type AnyNodeId,
  resolveSelectionProxyId,
} from '@pascal-app/core'

/**
 * Resolve selection proxies and drop duplicates / missing ids. Session groups
 * are just selections — mixed-type groups stay mixed after this pass, and a
 * pair of children that both proxy to the same parent collapse to one id.
 */
export function resolveUniqueSelectionIds(
  ids: readonly string[],
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): AnyNodeId[] {
  const resolved: AnyNodeId[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const node = nodes[id]
    if (!node) continue
    const resolvedId = resolveSelectionProxyId(node, nodes)
    if (seen.has(resolvedId)) continue
    seen.add(resolvedId)
    resolved.push(resolvedId)
  }
  return resolved
}

/**
 * Shared type when every resolved id is the same kind and at least two nodes
 * remain. Otherwise null — including mixed session groups and proxy-collapsed
 * selections that shrink below two distinct nodes.
 */
export function resolveHomogeneousSelection(
  ids: readonly string[],
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): AnyNode['type'] | null {
  const resolvedIds = resolveUniqueSelectionIds(ids, nodes)
  if (resolvedIds.length < 2) return null
  const first = nodes[resolvedIds[0] ?? '']
  if (!first) return null
  for (let i = 1; i < resolvedIds.length; i++) {
    const node = nodes[resolvedIds[i] ?? '']
    if (!node || node.type !== first.type) return null
  }
  return first.type
}
