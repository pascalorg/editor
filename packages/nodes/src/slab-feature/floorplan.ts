import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  resolveSlabFeaturePlacement,
  type SlabFeatureNode,
  slabFeatureFootprint,
} from '@pascal-app/core'

export function slabFeatureFloorplanDependencies(
  node: SlabFeatureNode,
  nodes: Readonly<Record<string, AnyNode>>,
) {
  const ids: AnyNodeId[] = []
  let current: AnyNode | undefined = node
  while (current?.parentId && !ids.includes(current.parentId as AnyNodeId)) {
    ids.push(current.parentId as AnyNodeId)
    current = nodes[current.parentId]
  }
  return ids
}
export function buildSlabFeatureFloorplan(
  node: SlabFeatureNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const nodes: Record<string, AnyNode> = { ...ctx.sceneNodes, [node.id]: node }
  let id = node.parentId
  while (id && !nodes[id]) {
    const parent = ctx.resolve<AnyNode>(id as AnyNodeId)
    if (!parent) break
    nodes[id] = parent
    id = parent.parentId
  }
  let p
  try {
    p = resolveSlabFeaturePlacement(nodes, node)
  } catch {
    return null
  }
  if (
    !node.visible ||
    slabFeatureFloorplanDependencies(node, nodes).some((id) => nodes[id]?.visible === false)
  )
    return null
  const selected = ctx.viewState?.selected,
    color =
      selected || ctx.viewState?.hovered
        ? (ctx.viewState?.palette.selectedStroke ?? '#8381ed')
        : '#374151'
  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: slabFeatureFootprint(p),
      fill: node.mode === 'niche' ? '#ffffff' : '#c4b5fd',
      fillOpacity: 0.5,
      stroke: color,
      strokeWidth: 1.5,
      vectorEffect: 'non-scaling-stroke',
      strokeDasharray: node.mode === 'niche' ? '3 2' : undefined,
    },
    {
      kind: 'text',
      x: p.x,
      y: p.z,
      text: node.mode === 'niche' ? 'N ↓' : 'B ↑',
      fontSize: 0.12,
      fill: color,
      textAnchor: 'middle',
    },
  ]
  if (selected) {
    for (const [action, point] of [
      ['width-start', [p.bounds.x0, p.z]],
      ['width-end', [p.bounds.x1, p.z]],
      ['length-start', [p.x, p.bounds.z0]],
      ['length-end', [p.x, p.bounds.z1]],
    ] as const)
      children.push({
        kind: 'endpoint-handle',
        point: [...point],
        state: 'idle',
        variant: 'curve',
        affordance: 'edit-feature',
        payload: { action },
      })
    children.push({ kind: 'move-handle', point: [p.x, p.z] })
  }
  return { kind: 'group', children }
}
