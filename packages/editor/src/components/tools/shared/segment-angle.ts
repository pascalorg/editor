import {
  type FenceNode,
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  type WallNode,
} from '@pascal-app/core'

export type PlanPoint = [number, number]

export type SegmentAngleLike = Pick<WallNode | FenceNode, 'start' | 'end' | 'curveOffset'>

export type SegmentAngleReference = {
  vector: PlanPoint
  orientation: 'directed' | 'axis'
}

const POINT_MATCH_TOLERANCE = 1e-5
const SEGMENT_POINT_TOLERANCE = 0.15
const CURVE_TANGENT_SAMPLE_SPACING = 0.08

function distanceSquared(a: PlanPoint, b: PlanPoint) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]

  return dx * dx + dz * dz
}

function pointsMatch(a: PlanPoint, b: PlanPoint, tolerance = POINT_MATCH_TOLERANCE) {
  return distanceSquared(a, b) <= tolerance * tolerance
}

function getProjectedPointOnSegment(point: PlanPoint, segment: SegmentAngleLike): PlanPoint | null {
  const [x1, z1] = segment.start
  const [x2, z2] = segment.end
  const dx = x2 - x1
  const dz = z2 - z1
  const lengthSquared = dx * dx + dz * dz

  if (lengthSquared < 1e-9) {
    return null
  }

  const t = ((point[0] - x1) * dx + (point[1] - z1) * dz) / lengthSquared
  if (t <= 0 || t >= 1) {
    return null
  }

  return [x1 + dx * t, z1 + dz * t]
}

function getCurveTangentAtPoint(point: PlanPoint, segment: SegmentAngleLike): PlanPoint | null {
  const curveLength = getWallCurveLength(segment)
  const sampleCount = Math.max(24, Math.ceil(curveLength / CURVE_TANGENT_SAMPLE_SPACING))
  let best: { distance: number; tangent: PlanPoint } | null = null

  for (let index = 0; index <= sampleCount; index += 1) {
    const frame = getWallCurveFrameAt(segment, index / sampleCount)
    const candidate: PlanPoint = [frame.point.x, frame.point.y]
    const distance = distanceSquared(point, candidate)

    if (best && distance >= best.distance) {
      continue
    }

    best = {
      distance,
      tangent: [frame.tangent.x, frame.tangent.y],
    }
  }

  if (!best || best.distance > SEGMENT_POINT_TOLERANCE * SEGMENT_POINT_TOLERANCE) {
    return null
  }

  return best.tangent
}

export function formatAngleRadians(angle: number) {
  return `${Math.round((angle * 180) / Math.PI)}°`
}

export function getAngleBetweenVectors(first: PlanPoint, second: PlanPoint): number | null {
  const firstLength = Math.hypot(first[0], first[1])
  const secondLength = Math.hypot(second[0], second[1])

  if (firstLength < 1e-6 || secondLength < 1e-6) return null

  const dot = first[0] * second[0] + first[1] * second[1]
  const cosine = Math.min(1, Math.max(-1, dot / (firstLength * secondLength)))

  return Math.acos(cosine)
}

export function getAngleToSegmentReference(
  vector: PlanPoint,
  reference: SegmentAngleReference,
): number | null {
  const angle = getAngleBetweenVectors(vector, reference.vector)

  if (angle === null || reference.orientation === 'directed') {
    return angle
  }

  const reverseAngle = getAngleBetweenVectors(vector, [-reference.vector[0], -reference.vector[1]])

  if (reverseAngle === null) {
    return angle
  }

  return Math.min(angle, reverseAngle)
}

export function getSegmentAngleReferenceAtPoint(
  point: PlanPoint,
  segment: SegmentAngleLike,
): SegmentAngleReference | null {
  if (pointsMatch(point, segment.start)) {
    const frame = getWallCurveFrameAt(segment, 0)

    return {
      vector: [frame.tangent.x, frame.tangent.y],
      orientation: 'directed',
    }
  }

  if (pointsMatch(point, segment.end)) {
    const frame = getWallCurveFrameAt(segment, 1)

    return {
      vector: [-frame.tangent.x, -frame.tangent.y],
      orientation: 'directed',
    }
  }

  if (isCurvedWall(segment)) {
    const tangent = getCurveTangentAtPoint(point, segment)

    return tangent
      ? {
          vector: tangent,
          orientation: 'axis',
        }
      : null
  }

  const projected = getProjectedPointOnSegment(point, segment)
  if (!projected || !pointsMatch(point, projected, SEGMENT_POINT_TOLERANCE)) {
    return null
  }

  return {
    vector: [segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]],
    orientation: 'axis',
  }
}
