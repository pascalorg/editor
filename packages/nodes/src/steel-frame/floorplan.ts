import type { FloorplanGeometry } from '@pascal-app/core'
import type { SteelFrameNode } from './schema'

function gridPositions(count: number, span: number): number[] {
  if (count <= 1) return [0]
  return Array.from({ length: count }, (_, index) => -span / 2 + (span * index) / (count - 1))
}

export function buildSteelFrameFloorplan(node: SteelFrameNode): FloorplanGeometry {
  const [px, , pz] = node.position
  const ry = node.rotation[1] ?? 0
  const halfLength = node.length / 2
  const halfWidth = node.width / 2
  const xPositions = gridPositions(node.columns, node.length)
  const zPositions = gridPositions(node.rows, node.width)
  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -halfLength,
      y: -halfWidth,
      width: node.length,
      height: node.width,
      fill:
        node.style === 'equipment-platform' || node.style === 'tower-frame'
          ? '#cbd5e1'
          : 'transparent',
      stroke: '#334155',
      strokeWidth: 0.025,
      opacity: 0.9,
    },
  ]

  for (const x of xPositions) {
    children.push({
      kind: 'line',
      x1: x,
      y1: -halfWidth,
      x2: x,
      y2: halfWidth,
      stroke: '#475569',
      strokeWidth: 0.012,
      opacity: 0.75,
    })
  }
  for (const z of zPositions) {
    children.push({
      kind: 'line',
      x1: -halfLength,
      y1: z,
      x2: halfLength,
      y2: z,
      stroke: '#475569',
      strokeWidth: 0.012,
      opacity: 0.75,
    })
  }
  for (const x of xPositions) {
    for (const z of zPositions) {
      children.push({
        kind: 'circle',
        cx: x,
        cy: z,
        r: Math.max(0.05, node.memberSize * 0.45),
        fill: '#64748b',
        stroke: '#1e293b',
        strokeWidth: 0.01,
      })
    }
  }

  return {
    kind: 'group',
    transform: { translate: [px, pz], rotate: ry },
    children,
  }
}
