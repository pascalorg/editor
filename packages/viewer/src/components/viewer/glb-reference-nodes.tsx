'use client'

import { type AnyNode, nodeRegistry, type RendererSource, type SceneGraph } from '@pascal-app/core'
import { createPortal } from '@react-three/fiber'
import { Suspense } from 'react'
import type { Object3D } from 'three'
import { getRegistryRenderer } from '../renderers/node-renderer'

/**
 * Scans (LiDAR meshes) and guides (floorplan images) are stripped from the
 * baked GLB — they're heavy reference assets stored elsewhere. The GLB viewer
 * re-adds them at runtime from the scene graph, portaled into their parent
 * level's baked node so they ride level stacking, using the same registry
 * renderers as the parametric viewer. Privacy is enforced upstream: the page
 * only includes nodes whose `show_*_public` flag (or owner/admin) allows it, so
 * a disallowed asset is never even fetched.
 */
export function buildGlbReferenceNodes(
  sceneGraph: SceneGraph | null | undefined,
  allow: { scans: boolean; guides: boolean },
): AnyNode[] {
  const nodes = sceneGraph?.nodes
  if (!nodes) return []
  const out: AnyNode[] = []
  for (const raw of Object.values(nodes)) {
    const node = raw as AnyNode
    if (node.type === 'scan' && allow.scans) out.push(node)
    else if (node.type === 'guide' && allow.guides) out.push(node)
  }
  return out
}

export function GlbReferenceNodes({
  nodes,
  identity,
}: {
  nodes: AnyNode[]
  identity: Map<string, Object3D>
}) {
  return (
    <>
      {nodes.map((node) => {
        const anchor = node.parentId ? identity.get(node.parentId) : undefined
        return anchor ? <GlbReferenceNode anchor={anchor} key={node.id} node={node} /> : null
      })}
    </>
  )
}

/** Render one scan/guide via its registry renderer, portaled into its parent
 *  level's baked Object3D (so the node's level-local transform resolves to the
 *  same world pose as the parametric scene). */
function GlbReferenceNode({ node, anchor }: { node: AnyNode; anchor: Object3D }) {
  const source = nodeRegistry.get(node.type)?.renderer
  const Renderer = source ? getRegistryRenderer(source as RendererSource<AnyNode>) : null
  if (!Renderer) return null
  return createPortal(
    <Suspense fallback={null}>
      <Renderer node={node} />
    </Suspense>,
    anchor,
  )
}
