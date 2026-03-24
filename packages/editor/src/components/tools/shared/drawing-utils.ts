import {
  formatLength,
  METERS_PER_INCH,
  parseLengthInput,
  type UnitSystem,
} from '../../../lib/measurements'

export type PlanPoint = [number, number]

export const GRID_STEP = METERS_PER_INCH
export const MIN_DRAW_DISTANCE = 0.01
export const CLOSE_LOOP_TOLERANCE = GRID_STEP * 4

export const snapToGrid = (value: number) => Math.round(value / GRID_STEP) * GRID_STEP

export const getPlanDistance = (start: PlanPoint, end: PlanPoint) => {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  return Math.hypot(dx, dz)
}

export const getPlanMidpoint = (start: PlanPoint, end: PlanPoint): PlanPoint => [
  (start[0] + end[0]) / 2,
  (start[1] + end[1]) / 2,
]

export const projectPointAtDistance = (
  start: PlanPoint,
  target: PlanPoint,
  distance: number,
): PlanPoint => {
  const dx = target[0] - start[0]
  const dz = target[1] - start[1]
  const length = Math.hypot(dx, dz)

  if (length < MIN_DRAW_DISTANCE) {
    return [start[0] + distance, start[1]]
  }

  const unitX = dx / length
  const unitZ = dz / length

  return [start[0] + unitX * distance, start[1] + unitZ * distance]
}

export const formatDistance = (distance: number, unitSystem: UnitSystem) =>
  formatLength(distance, unitSystem, { compact: unitSystem === 'metric' })

export const parseDistanceInput = (value: string, unitSystem: UnitSystem) =>
  parseLengthInput(value, unitSystem)

export const snapSegmentTo45Degrees = (start: PlanPoint, cursor: PlanPoint): PlanPoint => {
  const dx = cursor[0] - start[0]
  const dz = cursor[1] - start[1]
  const angle = Math.atan2(dz, dx)
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
  const distance = Math.hypot(dx, dz)

  return [
    snapToGrid(start[0] + Math.cos(snappedAngle) * distance),
    snapToGrid(start[1] + Math.sin(snappedAngle) * distance),
  ]
}
