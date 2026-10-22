import {
  type CupolaNode,
  getRoofSegmentVisibleTopBounds,
  type Ring,
  type RoofSegmentNode,
} from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import { resolveRidgeSnap } from '../shared/ridge-snap'
import { roofFootprintInsideTrim } from '../shared/roof-footprint-trim'

export function cupolaMount(
  segment: RoofSegmentNode,
  node: CupolaNode,
  x = node.position[0],
  z = node.position[2],
) {
  const hw = Math.max(0.2, node.width) / 2
  const hd = Math.max(0.2, node.depth) / 2
  const extra = Math.min(hw, hd) * 0.12
  const corners = [
    [-hw - extra, -hd - extra],
    [hw + extra, -hd - extra],
    [hw + extra, hd + extra],
    [-hw - extra, hd + extra],
  ]
  const c = Math.cos(node.rotation),
    s = Math.sin(node.rotation)
  const heightAt = (px: number, pz: number) =>
    getRoofOuterSurfaceFrameAtPoint(segment, x + px * c + pz * s, z - px * s + pz * c).point.y
  const perimeter = corners.flatMap((a, i) => {
    const b = corners[(i + 1) % 4]!
    return Array.from({ length: 16 }, (_, j) => {
      const px = a[0]! + ((b[0]! - a[0]!) * j) / 16
      const pz = a[1]! + ((b[1]! - a[1]!) * j) / 16
      return [px, heightAt(px, pz), pz] as [number, number, number]
    })
  })
  const seatY = Math.max(heightAt(0, 0), ...perimeter.map((p) => p[1]))
  return {
    seatY,
    centerY: heightAt(0, 0),
    perimeter: perimeter.map(([px, y, pz]) => [px, y - seatY, pz] as [number, number, number]),
  }
}

export function resolveCupolaPlacement(
  segment: RoofSegmentNode,
  node: CupolaNode,
  x: number,
  z: number,
  options: { gridStep?: number; roofOffset?: number; alignRidge?: boolean } = {},
) {
  let rotation = node.rotation
  const step = options.gridStep ?? 0
  if (step > 0) {
    x = Math.round(x / step) * step
    z = Math.round(z / step) * step
  }
  if (
    options.alignRidge &&
    !['flat', 'shed', 'conical', 'barrel', 'glazed'].includes(segment.roofType)
  ) {
    const ridge = resolveRidgeSnap(segment, x, z)
    if (ridge) {
      x = ridge.localX
      z = ridge.localZ
      rotation = ridge.rotation
    }
  }
  const hw = Math.max(0.2, node.width) / 2,
    hd = Math.max(0.2, node.depth) / 2
  const extra = Math.min(hw, hd) * 0.22
  const c = Math.cos(rotation),
    s = Math.sin(rotation)
  const footprint: Ring = [
    [-hw - extra, -hd - extra],
    [hw + extra, -hd - extra],
    [hw + extra, hd + extra],
    [-hw - extra, hd + extra],
  ].map(([px, pz]) => [x + px! * c + pz! * s, z - px! * s + pz! * c])
  const bounds = getRoofSegmentVisibleTopBounds(segment)
  const valid =
    roofFootprintInsideTrim(segment, footprint) &&
    footprint.every(
      ([px, pz]) =>
        px >= bounds.minX && px <= bounds.maxX && pz >= bounds.minZ && pz <= bounds.maxZ,
    )
  return {
    position: [
      x,
      cupolaMount(segment, { ...node, rotation }, x, z).centerY + (options.roofOffset ?? 0),
      z,
    ] as [number, number, number],
    rotation,
    valid,
  }
}
