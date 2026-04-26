import type { Point2D } from '@pascal-app/core'
import type { FloorplanLineSegment, FloorplanSelectionBounds } from './types'

export function clampPlanValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function rotatePlanVector(x: number, y: number, rotation: number): [number, number] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [x * cos + y * sin, -x * sin + y * cos]
}

export function getRotatedRectanglePolygon(
  center: Point2D,
  width: number,
  depth: number,
  rotation: number,
): Point2D[] {
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const corners: Array<[number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]

  return corners.map(([localX, localY]) => {
    const [offsetX, offsetY] = rotatePlanVector(localX, localY, rotation)
    return {
      x: center.x + offsetX,
      y: center.y + offsetY,
    }
  })
}

export function interpolatePlanPoint(start: Point2D, end: Point2D, t: number): Point2D {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
}

export function getPlanPointDistance(start: Point2D, end: Point2D): number {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

export function movePlanPointTowards(start: Point2D, end: Point2D, distance: number): Point2D {
  const totalDistance = getPlanPointDistance(start, end)
  if (totalDistance <= Number.EPSILON || distance <= 0) {
    return start
  }

  return interpolatePlanPoint(start, end, Math.min(1, distance / totalDistance))
}

export function getThickPlanLinePolygon(line: FloorplanLineSegment, thickness: number): Point2D[] {
  const dx = line.end.x - line.start.x
  const dy = line.end.y - line.start.y
  const length = Math.hypot(dx, dy)

  if (length <= Number.EPSILON || thickness <= 0) {
    return [line.start, line.end, line.end, line.start]
  }

  const halfThickness = thickness / 2
  const normalX = (-dy / length) * halfThickness
  const normalY = (dx / length) * halfThickness

  return [
    { x: line.start.x + normalX, y: line.start.y + normalY },
    { x: line.end.x + normalX, y: line.end.y + normalY },
    { x: line.end.x - normalX, y: line.end.y - normalY },
    { x: line.start.x - normalX, y: line.start.y - normalY },
  ]
}

export function getFloorplanSelectionBounds(
  start: [number, number],
  end: [number, number],
): FloorplanSelectionBounds {
  return {
    minX: Math.min(start[0], end[0]),
    maxX: Math.max(start[0], end[0]),
    minY: Math.min(start[1], end[1]),
    maxY: Math.max(start[1], end[1]),
  }
}

export function isPointInsideSelectionBounds(point: Point2D, bounds: FloorplanSelectionBounds) {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  )
}

export function isPointInsidePolygon(point: Point2D, polygon: Point2D[]) {
  let isInside = false

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]
    const previous = polygon[previousIndex]

    if (!(current && previous)) {
      continue
    }

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x

    if (intersects) {
      isInside = !isInside
    }
  }

  return isInside
}

export function isPointInsidePolygonWithHoles(
  point: Point2D,
  polygon: Point2D[],
  holes: Point2D[][] = [],
) {
  return (
    isPointInsidePolygon(point, polygon) && !holes.some((hole) => isPointInsidePolygon(point, hole))
  )
}

function getLineOrientation(start: Point2D, end: Point2D, point: Point2D) {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x)
}

function isPointOnSegment(point: Point2D, start: Point2D, end: Point2D) {
  const epsilon = 1e-9

  return (
    Math.abs(getLineOrientation(start, end, point)) <= epsilon &&
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon
  )
}

function doSegmentsIntersect(
  firstStart: Point2D,
  firstEnd: Point2D,
  secondStart: Point2D,
  secondEnd: Point2D,
) {
  const orientation1 = getLineOrientation(firstStart, firstEnd, secondStart)
  const orientation2 = getLineOrientation(firstStart, firstEnd, secondEnd)
  const orientation3 = getLineOrientation(secondStart, secondEnd, firstStart)
  const orientation4 = getLineOrientation(secondStart, secondEnd, firstEnd)

  const hasProperIntersection =
    ((orientation1 > 0 && orientation2 < 0) || (orientation1 < 0 && orientation2 > 0)) &&
    ((orientation3 > 0 && orientation4 < 0) || (orientation3 < 0 && orientation4 > 0))

  if (hasProperIntersection) {
    return true
  }

  return (
    isPointOnSegment(secondStart, firstStart, firstEnd) ||
    isPointOnSegment(secondEnd, firstStart, firstEnd) ||
    isPointOnSegment(firstStart, secondStart, secondEnd) ||
    isPointOnSegment(firstEnd, secondStart, secondEnd)
  )
}

export function doesPolygonIntersectSelectionBounds(
  polygon: Point2D[],
  bounds: FloorplanSelectionBounds,
) {
  if (polygon.length === 0) {
    return false
  }

  if (polygon.some((point) => isPointInsideSelectionBounds(point, bounds))) {
    return true
  }

  const boundsCorners: [Point2D, Point2D, Point2D, Point2D] = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]

  if (boundsCorners.some((corner) => isPointInsidePolygon(corner, polygon))) {
    return true
  }

  const boundsEdges = [
    [boundsCorners[0], boundsCorners[1]],
    [boundsCorners[1], boundsCorners[2]],
    [boundsCorners[2], boundsCorners[3]],
    [boundsCorners[3], boundsCorners[0]],
  ] as const

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]

    if (!(start && end)) {
      continue
    }

    for (const [edgeStart, edgeEnd] of boundsEdges) {
      if (doSegmentsIntersect(start, end, edgeStart, edgeEnd)) {
        return true
      }
    }
  }

  return false
}

export function getDistanceToWallSegment(
  point: Point2D,
  start: [number, number],
  end: [number, number],
) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared <= Number.EPSILON) {
    return Math.hypot(point.x - start[0], point.y - start[1])
  }

  const projection = clampPlanValue(
    ((point.x - start[0]) * dx + (point.y - start[1]) * dy) / lengthSquared,
    0,
    1,
  )
  const projectedX = start[0] + dx * projection
  const projectedY = start[1] + dy * projection

  return Math.hypot(point.x - projectedX, point.y - projectedY)
}

export function pointMatchesWallPlanPoint(
  point: Point2D | undefined,
  planPoint: [number, number],
  epsilon = 1e-6,
): boolean {
  if (!point) {
    return false
  }

  return Math.abs(point.x - planPoint[0]) <= epsilon && Math.abs(point.y - planPoint[1]) <= epsilon
}
