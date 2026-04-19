import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode } from '@pascal-app/core/schema'

/**
 * `cloneSceneGraph` normalises `SiteNode.children` to an array of node IDs,
 * but core's `SiteNode` schema expects an array of embedded `BuildingNode` /
 * `ItemNode` objects (see `packages/mcp/CROSS_CUTTING.md` §2). To keep the
 * cloned graph validating against `AnyNode`, re-embed the site children from
 * the flat dict.
 *
 * Pure: returns a new graph without mutating the input.
 */
export function rehydrateSiteChildren(graph: SceneGraph): SceneGraph {
  const out: SceneGraph = {
    nodes: { ...graph.nodes },
    rootNodeIds: [...graph.rootNodeIds],
    ...(graph.collections ? { collections: graph.collections } : {}),
  }
  for (const [id, node] of Object.entries(out.nodes)) {
    if (node.type !== 'site') continue
    const childrenField = (node as { children?: unknown[] }).children
    if (!Array.isArray(childrenField)) continue
    const rehydrated: AnyNode[] = []
    for (const child of childrenField) {
      if (typeof child === 'string') {
        const target = out.nodes[child as keyof typeof out.nodes]
        if (target && (target.type === 'building' || target.type === 'item')) {
          rehydrated.push(target)
        }
      } else if (child && typeof child === 'object' && 'id' in (child as Record<string, unknown>)) {
        rehydrated.push(child as AnyNode)
      }
    }
    out.nodes[id as keyof typeof out.nodes] = {
      ...(node as AnyNode),
      children: rehydrated,
    } as AnyNode
  }
  return out
}
