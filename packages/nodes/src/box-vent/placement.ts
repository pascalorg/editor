import { type BoxVentNode, difference, type Ring, type RoofSegmentNode } from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import * as THREE from 'three'
import { roofFootprintInsideTrim } from '../shared/roof-footprint-trim'
import {
  getDownSlopeYaw,
  getRoofSurfaceFaceBoundsAt,
  surfaceQuatFromNormal,
} from '../shared/roof-surface'

export function resolveBoxVentPlacement(
  segment: RoofSegmentNode,
  node: BoxVentNode,
  x: number,
  z: number,
  options: { gridStep?: number; roofOffset?: number; alignDownslope?: boolean } = {},
) {
  const step = options.gridStep ?? 0
  if (step > 0) {
    x = Math.round(x / step) * step
    z = Math.round(z / step) * step
  }
  const frame = getRoofOuterSurfaceFrameAtPoint(segment, x, z)
  const rotation = options.alignDownslope ? getDownSlopeYaw(x, z, segment) : node.rotation
  const quat = surfaceQuatFromNormal(frame.normal, new THREE.Quaternion()).multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation),
  )
  const extra =
    Math.max(0, node.flashingWidth ?? 0) +
    (node.style === 'box' ? 0 : Math.max(0, node.hoodOverhang ?? 0.04))
  const hw = node.width / 2 + extra
  const hd = node.depth / 2 + extra
  const footprint: Ring = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([px, pz]) => {
    const point = new THREE.Vector3(px, 0, pz).applyQuaternion(quat)
    return [x + point.x, z + point.z]
  })
  const face = getRoofSurfaceFaceBoundsAt(segment, x, z).polygon
  return {
    position: [x, frame.point.y + (options.roofOffset ?? 0), z] as [number, number, number],
    rotation,
    valid:
      roofFootprintInsideTrim(segment, footprint) &&
      difference(footprint, face, { throwOnError: true }).length === 0,
  }
}
