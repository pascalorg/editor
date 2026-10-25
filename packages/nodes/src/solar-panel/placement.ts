import {
  difference,
  intersection,
  type Ring,
  type RoofSegmentNode,
  type SolarPanelNode,
} from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import { roofFootprintInsideTrim } from '../shared/roof-footprint-trim'
import { getRoofSurfaceFaceBoundsAt } from '../shared/roof-surface'
import { solarPanelFootprint } from './auto-fit'
export function resolveSolarPanelPlacement(
  segment: RoofSegmentNode,
  node: SolarPanelNode,
  x: number,
  z: number,
  options: { gridStep?: number; obstacles?: readonly Ring[] } = {},
) {
  const step = options.gridStep ?? 0
  if (step > 0) {
    x = Math.round(x / step) * step
    z = Math.round(z / step) * step
  }
  const frame = getRoofOuterSurfaceFrameAtPoint(segment, x, z)
  const position: [number, number, number] = [x, frame.point.y, z]
  const footprint = solarPanelFootprint(segment, { ...node, position })
  const face = getRoofSurfaceFaceBoundsAt(segment, x, z).polygon
  return {
    position,
    rotation: node.rotation,
    surfaceNormal: [frame.normal.x, frame.normal.y, frame.normal.z] as [number, number, number],
    valid:
      roofFootprintInsideTrim(segment, footprint) &&
      difference(footprint, face, { throwOnError: true }).length === 0 &&
      !(options.obstacles ?? []).some((o) => intersection(footprint, o).length > 0),
  }
}
