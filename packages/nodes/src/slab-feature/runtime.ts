import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveNode,
  resolveSlabFeaturePlacement,
  type SlabFeatureNode,
} from '@pascal-app/core'

export function slabFeatureRoot(nodes: Readonly<Record<string, AnyNode>>, node: SlabFeatureNode) {
  try {
    return resolveSlabFeaturePlacement(nodes, node).slab.id
  } catch {
    return null
  }
}

/** Committed edits rebuild the host once; live gestures use lightweight edit previews. */
export function createSlabFeatureDependencyTracker(initial: Readonly<Record<string, AnyNode>>) {
  let previous = initial
  return (nodes: Readonly<Record<string, AnyNode>>) => {
    const dirty = new Set<AnyNodeId>()
    for (const source of [previous, nodes])
      for (const node of Object.values(source)) {
        if (node.type !== 'slab-feature' || previous[node.id] === nodes[node.id]) continue
        const root = slabFeatureRoot(source, node)
        if (root) dirty.add(root)
      }
    previous = nodes
    return [...dirty]
  }
}

/** Only ancestor edits change the committed solid's frame during its own ghost preview. */
export function slabFeatureRenderNodes(
  nodes: Readonly<Record<string, AnyNode>>,
  node: SlabFeatureNode,
) {
  const patches = new Map<string, AnyNode>()
  let parent = nodes[node.parentId ?? '']
  while (parent && (parent.type === 'slab' || parent.type === 'slab-feature')) {
    const effective = getEffectiveNode(parent)
    if (effective !== parent) patches.set(parent.id, effective)
    parent = nodes[parent.parentId ?? '']
  }
  return patches.size
    ? new Proxy(nodes, {
        get: (target, key, receiver) =>
          typeof key === 'string' && patches.has(key)
            ? patches.get(key)
            : Reflect.get(target, key, receiver),
      })
    : nodes
}
