import type { AnyNode, AnyNodeId, LiveTransform } from '@pascal-app/core'

/**
 * Project per-frame wall and opening drag overrides into a fresh `nodes`
 * snapshot. Wall overrides keep shared miters current; door and window
 * overrides keep associative construction dimensions current while an
 * opening moves or changes host. The 2D drag
 * handlers publish overrides for the moved wall plus its linked
 * neighbours; the floor-plan layer hands the merged snapshot to
 * `buildContext` so each wall's `ctx.siblings` (which feeds the
 * miter calculation) reflects the live cursor positions instead of
 * the last committed scene state.
 *
 * Other node types are shared by reference. The allocation cost is one
 * shallow object per relevant override — the override map is small, so
 * this is cheap. When the
 * override map is empty (no live drag) the input is returned
 * unchanged.
 */
export function wallFloorplanSiblingOverrides(args: {
  nodeId: AnyNodeId
  nodes: Record<AnyNodeId, AnyNode>
  liveTransforms?: Map<string, LiveTransform>
  liveOverrides: Map<string, Record<string, unknown>>
}): Record<AnyNodeId, AnyNode> {
  const { nodes, liveOverrides, liveTransforms } = args
  if (liveOverrides.size === 0 && !liveTransforms?.size) return nodes
  let out: Record<AnyNodeId, AnyNode> | null = null
  const ids = new Set([...liveOverrides.keys(), ...(liveTransforms?.keys() ?? [])])
  for (const id of ids) {
    const existing = nodes[id as AnyNodeId]
    if (existing?.type !== 'wall' && existing?.type !== 'door' && existing?.type !== 'window') {
      continue
    }
    const override = liveOverrides.get(id)
    const liveTransform = liveTransforms?.get(id)
    const livePosition =
      liveTransform && (existing.type === 'door' || existing.type === 'window')
        ? { position: liveTransform.position }
        : undefined
    if ((!override || Object.keys(override).length === 0) && !livePosition) continue
    if (!out) out = { ...nodes }
    out[id as AnyNodeId] = { ...existing, ...override, ...livePosition } as AnyNode
  }
  return out ?? nodes
}
