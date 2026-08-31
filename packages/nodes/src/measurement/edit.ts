import {
  type MeasurementAnchor,
  type MeasurementPayload,
  type MeasurementPoint,
  measurementDistance,
  measurementNormal,
} from '@pascal-app/core'
import type { ResolvedMeasurementPayload } from './resolve'

export function measurementResolvedEditPoints(
  measurement: ResolvedMeasurementPayload,
): MeasurementPoint[] {
  return measurement.kind === 'distance' || measurement.kind === 'angle'
    ? measurement.points.map((point) => [...point] as MeasurementPoint)
    : measurement.base.map((point) => [...point] as MeasurementPoint)
}

function mapMeasurementAnchors(
  measurement: MeasurementPayload,
  map: (anchor: MeasurementAnchor, index: number) => MeasurementAnchor,
): MeasurementPayload {
  if (measurement.kind === 'distance') {
    return {
      ...measurement,
      points: [map(measurement.points[0], 0), map(measurement.points[1], 1)],
    }
  }
  if (measurement.kind === 'angle') {
    return {
      ...measurement,
      points: [
        map(measurement.points[0], 0),
        map(measurement.points[1], 1),
        map(measurement.points[2], 2),
      ],
    }
  }
  return {
    ...measurement,
    base: measurement.base.map(map),
  }
}

export function refreshMeasurementAnchorFallbacks(
  measurement: MeasurementPayload,
  resolved: ResolvedMeasurementPayload,
): MeasurementPayload {
  const points = measurementResolvedEditPoints(resolved)
  return mapMeasurementAnchors(measurement, (anchor, index) => {
    if (Array.isArray(anchor)) return anchor
    const fallback = points[index]
    return fallback ? { ...anchor, fallback: [...fallback] } : anchor
  })
}

export function replaceMeasurementAnchor(
  measurement: MeasurementPayload,
  index: number,
  anchor: MeasurementAnchor,
): MeasurementPayload | null {
  const count =
    measurement.kind === 'distance' || measurement.kind === 'angle'
      ? measurement.points.length
      : measurement.base.length
  if (!Number.isInteger(index) || index < 0 || index >= count) return null
  return mapMeasurementAnchors(measurement, (current, currentIndex) =>
    currentIndex === index ? anchor : current,
  )
}

function isPolygonMeasurement(measurement: ResolvedMeasurementPayload): boolean {
  return (
    measurement.kind === 'area' || measurement.kind === 'perimeter' || measurement.kind === 'volume'
  )
}

export function constrainMeasurementSpatialEditPoint(
  measurement: ResolvedMeasurementPayload,
  point: MeasurementPoint,
): MeasurementPoint {
  if (!isPolygonMeasurement(measurement)) return [...point]
  const points = measurementResolvedEditPoints(measurement)
  const origin = points[0]
  const normal = measurementNormal(points)
  if (!(origin && normal)) return [...point]
  const distance =
    (point[0] - origin[0]) * normal[0] +
    (point[1] - origin[1]) * normal[1] +
    (point[2] - origin[2]) * normal[2]
  return [
    point[0] - normal[0] * distance,
    point[1] - normal[1] * distance,
    point[2] - normal[2] * distance,
  ]
}

export function constrainMeasurementPlanEditPoint(
  measurement: ResolvedMeasurementPayload,
  index: number,
  planPoint: readonly [number, number],
): MeasurementPoint | null {
  const points = measurementResolvedEditPoints(measurement)
  const current = points[index]
  if (!current) return null
  if (!isPolygonMeasurement(measurement)) return [planPoint[0], current[1], planPoint[1]]

  const origin = points[0]
  const normal = measurementNormal(points)
  if (!(origin && normal)) return [planPoint[0], current[1], planPoint[1]]
  if (Math.abs(normal[1]) > 1e-6) {
    const y =
      origin[1] -
      (normal[0] * (planPoint[0] - origin[0]) + normal[2] * (planPoint[1] - origin[2])) / normal[1]
    return [planPoint[0], y, planPoint[1]]
  }

  const normalLengthSq = normal[0] * normal[0] + normal[2] * normal[2]
  if (normalLengthSq <= 1e-12) return [planPoint[0], current[1], planPoint[1]]
  const offset =
    (normal[0] * (planPoint[0] - origin[0]) + normal[2] * (planPoint[1] - origin[2])) /
    normalLengthSq
  return [planPoint[0] - normal[0] * offset, current[1], planPoint[1] - normal[2] * offset]
}

export function measurementEditAnchor(
  measurement: ResolvedMeasurementPayload,
  point: MeasurementPoint,
  associatedAnchor?: MeasurementAnchor,
): MeasurementAnchor {
  const constrained = constrainMeasurementSpatialEditPoint(measurement, point)
  if (
    associatedAnchor &&
    !Array.isArray(associatedAnchor) &&
    measurementDistance(constrained, point) <= 0.012
  ) {
    return { ...associatedAnchor, fallback: constrained }
  }
  return constrained
}
