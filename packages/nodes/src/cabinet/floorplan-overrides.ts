import type { AnyNode, AnyNodeId, LiveTransformLike } from '@pascal-app/core'

/**
 * Cabinet floor-plan symbols resolve their full cabinet ancestry through
 * `ctx.parent` / `ctx.resolve` (run -> module -> child run ...). During live
 * drags only the directly moved cabinet nodes publish overrides, so we need to
 * project those cabinet/cabinet-module patches into the context snapshot that
 * the floor-plan builders read. That keeps every related cabinet symbol in
 * lockstep while the drag is still in flight.
 */
export function cabinetFloorplanSiblingOverrides(args: {
  nodeId: AnyNodeId
  nodes: Record<AnyNodeId, AnyNode>
  liveTransforms: Map<string, LiveTransformLike>
  liveOverrides: Map<string, Record<string, unknown>>
}): Record<AnyNodeId, AnyNode> {
  const { nodes, liveOverrides, liveTransforms } = args
  if (liveOverrides.size === 0 && liveTransforms.size === 0) return nodes

  let out: Record<AnyNodeId, AnyNode> | null = null
  const applyLiveTransform = (node: AnyNode, live: LiveTransformLike): AnyNode => {
    if (!Array.isArray((node as { position?: unknown }).position)) return node
    const rotation = (node as { rotation?: unknown }).rotation
    return {
      ...node,
      position: live.position,
      rotation:
        typeof rotation === 'number'
          ? live.rotation
          : Array.isArray(rotation)
            ? [(rotation[0] as number) ?? 0, live.rotation, (rotation[2] as number) ?? 0]
            : rotation,
    } as AnyNode
  }

  for (const [id, live] of liveTransforms) {
    const existing = nodes[id as AnyNodeId]
    if (existing?.type !== 'cabinet' && existing?.type !== 'cabinet-module') continue
    if (!out) out = { ...nodes }
    out[id as AnyNodeId] = applyLiveTransform(out?.[id as AnyNodeId] ?? existing, live)
  }
  for (const [id, override] of liveOverrides) {
    const existing = (out?.[id as AnyNodeId] ?? nodes[id as AnyNodeId]) as AnyNode | undefined
    if (existing?.type !== 'cabinet' && existing?.type !== 'cabinet-module') continue
    if (Object.keys(override).length === 0) continue
    if (!out) out = { ...nodes }
    out[id as AnyNodeId] = { ...existing, ...override } as AnyNode
  }

  return out ?? nodes
}
