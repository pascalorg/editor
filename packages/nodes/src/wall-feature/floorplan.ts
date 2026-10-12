import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  resolveWallFeaturePlacement,
  type WallFeatureNode,
  type WallFeaturePlacement,
} from '@pascal-app/core'

export const WALL_FEATURE_PLAN_CUT_HEIGHT = 1.2
export function wallFeaturePlanPoint(
  p: WallFeaturePlacement,
  u: number,
  n: number,
): [number, number] {
  return [
    p.wall.start[0] + p.tangent[0] * u - p.tangent[2] * n,
    p.wall.start[1] + p.tangent[2] * u + p.tangent[0] * n,
  ]
}
export function wallFeatureFloorplanDependencies(
  node: WallFeatureNode,
  nodes: Readonly<Record<string, AnyNode>>,
) {
  const ids: AnyNodeId[] = []
  let current: AnyNode | undefined = node
  const seen = new Set<string>()
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId)
    ids.push(current.parentId as AnyNodeId)
    current = nodes[current.parentId]
    if (current?.type === 'level')
      for (const candidate of Object.values(nodes))
        if (candidate.type === 'slab' && candidate.parentId === current.id) ids.push(candidate.id)
  }
  return ids
}
export function buildWallFeatureFloorplan(
  node: WallFeatureNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const nodes: Record<string, AnyNode> = { ...ctx.sceneNodes, [node.id]: node }
  if (!nodes[node.parentId ?? ''] && ctx.parent) nodes[ctx.parent.id] = ctx.parent
  let ancestor = node.parentId
  const seen = new Set<string>()
  while (ancestor && !seen.has(ancestor)) {
    seen.add(ancestor)
    const host = nodes[ancestor] ?? ctx.resolve(ancestor as AnyNodeId)
    if (!host) break
    nodes[ancestor] = host
    ancestor = host.parentId
  }
  let p: WallFeaturePlacement
  try {
    p = resolveWallFeaturePlacement(nodes, node)
  } catch {
    return null
  }
  if (
    !node.visible ||
    wallFeatureFloorplanDependencies(node, nodes).some((id) => nodes[id]?.visible === false)
  )
    return null
  const selected = ctx.viewState?.selected ?? false
  const color = selected
    ? (ctx.viewState?.palette.selectedStroke ?? '#8381ed')
    : ctx.viewState?.hovered
      ? '#8381ed'
      : '#374151'
  const cutHeight = p.wallBase + WALL_FEATURE_PLAN_CUT_HEIGHT
  const cut = p.bottom > cutHeight ? 'above' : p.bottom + node.height < cutHeight ? 'below' : 'cut'
  const a = wallFeaturePlanPoint(p, p.bounds.u0, p.mountOffset),
    b = wallFeaturePlanPoint(p, p.bounds.u1, p.mountOffset)
  const c = wallFeaturePlanPoint(p, p.bounds.u1, p.surfaceOffset),
    d = wallFeaturePlanPoint(p, p.bounds.u0, p.surfaceOffset)
  const middle = wallFeaturePlanPoint(p, p.u, p.surfaceOffset)
  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: [a, b, c, d],
      fill: node.mode === 'niche' ? '#ffffff' : '#c4b5fd',
      fillOpacity: cut === 'cut' ? 0.85 : 0.35,
      stroke: color,
      strokeWidth: 1.5,
      vectorEffect: 'non-scaling-stroke',
      strokeDasharray: cut === 'above' ? '5 3' : cut === 'below' ? '2 2' : undefined,
    },
    { kind: 'hit-line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], strokeWidthPx: 12 },
    {
      kind: 'text',
      x: middle[0],
      y: middle[1],
      text: `${node.mode === 'niche' ? 'N' : 'B'}${cut === 'above' ? ' ↑' : cut === 'below' ? ' ↓' : ''}`,
      fontSize: 0.12,
      fill: color,
      textAnchor: 'middle',
    },
  ]
  if (selected) {
    for (const [action, point] of [
      ['width-start', a],
      ['width-end', b],
      ['depth', middle],
    ] as const) {
      children.push({
        kind: 'endpoint-handle',
        point,
        state: 'idle',
        variant: 'curve',
        affordance: 'edit-feature',
        payload: { action },
      })
    }
  }
  if (selected) {
    const sign = p.face === 'a' ? 1 : -1
    const outside = sign * Math.max(sign * p.mountOffset, sign * p.surfaceOffset) + sign * 0.2
    children.push({ kind: 'move-handle', point: wallFeaturePlanPoint(p, p.u, outside) })
  }
  return { kind: 'group', children, metadata: { wallFeature: { mode: node.mode, cut, cutHeight } } }
}
