import type { MeasurementPoint } from '../schema/nodes/measurement'

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
