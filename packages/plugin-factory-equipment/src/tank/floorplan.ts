import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import type { FactoryTankNode } from './schema'

function chromeStroke(ctx: GeometryContext): string | null {
  const view = ctx.viewState
  const palette = view?.palette
  if ((view?.selected || view?.highlighted) && palette) return palette.selectedStroke
  if (view?.hovered && palette) return palette.wallHoverStroke
  return null
}

export function buildTankFloorplan(node: FactoryTankNode, ctx: GeometryContext): FloorplanGeometry {
  const [px, , pz] = node.position
  const ry = node.rotation[1] ?? 0
  const stroke = chromeStroke(ctx) ?? '#0f172a'
  const selected = ctx.viewState?.selected ?? false
  const children: FloorplanGeometry[] =
    node.orientation === 'horizontal'
      ? [
          {
            kind: 'rect',
            x: -node.length / 2,
            y: -node.width / 2,
            width: node.length,
            height: node.width,
            rx: node.width / 2,
            ry: node.width / 2,
            fill: node.shellColor,
            fillOpacity: 0.2,
            stroke,
            strokeWidth: 0.025,
          },
        ]
      : [
          {
            kind: 'circle',
            cx: 0,
            cy: 0,
            r: Math.min(node.length, node.width) / 2,
            fill: node.shellColor,
            fillOpacity: 0.2,
            stroke,
            strokeWidth: 0.025,
          },
        ]
  children.push(
    {
      kind: 'circle',
      cx: -node.length / 2,
      cy: 0,
      r: Math.max(0.04, node.inletDiameter * 0.35),
      fill: '#f8fafc',
      stroke,
      strokeWidth: 0.018,
    },
    {
      kind: 'circle',
      cx: node.length / 2,
      cy: 0,
      r: Math.max(0.04, node.outletDiameter * 0.35),
      fill: '#f8fafc',
      stroke,
      strokeWidth: 0.018,
    },
  )
  if (selected) children.push({ kind: 'move-handle', point: [0, 0] })
  return { kind: 'group', transform: { translate: [px, pz], rotate: ry }, children }
}
