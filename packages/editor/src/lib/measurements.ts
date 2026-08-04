import type { MeasurementPoint } from '@pascal-app/core'

export type LinearUnit = 'metric' | 'imperial'
export type MetricNotation = 'meters' | 'millimeters'

export const MEASUREMENT_ACTIVE_COLOR = '#6366f1'
export const MEASUREMENT_DANGLING_COLOR = '#dc2626'
export const MEASUREMENT_FLOORPLAN_COLOR = '#4f46e5'
export const MEASUREMENT_PERSISTENT_COLOR = '#111827'

export function measurementPresentationColor(dangling: boolean, active: boolean): string {
  if (dangling) return MEASUREMENT_DANGLING_COLOR
  return active ? MEASUREMENT_ACTIVE_COLOR : MEASUREMENT_PERSISTENT_COLOR
}

export function measurementFloorplanPresentationColor(dangling: boolean, active: boolean): string {
  if (dangling) return MEASUREMENT_DANGLING_COLOR
  return active ? MEASUREMENT_ACTIVE_COLOR : MEASUREMENT_FLOORPLAN_COLOR
}

type MeasurementAngleArcOptions = {
  radius?: number
  sampleCount?: number
}

const ANGLE_ARC_EPSILON = 1e-9

const subtractPoint = (point: MeasurementPoint, origin: MeasurementPoint): MeasurementPoint => [
  point[0] - origin[0],
  point[1] - origin[1],
  point[2] - origin[2],
]

const pointLength = (point: MeasurementPoint): number => Math.hypot(...point)

const scalePoint = (point: MeasurementPoint, scale: number): MeasurementPoint => [
  point[0] * scale,
  point[1] * scale,
  point[2] * scale,
]

const crossPoint = (first: MeasurementPoint, second: MeasurementPoint): MeasurementPoint => [
  first[1] * second[2] - first[2] * second[1],
  first[2] * second[0] - first[0] * second[2],
  first[0] * second[1] - first[1] * second[0],
]

const dotPoint = (first: MeasurementPoint, second: MeasurementPoint): number =>
  first[0] * second[0] + first[1] * second[1] + first[2] * second[2]

export function buildMeasurementAngleArcPoints(
  start: MeasurementPoint,
  vertex: MeasurementPoint,
  end: MeasurementPoint,
  options: MeasurementAngleArcOptions = {},
): MeasurementPoint[] {
  if (![...start, ...vertex, ...end].every(Number.isFinite)) return []

  const startVector = subtractPoint(start, vertex)
  const endVector = subtractPoint(end, vertex)
  const startLength = pointLength(startVector)
  const endLength = pointLength(endVector)
  if (startLength <= ANGLE_ARC_EPSILON || endLength <= ANGLE_ARC_EPSILON) return []

  const startDirection = scalePoint(startVector, 1 / startLength)
  const endDirection = scalePoint(endVector, 1 / endLength)
  const cosine = Math.max(-1, Math.min(1, dotPoint(startDirection, endDirection)))
  const angle = Math.acos(cosine)
  if (angle <= 1e-4) return []

  let normal = crossPoint(startDirection, endDirection)
  let normalLength = pointLength(normal)
  if (normalLength <= ANGLE_ARC_EPSILON) {
    const reference: MeasurementPoint = Math.abs(startDirection[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    normal = crossPoint(startDirection, reference)
    normalLength = pointLength(normal)
  }
  if (normalLength <= ANGLE_ARC_EPSILON) return []
  normal = scalePoint(normal, 1 / normalLength)
  const tangent = crossPoint(normal, startDirection)

  const shortestSide = Math.min(startLength, endLength)
  const preferredRadius = options.radius ?? Math.min(Math.max(shortestSide * 0.28, 0.08), 0.75)
  const radius = Math.min(Math.max(preferredRadius, 0), shortestSide * 0.45)
  if (radius <= ANGLE_ARC_EPSILON) return []

  const sampleCount = Math.min(
    64,
    Math.max(4, Math.round(options.sampleCount ?? Math.max(8, (angle / Math.PI) * 32))),
  )
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const sampleAngle = angle * (index / sampleCount)
    const direction: MeasurementPoint = [
      startDirection[0] * Math.cos(sampleAngle) + tangent[0] * Math.sin(sampleAngle),
      startDirection[1] * Math.cos(sampleAngle) + tangent[1] * Math.sin(sampleAngle),
      startDirection[2] * Math.cos(sampleAngle) + tangent[2] * Math.sin(sampleAngle),
    ]
    return [
      vertex[0] + direction[0] * radius,
      vertex[1] + direction[1] * radius,
      vertex[2] + direction[2] * radius,
    ]
  })
}

const METERS_PER_FOOT = 0.3048
const FEET_PER_METER = 1 / METERS_PER_FOOT

type LinearControlValueOptions = {
  minMeters?: number
  maxMeters?: number
}

export function metersToLinearUnit(meters: number, unit: LinearUnit): number {
  return unit === 'imperial' ? meters * FEET_PER_METER : meters
}

export function linearUnitToMeters(value: number, unit: LinearUnit): number {
  return unit === 'imperial' ? value * METERS_PER_FOOT : value
}

export function linearControlValueToMeters(
  value: number,
  unit: LinearUnit,
  options: LinearControlValueOptions = {},
): number {
  const meters = linearUnitToMeters(value, unit)
  const minMeters = options.minMeters ?? Number.NEGATIVE_INFINITY
  const maxMeters = options.maxMeters ?? Number.POSITIVE_INFINITY

  return Math.min(Math.max(meters, minMeters), maxMeters)
}

export function getLinearUnitLabel(unit: LinearUnit): string {
  return unit === 'imperial' ? 'ft' : 'm'
}

const SQUARE_FEET_PER_SQUARE_METER = FEET_PER_METER * FEET_PER_METER
const CUBIC_FEET_PER_CUBIC_METER = SQUARE_FEET_PER_SQUARE_METER * FEET_PER_METER

export function squareMetersToAreaUnit(squareMeters: number, unit: LinearUnit): number {
  return unit === 'imperial' ? squareMeters * SQUARE_FEET_PER_SQUARE_METER : squareMeters
}

export function getAreaUnitLabel(unit: LinearUnit): string {
  return unit === 'imperial' ? 'ft²' : 'm²'
}

export function formatAreaLabel(
  squareMeters: number,
  unit: LinearUnit,
  fractionDigits = 1,
): string {
  if (!Number.isFinite(squareMeters)) return '--'

  return `${squareMetersToAreaUnit(squareMeters, unit).toFixed(fractionDigits)}${getAreaUnitLabel(unit)}`
}

export function cubicMetersToVolumeUnit(cubicMeters: number, unit: LinearUnit): number {
  return unit === 'imperial' ? cubicMeters * CUBIC_FEET_PER_CUBIC_METER : cubicMeters
}

export function getVolumeUnitLabel(unit: LinearUnit): string {
  return unit === 'imperial' ? 'ft³' : 'm³'
}

export function formatVolumeLabel(
  cubicMeters: number,
  unit: LinearUnit,
  fractionDigits = 1,
): string {
  if (!Number.isFinite(cubicMeters)) return '--'

  return `${cubicMetersToVolumeUnit(cubicMeters, unit).toFixed(fractionDigits)}${getVolumeUnitLabel(unit)}`
}

export function formatLinearMeasurement(
  meters: number,
  unit: LinearUnit,
  metricNotation: MetricNotation = 'meters',
): string {
  if (!Number.isFinite(meters)) return '--'

  const absoluteMeters = Math.abs(meters)

  if (unit === 'imperial') {
    const feet = metersToLinearUnit(absoluteMeters, unit)
    let wholeFeet = Math.floor(feet)
    let inches = Math.round((feet - wholeFeet) * 12)
    if (inches === 12) {
      wholeFeet += 1
      inches = 0
    }

    const sign = meters < 0 && (wholeFeet !== 0 || inches !== 0) ? '-' : ''

    return `${sign}${wholeFeet}'${inches}"`
  }

  if (metricNotation === 'millimeters') {
    const roundedMillimeters = Math.round(absoluteMeters * 1000)
    const sign = meters < 0 && roundedMillimeters !== 0 ? '-' : ''
    return `${sign}${roundedMillimeters}mm`
  }

  const roundedMeters = Number.parseFloat(absoluteMeters.toFixed(2))
  const sign = meters < 0 && roundedMeters !== 0 ? '-' : ''

  return `${sign}${roundedMeters}m`
}
