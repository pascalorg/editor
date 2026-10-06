'use client'

import type { Point2D } from '@pascal-app/core'

function toSvgX(value: number) {
  return value
}

function toSvgY(value: number) {
  return value
}

function toSvgPoint(point: Point2D) {
  return {
    x: toSvgX(point.x),
    y: toSvgY(point.y),
  }
}

export function formatPolygonPath(points: Point2D[], holes: Point2D[][] = []) {
  const formatSubpath = (subpathPoints: Point2D[]) => {
    const [firstPoint, ...restPoints] = subpathPoints
    if (!firstPoint) {
      return null
    }

    const firstSvgPoint = toSvgPoint(firstPoint)

    return [
      `M ${firstSvgPoint.x} ${firstSvgPoint.y}`,
      ...restPoints.map((point) => {
        const svgPoint = toSvgPoint(point)
        return `L ${svgPoint.x} ${svgPoint.y}`
      }),
      'Z',
    ].join(' ')
  }

  return [points, ...holes].map(formatSubpath).filter(Boolean).join(' ')
}

export function buildSvgPolylinePath(points: Point2D[]) {
  if (points.length < 2) {
    return null
  }

  return points
    .map((point, index) => {
      const svgPoint = toSvgPoint(point)
      return `${index === 0 ? 'M' : 'L'} ${svgPoint.x} ${svgPoint.y}`
    })
    .join(' ')
}

export function getArcPlanPoint(center: Point2D, radius: number, angle: number): Point2D {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  }
}

export function buildSvgArcPath(
  center: Point2D,
  radius: number,
  startAngle: number,
  endAngle: number,
) {
  const start = getArcPlanPoint(center, radius, startAngle)
  return `M ${toSvgX(start.x)} ${toSvgY(start.y)} ${svgArcCommands(center, radius, startAngle, endAngle)}`
}

export function buildSvgAnnularSectorPath(
  center: Point2D,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = getArcPlanPoint(center, outerRadius, startAngle)
  const innerEnd = getArcPlanPoint(center, innerRadius, endAngle)
  return [
    `M ${toSvgX(outerStart.x)} ${toSvgY(outerStart.y)}`,
    svgArcCommands(center, outerRadius, startAngle, endAngle),
    `L ${toSvgX(innerEnd.x)} ${toSvgY(innerEnd.y)}`,
    svgArcCommands(center, innerRadius, endAngle, startAngle),
    'Z',
  ].join(' ')
}

function svgArcCommands(center: Point2D, radius: number, startAngle: number, endAngle: number) {
  const delta = endAngle - startAngle
  const count = Math.max(1, Math.ceil(Math.abs(delta) / Math.PI))
  return Array.from({ length: count }, (_, index) => {
    const end = getArcPlanPoint(center, radius, startAngle + (delta * (index + 1)) / count)
    return `A ${radius} ${radius} 0 0 ${delta >= 0 ? 1 : 0} ${toSvgX(end.x)} ${toSvgY(end.y)}`
  }).join(' ')
}

export function formatSvgPolygonPoints(points: Point2D[]) {
  return points.map((point) => `${toSvgX(point.x)},${toSvgY(point.y)}`).join(' ')
}

/**
 * Three points defining an arrow head — tip + two trailing barbs.
 * Returned as plain `Point2D` objects so consumers can either feed them
 * straight into `formatSvgPolygonPoints` (for SVG `points=""`) or push
 * them onto a `FloorplanGeometry.polygon.points` array. Mixing both
 * downstream paths through a string-returning helper was awkward — see
 * `nodes/src/stair/floorplan.ts` which needs the points as objects.
 */
export function buildSvgArrowHeadPoints(point: Point2D, angle: number, size: number): Point2D[] {
  const left = {
    x: point.x - size * Math.cos(angle - Math.PI / 6),
    y: point.y - size * Math.sin(angle - Math.PI / 6),
  }
  const right = {
    x: point.x - size * Math.cos(angle + Math.PI / 6),
    y: point.y - size * Math.sin(angle + Math.PI / 6),
  }

  return [point, left, right]
}

export { toSvgPoint, toSvgX, toSvgY }
