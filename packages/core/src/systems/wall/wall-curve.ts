import type { FenceNode, WallNode } from '../../schema'
import type { Point2D } from './wall-mitering'

const CURVE_EPSILON = 1e-6
const DEFAULT_CURVE_TOLERANCE = 0.005
const MAX_ADAPTIVE_CURVE_SEGMENTS = 128
const CURVE_INTERSECTION_SEARCH_STEPS = 20
const CURVE_INTERSECTION_TOLERANCE = 1e-6

type WallCurveLike = Pick<WallNode | FenceNode, 'start' | 'end' | 'curveOffset'>

export type WallCurveFrame = {
  point: Point2D
  tangent: Point2D
  normal: Point2D
}

type WallSurfaceMiterOverrides = {
  startLeft?: Point2D
  startRight?: Point2D
  endLeft?: Point2D
  endRight?: Point2D
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function distance(a: Point2D, b: Point2D) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function getWallStartPoint(wall: WallCurveLike): Point2D {
  return { x: wall.start[0], y: wall.start[1] }
}

export function getWallEndPoint(wall: WallCurveLike): Point2D {
  return { x: wall.end[0], y: wall.end[1] }
}

export function getWallChordLength(wall: WallCurveLike) {
  return distance(getWallStartPoint(wall), getWallEndPoint(wall))
}

export function getMaxWallCurveOffset(wall: WallCurveLike) {
  return getWallChordLength(wall) / 2
}

export function getWallStraightSnapOffset(wall: WallCurveLike) {
  return Math.min(0.03, Math.max(0.005, getWallChordLength(wall) * 0.005))
}

function clampCurveOffset(wall: WallCurveLike, offset: number) {
  const maxOffset = getMaxWallCurveOffset(wall)
  if (!Number.isFinite(maxOffset) || maxOffset < CURVE_EPSILON) {
    return 0
  }

  return Math.max(-maxOffset, Math.min(maxOffset, offset))
}

export function normalizeWallCurveOffset(wall: WallCurveLike, offset: number) {
  const clamped = clampCurveOffset(wall, offset)
  return Math.abs(clamped) <= getWallStraightSnapOffset(wall) ? 0 : clamped
}

export function getClampedWallCurveOffset(wall: WallCurveLike) {
  const value = wall.curveOffset ?? 0
  const normalized = normalizeWallCurveOffset(wall, value)
  return Math.abs(normalized) > CURVE_EPSILON ? normalized : 0
}

export function isCurvedWall(wall: WallCurveLike) {
  return Math.abs(getClampedWallCurveOffset(wall)) > CURVE_EPSILON
}

export function getWallChordFrame(wall: WallCurveLike) {
  const start = getWallStartPoint(wall)
  const end = getWallEndPoint(wall)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)

  if (length < CURVE_EPSILON) {
    return {
      start,
      end,
      midpoint: start,
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
      length: 0,
    }
  }

  return {
    start,
    end,
    midpoint: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    tangent: { x: dx / length, y: dy / length },
    normal: { x: -dy / length, y: dx / length },
    length,
  }
}

export function getWallArcData(wall: WallCurveLike) {
  const chord = getWallChordFrame(wall)
  const sagitta = getClampedWallCurveOffset(wall)

  if (Math.abs(sagitta) <= CURVE_EPSILON || chord.length < CURVE_EPSILON) {
    return null
  }

  const absSagitta = Math.abs(sagitta)
  const radius = (chord.length * chord.length) / (8 * absSagitta) + absSagitta / 2
  const centerOffset = radius - absSagitta
  const direction = Math.sign(sagitta) || 1
  const center = {
    x: chord.midpoint.x + chord.normal.x * centerOffset * direction,
    y: chord.midpoint.y + chord.normal.y * centerOffset * direction,
  }
  const startAngle = Math.atan2(chord.start.y - center.y, chord.start.x - center.x)
  const endAngle = Math.atan2(chord.end.y - center.y, chord.end.x - center.x)

  let delta = endAngle - startAngle
  if (direction > 0) {
    while (delta <= 0) delta += Math.PI * 2
  } else {
    while (delta >= 0) delta -= Math.PI * 2
  }

  return { center, radius, startAngle, delta, direction }
}

export function getWallCurveFrameAt(wall: WallCurveLike, t: number): WallCurveFrame {
  const chord = getWallChordFrame(wall)
  if (!isCurvedWall(wall) || chord.length < CURVE_EPSILON) {
    return {
      point: {
        x: lerp(chord.start.x, chord.end.x, clamp01(t)),
        y: lerp(chord.start.y, chord.end.y, clamp01(t)),
      },
      tangent: chord.tangent,
      normal: chord.normal,
    }
  }

  const arc = getWallArcData(wall)
  if (!arc) {
    return {
      point: chord.midpoint,
      tangent: chord.tangent,
      normal: chord.normal,
    }
  }

  const angle = arc.startAngle + arc.delta * clamp01(t)
  const point = {
    x: arc.center.x + Math.cos(angle) * arc.radius,
    y: arc.center.y + Math.sin(angle) * arc.radius,
  }
  const tangent =
    arc.direction > 0
      ? { x: -Math.sin(angle), y: Math.cos(angle) }
      : { x: Math.sin(angle), y: -Math.cos(angle) }

  return {
    point,
    tangent,
    normal: {
      x: -tangent.y,
      y: tangent.x,
    },
  }
}

export function getWallMidpointHandlePoint(wall: WallCurveLike) {
  return getWallCurveFrameAt(wall, 0.5).point
}

/** Return a tessellation budget whose chord error stays below `tolerance`. */
export function getWallCurveSampleCount(
  wall: WallCurveLike,
  tolerance = DEFAULT_CURVE_TOLERANCE,
  maxSegments = MAX_ADAPTIVE_CURVE_SEGMENTS,
) {
  const arc = getWallArcData(wall)
  if (!arc) return 1
  const safeTolerance = Math.max(CURVE_EPSILON, tolerance)
  const angleStep =
    2 *
    Math.acos(Math.max(-1, Math.min(1, 1 - safeTolerance / Math.max(arc.radius, safeTolerance))))
  const count = Math.ceil(Math.abs(arc.delta) / Math.max(angleStep, CURVE_EPSILON))
  return Math.max(2, Math.min(Math.max(2, Math.floor(maxSegments)), count))
}

export function sampleWallCenterline(wall: WallCurveLike, segments?: number) {
  const count = segments === undefined ? getWallCurveSampleCount(wall) : Math.max(1, segments)
  return Array.from(
    { length: count + 1 },
    (_, index) => getWallCurveFrameAt(wall, index / count).point,
  )
}

/** Return the centerline frame at a distance from the wall's start point. */
export function getWallCurveFrameAtDistance(
  wall: WallCurveLike,
  distanceAlong: number,
): WallCurveFrame {
  const length = getWallCurveLength(wall)
  return getWallCurveFrameAt(wall, length <= CURVE_EPSILON ? 0 : distanceAlong / length)
}

export function getWallPointAtDistance(wall: WallCurveLike, distanceAlong: number): Point2D {
  return getWallCurveFrameAtDistance(wall, distanceAlong).point
}

export type WallCenterlineProjection = {
  point: Point2D
  frame: WallCurveFrame
  distance: number
  distanceAlong: number
  t: number
  signedNormalDistance: number
}

/** Project a plan point onto the wall centerline, including curved walls. */
export function projectPointToWallCenterline(
  wall: WallCurveLike,
  planPoint: Point2D,
): WallCenterlineProjection {
  const chord = getWallChordFrame(wall)
  if (!isCurvedWall(wall) || chord.length <= CURVE_EPSILON) {
    const dx = planPoint.x - chord.start.x
    const dy = planPoint.y - chord.start.y
    const t =
      chord.length <= CURVE_EPSILON
        ? 0
        : clamp01((dx * chord.tangent.x + dy * chord.tangent.y) / chord.length)
    const frame = getWallCurveFrameAt(wall, t)
    const projected = frame.point
    const signedNormalDistance =
      (planPoint.x - projected.x) * frame.normal.x + (planPoint.y - projected.y) * frame.normal.y
    return {
      point: projected,
      frame,
      distance: Math.hypot(planPoint.x - projected.x, planPoint.y - projected.y),
      distanceAlong: chord.length * t,
      t,
      signedNormalDistance,
    }
  }

  const arc = getWallArcData(wall)
  if (!arc) return projectPointToWallCenterline({ ...wall, curveOffset: 0 }, planPoint)

  const pointAngle = Math.atan2(planPoint.y - arc.center.y, planPoint.x - arc.center.x)
  let directedAngle = (pointAngle - arc.startAngle) * arc.direction
  while (directedAngle < 0) directedAngle += Math.PI * 2
  const arcAngle = Math.abs(arc.delta)
  const candidates = [0, 1]
  if (directedAngle <= arcAngle) candidates.push(directedAngle / arcAngle)

  let bestT = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (const t of candidates) {
    const frame = getWallCurveFrameAt(wall, t)
    const candidateDistance = Math.hypot(planPoint.x - frame.point.x, planPoint.y - frame.point.y)
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance
      bestT = t
    }
  }

  const frame = getWallCurveFrameAt(wall, bestT)
  const signedNormalDistance =
    (planPoint.x - frame.point.x) * frame.normal.x + (planPoint.y - frame.point.y) * frame.normal.y
  const distanceAlong = getWallCurveLength(wall) * bestT
  return {
    point: frame.point,
    frame,
    distance: bestDistance,
    distanceAlong,
    t: bestT,
    signedNormalDistance,
  }
}

function segmentIntersectionPoint(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const abX = b.x - a.x
  const abY = b.y - a.y
  const cdX = d.x - c.x
  const cdY = d.y - c.y
  const denominator = abX * cdY - abY * cdX
  if (Math.abs(denominator) <= CURVE_INTERSECTION_TOLERANCE) return null

  const acX = c.x - a.x
  const acY = c.y - a.y
  const t = (acX * cdY - acY * cdX) / denominator
  const u = (acX * abY - acY * abX) / denominator
  if (
    t < -CURVE_INTERSECTION_TOLERANCE ||
    t > 1 + CURVE_INTERSECTION_TOLERANCE ||
    u < -CURVE_INTERSECTION_TOLERANCE ||
    u > 1 + CURVE_INTERSECTION_TOLERANCE
  ) {
    return null
  }

  return { x: a.x + t * abX, y: a.y + t * abY }
}

function pointMatchesEndpoint(point: Point2D, wall: WallCurveLike) {
  return [getWallStartPoint(wall), getWallEndPoint(wall)].some(
    (endpoint) => distance(point, endpoint) <= CURVE_INTERSECTION_TOLERANCE,
  )
}

function wallCurveIntersectsSibling(wall: WallNode, sibling: WallNode) {
  const wallPoints = sampleWallCenterline(wall)
  const siblingPoints = sampleWallCenterline(sibling)

  for (let wallIndex = 0; wallIndex < wallPoints.length - 1; wallIndex += 1) {
    const wallStart = wallPoints[wallIndex]!
    const wallEnd = wallPoints[wallIndex + 1]!
    for (let siblingIndex = 0; siblingIndex < siblingPoints.length - 1; siblingIndex += 1) {
      const siblingStart = siblingPoints[siblingIndex]!
      const siblingEnd = siblingPoints[siblingIndex + 1]!
      const intersection = segmentIntersectionPoint(wallStart, wallEnd, siblingStart, siblingEnd)
      if (!intersection) continue
      if (pointMatchesEndpoint(intersection, wall) && pointMatchesEndpoint(intersection, sibling)) {
        continue
      }
      return true
    }
  }

  return false
}

function wallCurveIntersectsSiblings(wall: WallNode, walls: readonly WallNode[]) {
  if (!isCurvedWall(wall)) return false
  return walls.some(
    (sibling) =>
      sibling.id !== wall.id &&
      sibling.parentId === wall.parentId &&
      wallCurveIntersectsSibling(wall, sibling),
  )
}

export function constrainWallCurveOffsetToAvoidIntersections(
  wall: WallNode,
  proposedOffset: number,
  walls: readonly WallNode[],
) {
  const currentOffset = normalizeWallCurveOffset(wall, wall.curveOffset ?? 0)
  const normalizedProposal = normalizeWallCurveOffset(wall, proposedOffset)
  const proposedWall = { ...wall, curveOffset: normalizedProposal }
  if (!wallCurveIntersectsSiblings(proposedWall, walls)) return normalizedProposal

  const currentWall = { ...wall, curveOffset: currentOffset }
  if (wallCurveIntersectsSiblings(currentWall, walls)) return currentOffset

  let safeOffset = currentOffset
  let blockedOffset = normalizedProposal
  for (let index = 0; index < CURVE_INTERSECTION_SEARCH_STEPS; index += 1) {
    const candidateOffset = (safeOffset + blockedOffset) / 2
    const candidateWall = { ...wall, curveOffset: candidateOffset }
    if (wallCurveIntersectsSiblings(candidateWall, walls)) blockedOffset = candidateOffset
    else safeOffset = candidateOffset
  }

  return normalizeWallCurveOffset(wall, safeOffset)
}

export function getWallCurveSampledLength(wall: WallCurveLike, segments?: number) {
  const points = sampleWallCenterline(wall, segments)
  let totalLength = 0

  for (let index = 1; index < points.length; index += 1) {
    totalLength += distance(points[index - 1]!, points[index]!)
  }

  return totalLength
}

/** Exact centerline length for straight and circular wall centerlines. */
export function getWallCurveLength(wall: WallCurveLike) {
  const arc = getWallArcData(wall)
  return arc ? Math.abs(arc.radius * arc.delta) : getWallChordLength(wall)
}

export function getWallSurfacePolygon(
  wall: Pick<WallNode | FenceNode, 'start' | 'end' | 'curveOffset' | 'thickness'>,
  segments?: number,
  miterOverrides?: WallSurfaceMiterOverrides,
) {
  const halfThickness = (wall.thickness ?? 0.1) / 2
  const count = segments === undefined ? getWallCurveSampleCount(wall) : Math.max(1, segments)
  const left: Point2D[] = []
  const right: Point2D[] = []

  for (let index = 0; index <= count; index += 1) {
    const frame = getWallCurveFrameAt(wall, index / count)
    left.push({
      x: frame.point.x + frame.normal.x * halfThickness,
      y: frame.point.y + frame.normal.y * halfThickness,
    })
    right.push({
      x: frame.point.x - frame.normal.x * halfThickness,
      y: frame.point.y - frame.normal.y * halfThickness,
    })
  }

  if (left.length > 0 && right.length > 0) {
    left[0] = miterOverrides?.startLeft ?? left[0]!
    right[0] = miterOverrides?.startRight ?? right[0]!
    left[left.length - 1] = miterOverrides?.endLeft ?? left[left.length - 1]!
    right[right.length - 1] = miterOverrides?.endRight ?? right[right.length - 1]!
  }

  return [...right, ...left.reverse()]
}
