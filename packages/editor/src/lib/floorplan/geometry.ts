import type { Point2D } from '@pascal-app/core'
import type { FloorplanLineSegment, FloorplanSelectionBounds } from './types'

// Baseline rotation (deg) that orients the plan-local scene "north up" on
// screen. The on-screen floor-plan scene `<g>` is rotated by
// `FLOORPLAN_VIEW_ROTATION_DEG + userRotation - buildingRotation`; the PDF
// export mirrors the aligned-to-north case (user offset 0) so an export points
// the same way as the app's north-aligned view.
//
// North is world −Z: with a 0 baseline a rotation-0 reference image (top =
// −Z) reads upright in the north-aligned view, and "align north" maps to a
// 3D camera azimuth of 0. The old 90° baseline made north world −X, so
// north-up floorplan scans displayed sideways whenever the compass claimed
// the view was aligned.
export const FLOORPLAN_VIEW_ROTATION_DEG = 0

export function clampPlanValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function rotatePlanVector(x: number, y: number, rotation: number): [number, number] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [x * cos + y * sin, -x * sin + y * cos]
}

// Converts a world X/Z point into the floor-plan-local (building-local)
// frame used by the SVG scene `<g>` and every stored node position. The
// inverse of `floorplanLocalToWorldPoint`. Shared so the floor-plan panel
// and the 2D move overlay resolve the same frame — feeding a world-space
// `original` into a local-space cursor solver lands the drop off by the
// building's world X/Z (worse for an off-origin building).
export function worldToFloorplanLocalPoint(
  worldX: number,
  worldZ: number,
  buildingPosition: readonly [number, number, number],
  buildingRotationY: number,
): Point2D {
  const dx = worldX - buildingPosition[0]
  const dz = worldZ - buildingPosition[2]
  const cos = Math.cos(buildingRotationY)
  const sin = Math.sin(buildingRotationY)

  return {
    x: dx * cos - dz * sin,
    y: dx * sin + dz * cos,
  }
}

// Inverse of `worldToFloorplanLocalPoint`: floor-plan-local X/Y → world X/Z.
export function floorplanLocalToWorldPoint(
  point: Point2D | [number, number],
  buildingPosition: readonly [number, number, number],
  buildingRotationY: number,
): { x: number; z: number } {
  const localX = Array.isArray(point) ? point[0] : point.x
  const localY = Array.isArray(point) ? point[1] : point.y
  const cos = Math.cos(buildingRotationY)
  const sin = Math.sin(buildingRotationY)

  return {
    x: buildingPosition[0] + localX * cos + localY * sin,
    z: buildingPosition[2] - localX * sin + localY * cos,
  }
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
