import type { AnyNode, AnyNodeId, LiveTransformLike } from '@pascal-app/core'

const isRoofPart = (node: AnyNode | undefined) =>
  node?.type === 'roof' || node?.type === 'roof-segment'

/**
 * A roof's plan is drawn by the roof node from its segments (`ctx.children`) and its level's
 * other roofs (`ctx.siblings`), which a drag moves through live overrides and transforms, not the
 * scene. Projecting those into the builder's snapshot keeps the outline, ridges, hips and valleys
 * on the segment while it is moved, resized or turned, in 2D or 3D.
 */
export function roofFloorplanSiblingOverrides(args: {
  nodeId: AnyNodeId
  nodes: Record<AnyNodeId, AnyNode>
  liveTransforms: Map<string, LiveTransformLike>
  liveOverrides: Map<string, Record<string, unknown>>
}): Record<AnyNodeId, AnyNode> {
  const { nodes, liveOverrides, liveTransforms } = args
  if (liveOverrides.size === 0 && liveTransforms.size === 0) return nodes

  let out: Record<AnyNodeId, AnyNode> | null = null
  for (const [id, live] of liveTransforms) {
    const existing = nodes[id as AnyNodeId]
    if (!isRoofPart(existing)) continue
    out ??= { ...nodes }
    out[id as AnyNodeId] = {
      ...existing,
      position: live.position,
      rotation: live.rotation,
    } as AnyNode
  }
  for (const [id, override] of liveOverrides) {
    const existing = out?.[id as AnyNodeId] ?? nodes[id as AnyNodeId]
    if (!isRoofPart(existing) || Object.keys(override).length === 0) continue
    out ??= { ...nodes }
    out[id as AnyNodeId] = { ...existing, ...override } as AnyNode
  }
  return out ?? nodes
}

/**
 * The roofs whose plan a live roof or segment edit changes: every roof on its level, since a
 * wing's ridge runs on to the main roof's slope and their valleys are drawn by one of the two.
 */
export function roofFloorplanAffectedIds(args: {
  node: AnyNode
  nodes: Record<AnyNodeId, AnyNode>
}): readonly AnyNodeId[] {
  const { node, nodes } = args
  const roof =
    node.type === 'roof-segment' && node.parentId ? nodes[node.parentId as AnyNodeId] : node
  if (roof?.type !== 'roof') return []
  const level = roof.parentId ? nodes[roof.parentId as AnyNodeId] : undefined
  const onLevel = (level as { children?: AnyNodeId[] } | undefined)?.children ?? []
  const roofs = onLevel.filter((id) => id !== roof.id && nodes[id]?.type === 'roof')
  return [roof.id as AnyNodeId, ...roofs]
}
