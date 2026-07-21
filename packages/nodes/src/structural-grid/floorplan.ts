import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  StructuralGridNode,
} from '@pascal-app/core'
import { withFloorplanGeometryMetadata } from '@pascal-app/editor'

const GRID_BUBBLE_RADIUS = 0.22
const GRID_LABEL_SIZE = 0.18

function bubble(point: FloorplanPoint, label: string, stroke: string): FloorplanGeometry {
  return {
    kind: 'group',
    children: [
      {
        kind: 'circle',
        cx: point[0],
        cy: point[1],
        r: GRID_BUBBLE_RADIUS,
        fill: '#ffffff',
        stroke,
        strokeWidth: 1.2,
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'text',
        x: point[0],
        y: point[1],
        text: label,
        fontSize: GRID_LABEL_SIZE,
        fill: stroke,
        fontWeight: 700,
        textAnchor: 'middle',
        dominantBaseline: 'middle',
        upright: true,
      },
    ],
  }
}

export function buildStructuralGridFloorplan(
  node: StructuralGridNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const length = Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1])
  if (length < 0.001) return null

  const selected = ctx.viewState?.selected ?? false
  const highlighted = ctx.viewState?.highlighted ?? false
  const palette = ctx.viewState?.palette
  const active = selected || highlighted
  const stroke = active && palette ? palette.selectedStroke : '#475569'
  const children: FloorplanGeometry[] = [
    {
      kind: 'line',
      x1: node.start[0],
      y1: node.start[1],
      x2: node.end[0],
      y2: node.end[1],
      stroke,
      strokeWidth: active ? 1.6 : 1,
      strokeDasharray: '10 4 2 4',
      vectorEffect: 'non-scaling-stroke',
      pointerEvents: 'stroke',
    },
  ]

  if (node.showStartBubble) children.push(bubble(node.start, node.label, stroke))
  if (node.showEndBubble) children.push(bubble(node.end, node.label, stroke))

  return withFloorplanGeometryMetadata(
    { kind: 'group', children },
    { annotationRole: 'structural-grid' },
  )
}
