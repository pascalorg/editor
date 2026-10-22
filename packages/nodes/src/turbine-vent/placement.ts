import { difference, type Ring, type RoofSegmentNode, type TurbineVentNode } from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import * as THREE from 'three'
import { roofFootprintInsideTrim } from '../shared/roof-footprint-trim'
import {
  getDownSlopeYaw,
  getRoofSurfaceFaceBoundsAt,
  surfaceQuatFromNormal,
} from '../shared/roof-surface'

export function resolveTurbineVentPlacement(
  segment: RoofSegmentNode,
  node: TurbineVentNode,
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
  const radius = Math.max(0.05, node.diameter / 2) + Math.max(0, node.baseOverhang)
  const footprint: Ring = Array.from({ length: 32 }, (_, i) => {
    const angle = (i * Math.PI * 2) / 32
    const px = radius * Math.cos(angle)
    const pz = radius * Math.sin(angle)
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
