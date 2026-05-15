import type { CeilingNode, FloorplanGeometry, FloorplanPoint } from '@pascal-app/core'

/**
 * Stage C floor-plan builder for ceiling. Renders the polygon outline
 * as a dashed boundary (ceilings are above and would visually obscure
 * the slab/walls if drawn solid). Same shape as slab but visually
 * distinct.
 */
export function buildCeilingFloorplan(node: CeilingNode): FloorplanGeometry | null {
  const polygon = node.polygon
  if (!polygon || polygon.length < 3) return null

  const outer: FloorplanPoint[] = polygon.map(([x, z]) => [x, z] as FloorplanPoint)

  const ring = (points: FloorplanPoint[]) => {
    const [first, ...rest] = points
    if (!first) return ''
    return [`M ${first[0]} ${first[1]}`, ...rest.map(([x, y]) => `L ${x} ${y}`), 'Z'].join(' ')
  }

  const segments: string[] = [ring(outer)]
  const holes = node.holes ?? []
  for (const hole of holes) {
    if (hole.length < 3) continue
    segments.push(ring(hole.map(([x, z]) => [x, z] as FloorplanPoint)))
  }

  return {
    kind: 'path',
    d: segments.join(' '),
    fill: 'none',
    stroke: '#94a3b8',
    strokeWidth: 0.03,
    strokeDasharray: '0.15 0.1',
    opacity: 0.7,
  }
}
