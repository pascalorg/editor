import type { AnyNode, AnyNodeId } from '@pascal-app/core'

/**
 * Project per-frame wall drag overrides (`{ start, end, curveOffset }`)
 * from `useLiveNodeOverrides` into a fresh `nodes` snapshot. The 2D drag
 * handlers publish overrides for the moved wall plus its linked
 * neighbours; the floor-plan layer hands the merged snapshot to
 * `buildContext` so each wall's `ctx.siblings` (which feeds the
 * miter calculation) reflects the live cursor positions instead of
 * the last committed scene state.
 *
 * Only wall entries are touched; every other node is shared by
 * reference. The allocation cost is one shallow object per overridden
 * wall — the override map is small, so this is cheap. When the
 * override map is empty (no live drag) the input is returned
 * unchanged.
 */
export function wallFloorplanSiblingOverrides(args: {
  nodeId: AnyNodeId
  nodes: Record<AnyNodeId, AnyNode>
  liveOverrides: Map<string, Record<string, unknown>>
}): Record<AnyNodeId, AnyNode> {
  const { nodes, liveOverrides } = args
  if (liveOverrides.size === 0) return nodes
  let out: Record<AnyNodeId, AnyNode> | null = null
  for (const [id, override] of liveOverrides) {
    const existing = nodes[id as AnyNodeId]
    if (existing?.type !== 'wall') continue
    if (Object.keys(override).length === 0) continue
    if (!out) out = { ...nodes }
    out[id as AnyNodeId] = { ...existing, ...override } as AnyNode
  }
  return out ?? nodes
}
