import {
  getRoofSegmentSurfaceY,
  type MeasurementFeature,
  type MeasurementFeatureBinding,
  type RoofNode,
  type RoofSegmentNode,
} from '@pascal-app/core'
import { getRoofSegmentPlanLinework, type PlanPt, type PlanSeg } from './floorplan'

function transformPoint(node: RoofSegmentNode, roof: RoofNode, [x, z]: PlanPt) {
  const segmentCos = Math.cos(node.rotation)
  const segmentSin = Math.sin(node.rotation)
  const segmentX = node.position[0] + x * segmentCos + z * segmentSin
  const segmentZ = node.position[2] - x * segmentSin + z * segmentCos
  const roofCos = Math.cos(roof.rotation)
  const roofSin = Math.sin(roof.rotation)
  return [
    roof.position[0] + segmentX * roofCos + segmentZ * roofSin,
    roof.position[1] + node.position[1] + getRoofSegmentSurfaceY(node, x, z),
    roof.position[2] - segmentX * roofSin + segmentZ * roofCos,
  ] as [number, number, number]
}

function segmentFeature(
  node: RoofSegmentNode,
  roof: RoofNode,
  id: string,
  label: string,
  snapKind: 'ridge' | 'edge',
  segment: PlanSeg,
): MeasurementFeature {
  return {
    id,
    label,
    snapKind,
    priority: snapKind === 'ridge' ? 100 : 75,
    geometry: {
      kind: 'segment',
      start: transformPoint(node, roof, segment[0]),
      end: transformPoint(node, roof, segment[1]),
    },
  }
}

export function roofSegmentMeasurementFeatures(
  node: RoofSegmentNode,
  roof: RoofNode | null,
): MeasurementFeature[] {
  if (roof?.type !== 'roof') return []
  const linework = getRoofSegmentPlanLinework(node)
  return [
    ...linework.ridges.map((segment, index) =>
      segmentFeature(node, roof, `roof:ridge:${index}`, 'Roof ridge', 'ridge', segment),
    ),
    ...linework.hips.map((segment, index) =>
      segmentFeature(node, roof, `roof:hip:${index}`, 'Roof hip', 'edge', segment),
    ),
    ...linework.breaks.map((segment, index) =>
      segmentFeature(node, roof, `roof:break:${index}`, 'Roof break', 'edge', segment),
    ),
  ]
}

export function matchRoofSegmentMeasurementFeature(
  node: RoofSegmentNode,
  roof: RoofNode | null,
  hit: [number, number, number],
  maxDistance: number,
): MeasurementFeatureBinding | null {
  let best: MeasurementFeatureBinding | null = null
  for (const feature of roofSegmentMeasurementFeatures(node, roof)) {
    if (feature.geometry.kind !== 'segment') continue
    const { start, end } = feature.geometry
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const dz = end[2] - start[2]
    const lengthSquared = dx * dx + dy * dy + dz * dz
    const t =
      lengthSquared <= 1e-12
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((hit[0] - start[0]) * dx + (hit[1] - start[1]) * dy + (hit[2] - start[2]) * dz) /
                lengthSquared,
            ),
          )
    const point: [number, number, number] = [
      start[0] + dx * t,
      start[1] + dy * t,
      start[2] + dz * t,
    ]
    const distance = Math.hypot(hit[0] - point[0], hit[1] - point[1], hit[2] - point[2])
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { featureId: feature.id, point, parameters: { t }, distance }
    }
  }
  return best
}
