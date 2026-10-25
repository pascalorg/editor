import {
  type ChimneyNode,
  getRoofSegmentVisibleTopBounds,
  type Ring,
  type RoofSegmentNode,
} from '@pascal-app/core'
import { roofFootprintInsideTrim } from '../shared/roof-footprint-trim'

export function resolveChimneyPlacement(
  segment: RoofSegmentNode,
  node: ChimneyNode,
  x: number,
  z: number,
  gridStep = 0,
) {
  if (gridStep > 0) {
    x = Math.round(x / gridStep) * gridStep
    z = Math.round(z / gridStep) * gridStep
  }
  const extra = Math.max(
    node.cap && node.capShape !== 'none' ? node.capOverhang : 0,
    node.bandStyle !== 'none' ? node.bandExtent : 0,
    node.shoulderStyle !== 'none' ? node.shoulderExtent : 0,
  )
  const hw = node.width / 2 + extra
  const hd = (node.bodyShape === 'round' ? node.width : node.depth) / 2 + extra
  const c = Math.cos(node.rotation),
    s = Math.sin(node.rotation)
  const footprint: Ring = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([px, pz]) => [x + px! * c + pz! * s, z - px! * s + pz! * c])
  const bounds = getRoofSegmentVisibleTopBounds(segment)
  return {
    position: [x, 0, z] as [number, number, number],
    valid:
      roofFootprintInsideTrim(segment, footprint) &&
      footprint.every(
        ([px, pz]) =>
          px >= bounds.minX && px <= bounds.maxX && pz >= bounds.minZ && pz <= bounds.maxZ,
      ),
  }
}
