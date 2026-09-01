import type { FenceNode, WallNode } from '../../schema'
import type { Point2D } from './wall-mitering'

const CURVE_EPSILON = 1e-6
const DEFAULT_SAMPLE_SEGMENTS = 24
const CURVE_INTERSECTION_SEARCH_STEPS = 20
const CURVE_INTERSECTION_TOLERANCE = 1e-6

type WallCurveLike = Pick<WallNode | FenceNode, 'start' | 'end' | 'curveOffset'>

type CurveFrame = {
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

export function getWallCurveFrameAt(wall: WallCurveLike, t: number): CurveFrame {
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

export function sampleWallCenterline(wall: WallCurveLike, segments = DEFAULT_SAMPLE_SEGMENTS) {
  const count = Math.max(1, segments)
  return Array.from(
    { length: count + 1 },
    (_, index) => getWallCurveFrameAt(wall, index / count).point,
  )
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

export function getWallCurveLength(wall: WallCurveLike, segments = DEFAULT_SAMPLE_SEGMENTS) {
  const points = sampleWallCenterline(wall, segments)
  let totalLength = 0

  for (let index = 1; index < points.length; index += 1) {
    totalLength += distance(points[index - 1]!, points[index]!)
  }

  return totalLength
}

export function getWallSurfacePolygon(
  wall: Pick<WallNode | FenceNode, 'start' | 'end' | 'curveOffset' | 'thickness'>,
  segments = DEFAULT_SAMPLE_SEGMENTS,
  miterOverrides?: WallSurfaceMiterOverrides,
) {
  const halfThickness = (wall.thickness ?? 0.1) / 2
  const count = Math.max(1, segments)
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
