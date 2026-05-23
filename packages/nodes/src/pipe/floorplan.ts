import {
  type FloorplanGeometry,
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  isPipeNearlyVertical,
  sampleWallCenterline,
} from '@pascal-app/core'
import type { PipeNode } from './schema'

function buildCenterlinePathD(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length < 2) return ''
  const first = points[0]!
  return [`M ${first.x} ${first.y}`, ...points.slice(1).map((p) => `L ${p.x} ${p.y}`)].join(' ')
}

function getPlanLength(node: PipeNode): number {
  return isCurvedWall(node)
    ? getWallCurveLength(node)
    : Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1])
}

export function buildPipeFloorplan(node: PipeNode): FloorplanGeometry {
  if (isPipeNearlyVertical(node)) {
    const [x, z] = node.start
    return {
      kind: 'group',
      children: [
        {
          kind: 'circle',
          cx: x,
          cy: z,
          r: Math.max(node.diameter * 0.6, 0.08),
          fill: node.color,
          stroke: '#1f2937',
          strokeWidth: 1.5,
        },
        {
          kind: 'text',
          x,
          y: z - 0.18,
          text: `${Math.round(node.rotate)}°`,
          fontSize: 0.11,
          fill: '#111827',
          textAnchor: 'middle',
        },
      ],
    }
  }

  const centerline = sampleWallCenterline(node, 24)
  const pathD = buildCenterlinePathD(centerline)
  const length = getPlanLength(node)
  const mid = getWallCurveFrameAt(node, 0.5).point

  return {
    kind: 'group',
    children: [
      {
        kind: 'path',
        d: pathD,
        stroke: node.color,
        strokeWidth: Math.max(node.diameter * 40, 3),
        fill: 'none',
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'circle',
        cx: node.start[0],
        cy: node.start[1],
        r: 0.06,
        fill: '#ffffff',
        stroke: '#374151',
        strokeWidth: 1,
      },
      {
        kind: 'circle',
        cx: node.end[0],
        cy: node.end[1],
        r: 0.06,
        fill: '#ffffff',
        stroke: '#374151',
        strokeWidth: 1,
      },
      ...(length > 0.5
        ? [
            {
              kind: 'text' as const,
              x: mid.x,
              y: mid.y - 0.14,
              text: `${length.toFixed(1)}m`,
              fontSize: 0.11,
              fill: '#111827',
              textAnchor: 'middle' as const,
            },
          ]
        : []),
    ],
  }
}
