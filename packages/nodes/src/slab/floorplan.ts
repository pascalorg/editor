import {
  type FloorplanGeometry,
  type FloorplanPoint,
  getRenderableSlabPolygon,
  type SlabNode,
} from '@pascal-app/core'

/**
 * Stage C floor-plan builder for slab. Renders the slab polygon as a
 * filled path with holes cut out.
 *
 * Uses `getRenderableSlabPolygon` (the same helper the legacy
 * floorplan-panel.tsx uses) to compute the visual polygon — accounts
 * for wall-clipping when a slab is auto-generated from walls.
 */
export function buildSlabFloorplan(node: SlabNode): FloorplanGeometry | null {
  const polygon = node.polygon
  if (!polygon || polygon.length < 3) return null

  const visualPolygon = getRenderableSlabPolygon(node)
  if (!visualPolygon || visualPolygon.length < 3) return null

  const outer: FloorplanPoint[] = visualPolygon.map(([x, z]) => [x, z] as FloorplanPoint)

  // SVG path with outer ring + hole subpaths. Each subpath uses M/L
  // commands + Z to close. Holes follow the outer ring; FloorplanGeometry
  // 'path' kind supports this natively (renderer passes the `d` string
  // straight to the SVG <path>).
  const segments: string[] = []
  const ring = (points: FloorplanPoint[]) => {
    const [first, ...rest] = points
    if (!first) return ''
    return [`M ${first[0]} ${first[1]}`, ...rest.map(([x, y]) => `L ${x} ${y}`), 'Z'].join(' ')
  }
  segments.push(ring(outer))

  const holes = node.holes ?? []
  for (const hole of holes) {
    if (hole.length < 3) continue
    const holePts: FloorplanPoint[] = hole.map(([x, z]) => [x, z] as FloorplanPoint)
    segments.push(ring(holePts))
  }

  return {
    kind: 'path',
    d: segments.join(' '),
    fill: '#cbd5e1',
    stroke: '#475569',
    strokeWidth: 0.03,
    opacity: 0.85,
  }
}
