'use client'

import {
  type AnyNode,
  bakePolicyOf,
  nodeRegistry,
  type RendererSource,
  type SceneGraph,
} from '@pascal-app/core'
import { createPortal } from '@react-three/fiber'
import { Suspense } from 'react'
import type { Object3D } from 'three'
import { getRegistryRenderer } from '../renderers/node-renderer'

/**
 * Kinds with `def.bake === 'strip'` (scans/LiDAR, guides/floorplan images) are
 * excluded from the baked GLB — heavy reference assets stored elsewhere. The GLB
 * viewer re-adds them at runtime from the scene graph, portaled into their parent
 * level's baked node so they ride level stacking, using the same registry
 * renderers as the parametric viewer. Selection is registry-driven; scan/guide
 * privacy is enforced upstream (`show_*_public`), so a disallowed asset is never
 * even fetched — we still honour the flags here as a second gate.
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
    if (bakePolicyOf(node.type) !== 'strip') continue
    if (node.type === 'scan' && !allow.scans) continue
    if (node.type === 'guide' && !allow.guides) continue
    out.push(node)
  }
  return out
}

/**
 * Kinds with `def.bake === 'replace'` — baked as static geometry (so plain glTF
 * viewers still show them) but re-rendered live here, since their runtime look
 * differs from a frozen snapshot (shader wind, interactivity). `GlbScene` hides
 * the baked meshes for these kinds; this feeds them back through the same
 * portal-into-level path as reference nodes. Registry-driven; no privacy gate
 * (dynamic scene content, not user uploads).
 */
export function buildGlbReplaceNodes(sceneGraph: SceneGraph | null | undefined): AnyNode[] {
  const nodes = sceneGraph?.nodes
  if (!nodes) return []
  const out: AnyNode[] = []
  for (const raw of Object.values(nodes)) {
    const node = raw as AnyNode
    if (bakePolicyOf(node.type) === 'replace') out.push(node)
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

/** Render one rebuilt node via its registry renderer, portaled into its parent
 *  level's baked Object3D (so the node's level-local transform resolves to the
 *  same world pose as the parametric scene). `replace` kinds prefer their
 *  `bakeReplaceRenderer` (real geometry) over the plain `renderer` (which may be
 *  an invisible selection proxy); `strip` kinds fall through to `renderer`. */
function GlbReferenceNode({ node, anchor }: { node: AnyNode; anchor: Object3D }) {
  const def = nodeRegistry.get(node.type)
  const source = def?.bakeReplaceRenderer ?? def?.renderer
  const Renderer = source ? getRegistryRenderer(source as RendererSource<AnyNode>) : null
  if (!Renderer) return null
  return createPortal(
    <Suspense fallback={null}>
      <Renderer node={node} />
    </Suspense>,
    anchor,
  )
}
