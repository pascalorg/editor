import {
  type FenceFeatureData,
  type FenceFeatureNode,
  type FenceNode,
  type FloorplanGeometry,
  fenceFeatureData,
  type GeometryContext,
  getFenceCenterlineFrameAt,
  getFenceCenterlineLength,
  getFenceGateLeaves,
} from '@pascal-app/core'
export function buildFenceFeatureFloorplan(
  child: FenceFeatureNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const node = ctx.parent
  if (node?.type !== 'fence') return null
  return buildFenceFeatureSymbol(fenceFeatureData(child), node, ctx)
}

export function buildFenceFeatureSymbol(
  data: FenceFeatureData,
  node: FenceNode,
  ctx: GeometryContext,
  interactive = true,
): FloorplanGeometry {
  const length = Math.max(getFenceCenterlineLength(node), 0.001)
  const feature = {
    ...data,
    startT: (data.center - data.width / 2) / length,
    endT: (data.center + data.width / 2) / length,
    centerT: data.center / length,
  }
  const features = [feature]
  const isSelected = interactive && (ctx.viewState?.selected ?? false)
  const accentStroke = isSelected
    ? (ctx.viewState?.palette?.selectedStroke ?? '#8381ed')
    : ctx.viewState?.hovered
      ? '#8381ed'
      : '#111827'
  const markerSurface = '#ffffff'
  const children: FloorplanGeometry[] = []
  for (const feature of features) {
    const start = getFenceCenterlineFrameAt(node, feature.startT).point
    const end = getFenceCenterlineFrameAt(node, feature.endT).point
    if (feature.showPosts !== false)
      for (const point of [start, end]) {
        children.push({
          kind: 'circle',
          cx: point.x,
          cy: point.y,
          r: Math.max(node.postSize / 2, 0.04),
          fill: markerSurface,
          stroke: accentStroke,
          strokeWidth: 1.5,
          vectorEffect: 'non-scaling-stroke',
        })
      }
    if (feature.kind === 'gate') {
      for (const leaf of getFenceGateLeaves(node, feature)) {
        children.push({
          kind: 'line',
          x1: leaf.hinge.x,
          y1: leaf.hinge.y,
          x2: leaf.end.x,
          y2: leaf.end.y,
          stroke: accentStroke,
          strokeWidth: 3,
          vectorEffect: 'non-scaling-stroke',
        })
        children.push({
          kind: 'hit-line',
          x1: leaf.hinge.x,
          y1: leaf.hinge.y,
          x2: leaf.end.x,
          y2: leaf.end.y,
          strokeWidthPx: 16,
          cursor: 'pointer',
        })
        const angle = leaf.rotation - leaf.closedAngle
        if (Math.abs(angle) > 0.001) {
          const x = leaf.hinge.x + Math.cos(leaf.closedAngle) * leaf.width
          const y = leaf.hinge.y + Math.sin(leaf.closedAngle) * leaf.width
          children.push({
            kind: 'path',
            d: `M ${x} ${y} A ${leaf.width} ${leaf.width} 0 0 ${angle > 0 ? 1 : 0} ${leaf.end.x} ${leaf.end.y}`,
            fill: 'none',
            stroke: accentStroke,
            strokeWidth: 1,
            strokeDasharray: '4 3',
            vectorEffect: 'non-scaling-stroke',
          })
        }
      }
    }
    if (isSelected) {
      for (const [edge, point] of [
        ['start', start],
        ['center', getFenceCenterlineFrameAt(node, feature.centerT).point],
        ['end', end],
      ] as const) {
        children.push({
          kind: 'endpoint-handle',
          point: [point.x, point.y],
          state: 'idle',
          variant: 'curve',
          affordance: 'move-feature',
          payload: { edge },
        })
      }
    }
  }

  if (data.kind === 'opening') {
    const a = getFenceCenterlineFrameAt(node, feature.startT).point
    const b = getFenceCenterlineFrameAt(node, feature.endT).point
    children.push({
      kind: 'line',
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      stroke: accentStroke,
      strokeWidth: 1.5,
      strokeDasharray: '4 3',
      vectorEffect: 'non-scaling-stroke',
    })
    children.push({
      kind: 'hit-line',
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      strokeWidthPx: 18,
      cursor: 'pointer',
    })
  }
  return { kind: 'group', children }
}
