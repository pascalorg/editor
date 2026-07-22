import type { MeasurementFeature, MeasurementFeatureBinding } from '../registry/types'
import type { ConstructionDimensionNode } from '../schema/nodes/construction-dimension'
import type {
  MeasurementAnchor,
  MeasurementPayload,
  MeasurementPoint,
} from '../schema/nodes/measurement'
import type { AnyNodeId } from '../schema/types'

const GEOMETRY_EPSILON = 1e-9
export const MEASUREMENT_PLANAR_TOLERANCE = 0.01

const subtract = (a: MeasurementPoint, b: MeasurementPoint): MeasurementPoint => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]

const cross = (a: MeasurementPoint, b: MeasurementPoint): MeasurementPoint => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

const dot = (a: MeasurementPoint, b: MeasurementPoint): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const magnitude = (point: MeasurementPoint): number => Math.hypot(point[0], point[1], point[2])

export function measurementDistance(start: MeasurementPoint, end: MeasurementPoint): number {
  return magnitude(subtract(end, start))
}

export function measurementAnchorFallback(anchor: MeasurementAnchor): MeasurementPoint {
  return Array.isArray(anchor) ? anchor : anchor.fallback
}

export function measurementAngle(
  start: MeasurementPoint,
  vertex: MeasurementPoint,
  end: MeasurementPoint,
): number {
  const a = subtract(start, vertex)
  const b = subtract(end, vertex)
  const denominator = magnitude(a) * magnitude(b)
  if (!Number.isFinite(denominator) || denominator <= GEOMETRY_EPSILON) return 0
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / denominator)))
}

export function measurementPerimeter(points: readonly MeasurementPoint[]): number {
  if (points.length < 3) return 0
  let length = 0
  for (let index = 0; index < points.length; index++) {
    length += measurementDistance(points[index]!, points[(index + 1) % points.length]!)
  }
  return length
}

export function measurementFeatureLength(feature: MeasurementFeature): number | null {
  const geometry = feature.geometry
  if (geometry.kind === 'point') return null
  const points = geometry.kind === 'segment' ? [geometry.start, geometry.end] : geometry.points
  const closed =
    geometry.kind === 'polygon' || (geometry.kind === 'path' && geometry.closed === true)
  const segmentCount = closed ? points.length : points.length - 1
  if (segmentCount <= 0) return null
  let length = 0
  for (let index = 0; index < segmentCount; index++) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!
    length += Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
  }
  return length
}

function closestPointOnMeasurementSegment(
  point: MeasurementPoint,
  start: MeasurementPoint,
  end: MeasurementPoint,
) {
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
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy + (point[2] - start[2]) * dz) /
              lengthSquared,
          ),
        )
  const resolved: MeasurementPoint = [start[0] + dx * t, start[1] + dy * t, start[2] + dz * t]
  return {
    point: resolved,
    t,
    distance: Math.hypot(point[0] - resolved[0], point[1] - resolved[1], point[2] - resolved[2]),
  }
}

export function closestMeasurementFeatureBinding(
  features: readonly MeasurementFeature[],
  point: MeasurementPoint,
  maxDistance: number,
): MeasurementFeatureBinding | null {
  let best: (MeasurementFeatureBinding & { priority: number }) | null = null
  for (const feature of features) {
    const geometry = feature.geometry
    if (geometry.kind === 'point') {
      const distance = measurementDistance(point, geometry.point)
      const candidate = {
        featureId: feature.id,
        point: geometry.point,
        parameters: { t: 0 },
        distance,
        priority: feature.priority ?? 0,
      }
      if (
        distance <= maxDistance &&
        (!best ||
          distance < best.distance ||
          (distance === best.distance && candidate.priority > best.priority))
      ) {
        best = candidate
      }
      continue
    }

    const points = geometry.kind === 'segment' ? [geometry.start, geometry.end] : geometry.points
    const closed =
      geometry.kind === 'polygon' || (geometry.kind === 'path' && geometry.closed === true)
    const count = closed ? points.length : points.length - 1
    const lengths: number[] = []
    let total = 0
    for (let index = 0; index < count; index++) {
      const start = points[index]!
      const end = points[(index + 1) % points.length]!
      const length = measurementDistance(start, end)
      lengths.push(length)
      total += length
    }

    let before = 0
    for (let index = 0; index < count; index++) {
      const start = points[index]!
      const end = points[(index + 1) % points.length]!
      const segment = closestPointOnMeasurementSegment(point, start, end)
      const t = total <= GEOMETRY_EPSILON ? 0 : (before + segment.t * lengths[index]!) / total
      const candidate = {
        featureId: feature.id,
        point: segment.point,
        parameters: { t },
        distance: segment.distance,
        priority: feature.priority ?? 0,
      }
      if (
        candidate.distance <= maxDistance &&
        (!best ||
          candidate.distance < best.distance ||
          (candidate.distance === best.distance && candidate.priority > best.priority))
      ) {
        best = candidate
      }
      before += lengths[index]!
    }
  }

  if (!best) return null
  const { priority: _priority, ...binding } = best
  return binding
}

export function remapMeasurementReferences(
  measurement: MeasurementPayload,
  idMap: ReadonlyMap<string, string>,
): MeasurementPayload {
  const remap = (anchor: MeasurementAnchor): MeasurementAnchor =>
    remapMeasurementAnchors([anchor], idMap)[0]!

  switch (measurement.kind) {
    case 'distance':
      return {
        ...measurement,
        points: [remap(measurement.points[0]), remap(measurement.points[1])],
      }
    case 'angle':
      return {
        ...measurement,
        points: [
          remap(measurement.points[0]),
          remap(measurement.points[1]),
          remap(measurement.points[2]),
        ],
      }
    case 'area':
    case 'perimeter':
      return { ...measurement, base: measurement.base.map(remap) }
    case 'volume':
      return { ...measurement, base: measurement.base.map(remap) }
  }
}

export function remapMeasurementAnchors(
  anchors: readonly MeasurementAnchor[],
  idMap: ReadonlyMap<string, string>,
): MeasurementAnchor[] {
  return anchors.map((anchor) => {
    if (Array.isArray(anchor)) return anchor
    const nodeId = idMap.get(anchor.reference.nodeId)
    return nodeId ? { ...anchor, reference: { ...anchor.reference, nodeId } } : anchor
  })
}

export function remapConstructionDimensionReferences(
  dimension: ConstructionDimensionNode,
  idMap: ReadonlyMap<string, string>,
): ConstructionDimensionNode {
  const controllingDimensionId = dimension.controllingDimensionId
    ? ((idMap.get(dimension.controllingDimensionId) as ConstructionDimensionNode['id']) ??
      dimension.controllingDimensionId)
    : null
  return {
    ...dimension,
    anchors: remapMeasurementAnchors(dimension.anchors, idMap),
    controllingDimensionId,
  }
}

export function measurementAnchorReferenceNodeIds(
  anchors: readonly MeasurementAnchor[],
): AnyNodeId[] {
  const ids = new Set<string>()
  for (const anchor of anchors) {
    if (!Array.isArray(anchor)) ids.add(anchor.reference.nodeId)
  }
  return [...ids] as AnyNodeId[]
}

export function measurementReferenceNodeIds(measurement: MeasurementPayload): AnyNodeId[] {
  const anchors =
    measurement.kind === 'distance' || measurement.kind === 'angle'
      ? measurement.points
      : measurement.base
  return measurementAnchorReferenceNodeIds(anchors)
}

export function measurementAreaVector(points: readonly MeasurementPoint[]): MeasurementPoint {
  if (points.length < 3) return [0, 0, 0]

  let x = 0
  let y = 0
  let z = 0

  for (let index = 0; index < points.length; index++) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    x += (current[1] - next[1]) * (current[2] + next[2])
    y += (current[2] - next[2]) * (current[0] + next[0])
    z += (current[0] - next[0]) * (current[1] + next[1])
  }

  return [x / 2, y / 2, z / 2]
}

export function measurementArea(points: readonly MeasurementPoint[]): number {
  return magnitude(measurementAreaVector(points))
}

export function measurementNormal(points: readonly MeasurementPoint[]): MeasurementPoint | null {
  const areaVector = measurementAreaVector(points)
  const length = magnitude(areaVector)
  if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) return null

  return [areaVector[0] / length, areaVector[1] / length, areaVector[2] / length]
}

export function areMeasurementPointsCoplanar(
  points: readonly MeasurementPoint[],
  tolerance = 1e-6,
): boolean {
  if (points.length < 3 || !Number.isFinite(tolerance)) return false

  const normal = measurementNormal(points)
  if (!normal) return false

  const origin = points[0]!
  const absoluteTolerance = Math.abs(tolerance)
  return points.every(
    (point) => Math.abs(dot(subtract(point, origin), normal)) <= absoluteTolerance,
  )
}

export function measurementCentroid(points: readonly MeasurementPoint[]): MeasurementPoint | null {
  if (points.length < 3) return null

  const normal = measurementNormal(points)
  if (!normal) return null

  const origin = points[0]!
  let totalWeight = 0
  let x = 0
  let y = 0
  let z = 0

  for (let index = 1; index < points.length - 1; index++) {
    const current = points[index]!
    const next = points[index + 1]!
    const weight = dot(cross(subtract(current, origin), subtract(next, origin)), normal)
    totalWeight += weight
    x += ((origin[0] + current[0] + next[0]) / 3) * weight
    y += ((origin[1] + current[1] + next[1]) / 3) * weight
    z += ((origin[2] + current[2] + next[2]) / 3) * weight
  }

  if (!Number.isFinite(totalWeight) || Math.abs(totalWeight) <= GEOMETRY_EPSILON) return null
  return [x / totalWeight, y / totalWeight, z / totalWeight]
}

export function measurementPrismVolume(
  base: readonly MeasurementPoint[],
  extrusion: MeasurementPoint,
): number {
  return Math.abs(dot(measurementAreaVector(base), extrusion))
}
