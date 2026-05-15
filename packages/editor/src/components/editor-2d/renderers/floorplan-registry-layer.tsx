'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { memo, useMemo } from 'react'
import { FloorplanGeometryRenderer } from './floorplan-geometry-renderer'

/**
 * Registry-driven floor-plan layer.
 *
 * Iterates registered kinds with `def.floorplan`, finds the matching nodes
 * in the active level, calls each kind's builder, and emits the resulting
 * SVG via `<FloorplanGeometryRenderer>`. Coexists with the legacy
 * `floorplan-panel.tsx` inline rendering — the panel's hand-written
 * dispatch keeps running for unmigrated kinds, this layer adds the
 * registry-driven path for kinds that opt in via `def.floorplan`.
 *
 * Phase 5 batch migration: as each kind ports its `floorplan` field, its
 * inline rendering inside `floorplan-panel.tsx` becomes redundant and
 * gets deleted in the same PR.
 *
 * Coordinates are level-local meters; the parent SVG handles the
 * world→pixel transform via its viewBox.
 */
export const FloorplanRegistryLayer = memo(function FloorplanRegistryLayer() {
  const levelId = useViewer((s) => s.selection.levelId)
  const nodes = useScene((s) => s.nodes)

  const entries = useMemo(() => {
    if (!levelId) return []
    const out: {
      id: AnyNodeId
      node: AnyNode
      geometry: FloorplanGeometry
    }[] = []

    // Walk the level's subtree once. Most kinds live as direct or indirect
    // children of the level node. For shelf today the parent is the level;
    // future container kinds (slab, ceiling, wall hosting items) will
    // require nested traversal — handled by the same walk below.
    const visit = (id: AnyNodeId) => {
      const node = nodes[id]
      if (!node) return
      const def = nodeRegistry.get(node.type)
      const builder = def?.floorplan
      if (builder) {
        const ctx = buildContext(node, nodes)
        // Builder is typed against the kind's specific node; at dispatch
        // level we lose that refinement. Cast contained here.
        const geometry = (builder as (n: AnyNode, c: GeometryContext) => unknown)(node, ctx)
        if (geometry) out.push({ id, node, geometry: geometry as never })
      }
      const childIds = (node as unknown as { children?: AnyNodeId[] }).children
      if (Array.isArray(childIds)) {
        for (const cid of childIds) visit(cid)
      }
    }

    visit(levelId as AnyNodeId)
    return out
  }, [levelId, nodes])

  if (entries.length === 0) return null

  return (
    <g className="floorplan-registry-layer" pointerEvents="none">
      {entries.map(({ id, geometry }) =>
        geometry ? <FloorplanGeometryRenderer geometry={geometry} key={id} /> : null,
      )}
    </g>
  )
})

function buildContext(node: AnyNode, nodes: Record<string, AnyNode>): GeometryContext {
  const resolve = <N = AnyNode>(id: AnyNodeId): N | undefined => nodes[id] as N | undefined

  const childIds = (node as unknown as { children?: AnyNodeId[] }).children
  const children: AnyNode[] = Array.isArray(childIds)
    ? childIds.map((cid) => nodes[cid]).filter((n): n is AnyNode => n !== undefined)
    : []

  const parentId = node.parentId as AnyNodeId | null
  const parent: AnyNode | null = parentId ? (nodes[parentId] ?? null) : null

  let siblings: AnyNode[] = []
  if (parent) {
    const parentChildIds = (parent as unknown as { children?: AnyNodeId[] }).children
    if (Array.isArray(parentChildIds)) {
      for (const sid of parentChildIds) {
        if (sid === node.id) continue
        const s = nodes[sid]
        if (s && s.type === node.type) siblings.push(s)
      }
    } else {
      siblings = Object.values(nodes).filter(
        (n) => n !== node && n.type === node.type && n.parentId === parentId,
      )
    }
  }

  return { resolve, children, siblings, parent }
}
