'use client'

import {
  type AnyNode,
  isNodeKindEnabled,
  nodeRegistry,
  onRegistryChange,
  type RendererSource,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { type ComponentType, lazy, Suspense, useCallback, useSyncExternalStore } from 'react'
import { CommittedSceneNodeInput } from '../../lib/scene-capture-inputs'
import { useRevealPending } from '../../systems/construction-reveal/construction-reveal'
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
  const materials = useScene((state) => state.materials)
  const liveOverrides = useLiveNodeOverrides((state) => state.get(nodeId))
  const installedPlugins = useScene((state) => state.installedPlugins)
  // Plugins register after the first mount (async discovery). Subscribe to this
  // node's own kind only: a registration re-renders the nodes of that kind and
  // leaves every other mounted node alone.
  const kind = node?.type
  const readDefinition = useCallback(() => (kind ? nodeRegistry.get(kind) : undefined), [kind])
  const def = useSyncExternalStore(onRegistryChange, readDefinition, readDefinition)
  // A node an agent just built mounts on its construction-reveal turn.
  const revealPending = useRevealPending(nodeId)
  if (!node || revealPending) return null
  if (!isNodeKindEnabled(node.type, installedPlugins)) return null
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
        <CommittedSceneNodeInput liveOverrides={liveOverrides} materials={materials} node={node} />
      </Suspense>
    )
  }
  if (def.geometry) {
    return (
      <>
        <ParametricNodeRenderer node={node} />
        <CommittedSceneNodeInput liveOverrides={liveOverrides} materials={materials} node={node} />
      </>
    )
  }
  return null
}
