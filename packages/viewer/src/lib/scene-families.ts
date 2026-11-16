import {
  type AnyNode,
  type AnyNodeId,
  hidesDescendants,
  nodeRegistry,
  type SceneGraph,
} from '@pascal-app/core'

export const VIEWER_FAMILIES = [
  'site',
  'floors',
  'walls',
  'structure',
  'circulation',
  'openings',
  'roofs',
  'roof-services',
  'hvac',
  'plumbing',
  'items',
  'other',
] as const

/** Uses the loaded node registry, independently of useScene. Null explicitly excludes a kind. */
export function familyForNode(node: AnyNode): string | undefined {
  const definition = nodeRegistry.get(node.type)
  const viewer = definition?.extensions?.['pascal:viewer'] as { family?: string | null } | undefined
  if (viewer?.family === null) return undefined
  if (typeof viewer?.family === 'string') return viewer.family
  return definition?.geometry || definition?.renderer ? 'other' : undefined
}

/** Visible authored scope; family filtering never cascades through a classified host. */
export function resolveFamilyVisibility(graph: SceneGraph, family: string | null): Set<AnyNodeId> {
  const shown = new Set<AnyNodeId>()
  const visited = new Set<AnyNodeId>()
  const pending = [...graph.rootNodeIds]
  while (pending.length) {
    const id = pending.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const node = graph.nodes[id]
    if (!node || (node.visible === false && hidesDescendants(node))) continue
    const classification = familyForNode(node)
    if (
      node.visible !== false &&
      (family === null || classification === undefined || classification === family)
    )
      shown.add(id)
    if ('children' in node) {
      for (const child of node.children)
        if (typeof child === 'string') pending.push(child as AnyNodeId)
    }
  }
  return shown
}

/** Load the host's render plugin first; no graph hydration into useScene is needed. */
export function sceneFamilies(graph: SceneGraph): string[] {
  const present = new Set<string>()
  for (const id of resolveFamilyVisibility(graph, null)) {
    const family = familyForNode(graph.nodes[id]!)
    if (family !== undefined) present.add(family)
  }
  return VIEWER_FAMILIES.filter((family) => present.has(family))
}
