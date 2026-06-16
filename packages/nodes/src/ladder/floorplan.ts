import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import type { LadderNode } from './schema'

export function buildLadderFloorplan(node: LadderNode, ctx: GeometryContext): FloorplanGeometry {
  const active = ctx.viewState?.selected || ctx.viewState?.highlighted
  const stroke = active && ctx.viewState?.palette ? ctx.viewState.palette.selectedStroke : '#475569'
  return {
    kind: 'group',
    transform: {
      translate: [node.position[0], node.position[2]],
      rotate: node.rotation[1] ?? 0,
    },
    children: [
      {
        kind: 'rect',
        x: -node.width / 2,
        y: -Math.max(0.08, node.standoffDepth),
        width: node.width,
        height: Math.max(0.12, node.standoffDepth + 0.12),
        fill: '#e2e8f0',
        stroke,
        strokeWidth: active ? 0.045 : 0.025,
        opacity: 0.75,
      },
      {
        kind: 'line',
        x1: -node.width / 2,
        y1: 0,
        x2: node.width / 2,
        y2: 0,
        stroke: '#334155',
        strokeWidth: 2,
        vectorEffect: 'non-scaling-stroke',
      },
      { kind: 'move-handle', point: [0, 0] },
    ],
  }
}

