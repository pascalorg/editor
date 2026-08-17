'use client'

import {
  type AnyNode,
  categoryOf,
  isNodeKindEnabled,
  nodeRegistry,
  type RendererSource,
  useScene,
} from '@pascal-app/core'
import { type ComponentType, lazy, Suspense } from 'react'
import useViewer from '../../store/use-viewer'
import { ParametricNodeRenderer } from './parametric-node-renderer'

// Cache lazy components by their RendererSource so React.lazy isn't re-invoked
// on every render — that would create a new Suspense boundary each time.
const lazyCache = new WeakMap<RendererSource<AnyNode>, ComponentType<{ node: AnyNode }>>()

export function getRegistryRenderer(
  source: RendererSource<AnyNode>,
): ComponentType<{ node: AnyNode }> | null {
  const cached = lazyCache.get(source)
  if (cached) return cached
  // GLB / instanced-GLB sources lower onto built-in renderers landed in
  // Phase 5 — for now only parametric (lazy module) sources are honored.
  if (source.kind !== 'parametric') return null
  const Comp = lazy(source.module) as unknown as ComponentType<{ node: AnyNode }>
  lazyCache.set(source, Comp)
  return Comp
}

export const NodeRenderer = ({ nodeId }: { nodeId: AnyNode['id'] }) => {
  const node = useScene((state) => state.nodes[nodeId])
  const installedPlugins = useScene((state) => state.installedPlugins)
  const hiddenCategories = useViewer((state) => state.hiddenCategories)
  if (!node) return null
  if (!isNodeKindEnabled(node.type, installedPlugins)) return null
  // Non-destructive category visibility. Containers (site/building/level) map to
  // `null` so hiding a category never removes the hierarchy that hosts the rest
  // of the scene — only genuine content nodes are gated here.
  const category = categoryOf(node.type)
  if (category !== null && hiddenCategories.has(category)) return null
  const def = nodeRegistry.get(node.type)
  if (!def) return null
  // Two-checkbox dispatch (see wiki/architecture/node-definitions.md):
  //  1. Custom renderer — JSX-side composition for kinds that need GLB,
  //     drei, <Html>, instancing, shader materials.
  //  2. Else, if the kind ships `def.geometry`, the generic empty-group
  //     <ParametricNodeRenderer> is filled by <GeometrySystem> from the
  //     pure builder.
  if (def.renderer) {
    const Renderer = getRegistryRenderer(def.renderer as RendererSource<AnyNode>)
    if (!Renderer) return null
    return (
      <Suspense fallback={null}>
        <Renderer node={node} />
      </Suspense>
    )
  }
  if (def.geometry) {
    return <ParametricNodeRenderer node={node} />
  }
  return null
}
