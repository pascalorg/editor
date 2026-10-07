'use client'

import {
  type AnyNode,
  type BakeReplaceRenderer,
  type GeometryContext,
  nodeRegistry,
} from '@pascal-app/core'
import { createPortal } from '@react-three/fiber'
import { type ComponentType, Fragment, lazy, memo, type ReactNode, Suspense, useMemo } from 'react'
import type { Object3D } from 'three'

type ReplaceRendererProps = { nodes: AnyNode[]; resolve?: GeometryContext['resolve'] }

// Lazy components cached by their source so React.lazy isn't re-invoked per render.
const lazyCache = new WeakMap<BakeReplaceRenderer<AnyNode>, ComponentType<ReplaceRendererProps>>()

function getReplaceRenderer(
  source: BakeReplaceRenderer<AnyNode>,
): ComponentType<ReplaceRendererProps> {
  const cached = lazyCache.get(source)
  if (cached) return cached
  const Comp = lazy(source.module) as unknown as ComponentType<ReplaceRendererProps>
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
 * `identity` are stable refs, so this whole subtree short-circuits; `resolve`
 * must be stable too.
 */
export const GlbReplaceInstances = memo(function GlbReplaceInstances({
  nodes,
  identity,
  resolve,
}: {
  nodes: AnyNode[]
  identity: Map<string, Object3D>
  /** Looks up nodes of the published scene graph; handed to every renderer. */
  resolve?: GeometryContext['resolve']
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
              <Renderer nodes={kindNodes} resolve={resolve} />
            </Suspense>,
            anchor,
          )}
        </Fragment>,
      )
    })
  })
  return <>{portals}</>
})
