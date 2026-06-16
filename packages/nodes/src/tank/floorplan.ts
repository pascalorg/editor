import type { FloorplanGeometry, TankNode } from '@pascal-app/core'

export function buildTankFloorplan(node: TankNode): FloorplanGeometry {
  const [px, , pz] = node.position
  const ry = node.rotation[1] ?? 0
  const radius = node.diameter / 2

  if (node.kind === 'horizontal') {
    return {
      kind: 'group',
      transform: { translate: [px, pz], rotate: ry },
      children: [
        {
          kind: 'rect',
          x: -node.length / 2,
          y: -radius,
          width: node.length,
          height: node.diameter,
          rx: radius,
          ry: radius,
          fill: '#cbd5e1',
          stroke: '#334155',
          strokeWidth: 0.025,
          opacity: 0.9,
        },
        {
          kind: 'line',
          x1: -node.length / 2,
          y1: radius - node.diameter * node.liquidLevel,
          x2: node.length / 2,
          y2: radius - node.diameter * node.liquidLevel,
          stroke: node.liquidColor,
          strokeWidth: 0.035,
          strokeLinecap: 'round',
          opacity: 0.9,
        },
      ],
    }
  }

  if (node.kind === 'spherical') {
    const legOffset = radius * 0.62
    return {
      kind: 'group',
      transform: { translate: [px, pz], rotate: ry },
      children: [
        {
          kind: 'circle',
          cx: 0,
          cy: 0,
          r: radius,
          fill: '#cbd5e1',
          stroke: '#334155',
          strokeWidth: 0.025,
          opacity: 0.9,
        },
        {
          kind: 'circle',
          cx: 0,
          cy: 0,
          r: Math.max(0.02, radius * Math.sqrt(node.liquidLevel)),
          fill: node.liquidColor,
          fillOpacity: 0.35,
          stroke: node.liquidColor,
          strokeWidth: 0.015,
          opacity: 0.8,
        },
        ...[-1, 1].flatMap((xSign) =>
          [-1, 1].map((ySign) => ({
            kind: 'circle' as const,
            cx: xSign * legOffset,
            cy: ySign * legOffset,
            r: Math.max(0.025, radius * 0.055),
            fill: '#64748b',
            stroke: '#334155',
            strokeWidth: 0.01,
            opacity: 0.95,
          })),
        ),
      ],
    }
  }

  return {
    kind: 'group',
    transform: { translate: [px, pz], rotate: ry },
    children: [
      {
        kind: 'circle',
        cx: 0,
        cy: 0,
        r: radius,
        fill: '#cbd5e1',
        stroke: '#334155',
        strokeWidth: 0.025,
        opacity: 0.9,
      },
      {
        kind: 'circle',
        cx: 0,
        cy: 0,
        r: Math.max(0.02, radius * Math.sqrt(node.liquidLevel)),
        fill: node.liquidColor,
        fillOpacity: 0.35,
        stroke: node.liquidColor,
        strokeWidth: 0.015,
        opacity: 0.8,
      },
    ],
  }
}
