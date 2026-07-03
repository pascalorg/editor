import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import type { FactoryPumpNode } from './schema'

function chromeStroke(ctx: GeometryContext): string | null {
  const view = ctx.viewState
  const palette = view?.palette
  if ((view?.selected || view?.highlighted) && palette) return palette.selectedStroke
  if (view?.hovered && palette) return palette.wallHoverStroke
  return null
}

export function buildPumpFloorplan(node: FactoryPumpNode, ctx: GeometryContext): FloorplanGeometry {
  const [px, , pz] = node.position
  const ry = node.rotation[1] ?? 0
  const halfLength = node.length / 2
  const halfWidth = node.width / 2
  const stroke = chromeStroke(ctx) ?? '#0f172a'
  const casingRadius = Math.min(node.length, node.width) * 0.22
  const motorWidth = Math.max(0.28, node.width * 0.42)
  const motorLength = Math.max(0.42, node.length * 0.26)
  const portRadius = Math.max(0.04, node.inletDiameter * 0.35)
  const selected = ctx.viewState?.selected ?? false

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -halfLength,
      y: -halfWidth,
      width: node.length,
      height: node.width,
      fill: node.skidMounted ? '#e2e8f0' : 'transparent',
      stroke,
      strokeWidth: 0.025,
      opacity: 0.92,
    },
    {
      kind: 'circle',
      cx: -node.length * 0.18,
      cy: 0,
      r: casingRadius,
      fill: node.casingColor,
      fillOpacity: 0.22,
      stroke,
      strokeWidth: 0.025,
    },
    {
      kind: 'rect',
      x: node.length * 0.08,
      y: -motorWidth / 2,
      width: motorLength,
      height: motorWidth,
      fill: node.motorColor,
      fillOpacity: 0.18,
      stroke,
      strokeWidth: 0.02,
    },
    {
      kind: 'line',
      x1: -halfLength,
      y1: 0,
      x2: -node.length * 0.18 - casingRadius,
      y2: 0,
      stroke,
      strokeWidth: 0.03,
    },
    {
      kind: 'line',
      x1: -node.length * 0.18 + casingRadius,
      y1: 0,
      x2: halfLength,
      y2: 0,
      stroke,
      strokeWidth: 0.03,
    },
    {
      kind: 'circle',
      cx: -halfLength,
      cy: 0,
      r: portRadius,
      fill: '#f8fafc',
      stroke,
      strokeWidth: 0.018,
    },
    {
      kind: 'circle',
      cx: halfLength,
      cy: 0,
      r: Math.max(0.04, node.outletDiameter * 0.35),
      fill: '#f8fafc',
      stroke,
      strokeWidth: 0.018,
    },
  ]
  if (selected) children.push({ kind: 'move-handle', point: [0, 0] })
  return { kind: 'group', transform: { translate: [px, pz], rotate: ry }, children }
}
