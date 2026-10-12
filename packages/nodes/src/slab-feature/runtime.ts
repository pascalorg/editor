import {
  type AnyNode,
  type AnyNodeId,
  resolveSlabFeaturePlacement,
  type SlabFeatureNode,
  useLiveNodeOverrides,
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

// A live snapshot shares its projected slab identity across every feature. This
// preserves the construction-lift memo instead of rescanning the scene per frame.
const renderGraphs = new WeakMap<
  Readonly<Record<string, AnyNode>>,
  WeakMap<object, Readonly<Record<string, AnyNode>>>
>()

export function slabFeatureRenderNodes(nodes: Readonly<Record<string, AnyNode>>) {
  const overrides = useLiveNodeOverrides.getState().overrides
  if (!overrides.size) return nodes
  let snapshots = renderGraphs.get(nodes)
  if (!snapshots) {
    snapshots = new WeakMap()
    renderGraphs.set(nodes, snapshots)
  }
  const cached = snapshots.get(overrides)
  if (cached) return cached
  const effective = new Map<string, AnyNode>()
  const graph = new Proxy(nodes, {
    get(target, key, receiver) {
      if (typeof key !== 'string') return Reflect.get(target, key, receiver)
      const node = target[key]
      const patch = overrides.get(key)
      if (!node || !patch) return node
      let live = effective.get(key)
      if (!live) {
        live = { ...node, ...patch } as AnyNode
        effective.set(key, live)
      }
      return live
    },
  })
  snapshots.set(overrides, graph)
  return graph
}
