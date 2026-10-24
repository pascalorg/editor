import { type DormerNode, difference, type Ring, type RoofSegmentNode } from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import { roofFootprintInsideTrim } from '../shared/roof-footprint-trim'
import { getRoofSurfaceFaceBoundsAt } from '../shared/roof-surface'

export function resolveDormerPlacement(
  segment: RoofSegmentNode,
  node: DormerNode,
  x: number,
  z: number,
  options: { gridStep?: number; surfaceOffset?: number } = {},
) {
  const step = options.gridStep ?? 0
  if (step > 0) {
    x = Math.round(x / step) * step
    z = Math.round(z / step) * step
  }
  const halfW = Math.max(0.05, node.width) / 2 + 0.12
  const halfD = Math.max(0.05, node.depth) / 2 + 0.12
  const c = Math.cos(node.rotation),
    s = Math.sin(node.rotation)
  const footprint: Ring = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([px, pz]) => [x + px! * c + pz! * s, z - px! * s + pz! * c])
  return {
    position: [
      x,
      getRoofOuterSurfaceFrameAtPoint(segment, x, z).point.y + (options.surfaceOffset ?? 0),
      z,
    ] as [number, number, number],
    valid:
      roofFootprintInsideTrim(segment, footprint) &&
      difference(footprint, getRoofSurfaceFaceBoundsAt(segment, x, z).polygon, {
        throwOnError: true,
      }).length === 0,
  }
}
