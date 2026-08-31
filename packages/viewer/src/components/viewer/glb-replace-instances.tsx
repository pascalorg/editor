'use client'

import { type AnyNode, type BakeReplaceRenderer, nodeRegistry } from '@pascal-app/core'
import { createPortal } from '@react-three/fiber'
import { type ComponentType, Fragment, lazy, memo, type ReactNode, Suspense, useMemo } from 'react'
import type { Object3D } from 'three'

// Lazy components cached by their source so React.lazy isn't re-invoked per render.
const lazyCache = new WeakMap<BakeReplaceRenderer<AnyNode>, ComponentType<{ nodes: AnyNode[] }>>()

function getReplaceRenderer(
  source: BakeReplaceRenderer<AnyNode>,
): ComponentType<{ nodes: AnyNode[] }> {
  const cached = lazyCache.get(source)
  if (cached) return cached
  const Comp = lazy(source.module) as unknown as ComponentType<{ nodes: AnyNode[] }>
  lazyCache.set(source, Comp)
  return Comp
}

/**
 * Re-renders `bake: 'replace'` kinds (e.g. plugin trees) live over the baked GLB.
 * The baked static meshes are hidden by `GlbScene`; these nodes are grouped by
 * `(parent level, kind)` and each group is handed to the kind's collective
 * `bakeReplaceRenderer` (an instanced renderer), portaled into that level's baked
 * `Object3D`. Local-space instances therefore ride level stacking/explode for
 * free, and a forest stays a few instanced draw calls.
 *
 * Memoized: `GlbScene` re-renders each frame on camera move; `nodes` and
 * `identity` are stable refs, so this whole subtree short-circuits.
 */
export const GlbReplaceInstances = memo(function GlbReplaceInstances({
  nodes,
  identity,
}: {
  nodes: AnyNode[]
  identity: Map<string, Object3D>
}) {
  const byLevel = useMemo(() => {
    const levels = new Map<string, Map<string, AnyNode[]>>()
    for (const node of nodes) {
      const parentId = node.parentId
      if (!parentId) continue
      let byKind = levels.get(parentId)
      if (!byKind) {
        byKind = new Map()
        levels.set(parentId, byKind)
      }
      const list = byKind.get(node.type)
      if (list) list.push(node)
      else byKind.set(node.type, [node])
    }
    return levels
  }, [nodes])

  const portals: ReactNode[] = []
  byLevel.forEach((byKind, parentId) => {
    const anchor = identity.get(parentId)
    if (!anchor) return
    byKind.forEach((kindNodes, kind) => {
      const source = nodeRegistry.get(kind)?.bakeReplaceRenderer as
        | BakeReplaceRenderer<AnyNode>
        | undefined
      if (!source) return
      const Renderer = getReplaceRenderer(source)
      portals.push(
        <Fragment key={`${parentId}:${kind}`}>
          {createPortal(
            <Suspense fallback={null}>
              <Renderer nodes={kindNodes} />
            </Suspense>,
            anchor,
          )}
        </Fragment>,
      )
    })
  })
  return <>{portals}</>
})
