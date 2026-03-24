import type { WallNode } from '@pascal-app/core'
import {
  formatLength,
  METERS_PER_INCH,
  parseLengthInput,
  type UnitSystem,
} from '../../../lib/measurements'

export type PlanPoint = [number, number]
export type SnapSegment = {
  start: PlanPoint
  end: PlanPoint
}

export const GRID_STEP = METERS_PER_INCH
export const MIN_DRAW_DISTANCE = 0.01
export const CLOSE_LOOP_TOLERANCE = GRID_STEP * 4
export const WALL_SNAP_DISTANCE = METERS_PER_INCH * 6

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

const getDistanceSquared = (a: PlanPoint, b: PlanPoint) => {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

const getClosestPointOnSegment = (
  point: PlanPoint,
  segmentStart: PlanPoint,
  segmentEnd: PlanPoint,
): PlanPoint => {
  const dx = segmentEnd[0] - segmentStart[0]
  const dz = segmentEnd[1] - segmentStart[1]
  const lengthSquared = dx * dx + dz * dz

  if (lengthSquared < MIN_DRAW_DISTANCE * MIN_DRAW_DISTANCE) {
    return segmentStart
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - segmentStart[0]) * dx + (point[1] - segmentStart[1]) * dz) / lengthSquared,
    ),
  )

  return [segmentStart[0] + dx * t, segmentStart[1] + dz * t]
}

export const getSegmentSnapPoint = (
  point: PlanPoint,
  segments: Array<SnapSegment>,
  maxDistance = WALL_SNAP_DISTANCE,
): PlanPoint | null => {
  const maxDistanceSquared = maxDistance * maxDistance
  let nearestCorner: PlanPoint | null = null
  let nearestCornerDistanceSquared = Number.POSITIVE_INFINITY
  let nearestWallPoint: PlanPoint | null = null
  let nearestWallDistanceSquared = Number.POSITIVE_INFINITY

  for (const segment of segments) {
    for (const corner of [segment.start, segment.end] as PlanPoint[]) {
      const cornerDistanceSquared = getDistanceSquared(point, corner)
      if (
        cornerDistanceSquared <= maxDistanceSquared &&
        cornerDistanceSquared < nearestCornerDistanceSquared
      ) {
        nearestCorner = corner
        nearestCornerDistanceSquared = cornerDistanceSquared
      }
    }

    const projectedPoint = getClosestPointOnSegment(point, segment.start, segment.end)
    const wallDistanceSquared = getDistanceSquared(point, projectedPoint)
    if (
      wallDistanceSquared <= maxDistanceSquared &&
      wallDistanceSquared < nearestWallDistanceSquared
    ) {
      nearestWallPoint = projectedPoint
      nearestWallDistanceSquared = wallDistanceSquared
    }
  }

  return nearestCorner ?? nearestWallPoint
}

export const getWallSnapPoint = (
  point: PlanPoint,
  walls: Array<Pick<WallNode, 'start' | 'end'>>,
  maxDistance = WALL_SNAP_DISTANCE,
) => getSegmentSnapPoint(point, walls, maxDistance)

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
