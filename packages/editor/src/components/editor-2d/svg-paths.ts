'use client'

import type { Point2D } from '@pascal-app/core'

function toSvgX(value: number) {
  return -value
}

function toSvgY(value: number) {
  return -value
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
  const end = getArcPlanPoint(center, radius, endAngle)
  const delta = endAngle - startAngle
  const largeArcFlag = Math.abs(delta) > Math.PI ? 1 : 0
  const sweepFlag = delta >= 0 ? 1 : 0

  return `M ${toSvgX(start.x)} ${toSvgY(start.y)} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${toSvgX(end.x)} ${toSvgY(end.y)}`
}

export function buildSvgAnnularSectorPath(
  center: Point2D,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = getArcPlanPoint(center, outerRadius, startAngle)
  const outerEnd = getArcPlanPoint(center, outerRadius, endAngle)
  const innerEnd = getArcPlanPoint(center, innerRadius, endAngle)
  const innerStart = getArcPlanPoint(center, innerRadius, startAngle)
  const delta = endAngle - startAngle
  const largeArcFlag = Math.abs(delta) > Math.PI ? 1 : 0
  const sweepFlag = delta >= 0 ? 1 : 0
  const reverseSweepFlag = sweepFlag ? 0 : 1

  return [
    `M ${toSvgX(outerStart.x)} ${toSvgY(outerStart.y)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} ${sweepFlag} ${toSvgX(outerEnd.x)} ${toSvgY(outerEnd.y)}`,
    `L ${toSvgX(innerEnd.x)} ${toSvgY(innerEnd.y)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} ${reverseSweepFlag} ${toSvgX(innerStart.x)} ${toSvgY(innerStart.y)}`,
    'Z',
  ].join(' ')
}

export function formatSvgPolygonPoints(points: Point2D[]) {
  return points
    .map((point) => `${toSvgX(point.x)},${toSvgY(point.y)}`)
    .join(' ')
}

export function buildSvgArrowHeadPoints(point: Point2D, angle: number, size: number) {
  const left = {
    x: point.x - size * Math.cos(angle - Math.PI / 6),
    y: point.y - size * Math.sin(angle - Math.PI / 6),
  }
  const right = {
    x: point.x - size * Math.cos(angle + Math.PI / 6),
    y: point.y - size * Math.sin(angle + Math.PI / 6),
  }

  return formatSvgPolygonPoints([point, left, right])
}

export { toSvgPoint, toSvgX, toSvgY }
