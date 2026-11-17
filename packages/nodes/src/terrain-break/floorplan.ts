import type { FloorplanGeometry, GeometryContext, TerrainBreakNode } from '@pascal-app/core'

export function buildTerrainBreakFloorplan(
  node: TerrainBreakNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const marked = ctx.viewState?.selected || ctx.viewState?.highlighted
  return {
    kind: 'polyline',
    points: node.line,
    fill: 'none',
    stroke: marked ? (ctx.viewState?.palette?.selectedStroke ?? '#0ea5e9') : '#6f6a62',
    strokeWidth: node.kind === 'retaining' ? 2.5 : 1.5,
    strokeLinejoin: 'miter',
    vectorEffect: 'non-scaling-stroke',
  }
}
