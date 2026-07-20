import {
  type DoorNode,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  isCurvedWall,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'

const OPENING_CHAIN_OFFSET = 0.45
const WALL_SPAN_OFFSET = 0.82
const EXTENSION_OVERSHOOT = 0.12
const MIN_SEGMENT_LENGTH = 0.02
const INCHES_PER_METER = 1 / 0.0254
const IMPERIAL_FRACTION_DENOMINATOR = 16

type LinearUnit = 'metric' | 'imperial'
type OpeningNode = DoorNode | WindowNode

export function formatConstructionLength(meters: number, unit: LinearUnit): string {
  if (!Number.isFinite(meters)) return '--'

  if (unit === 'metric') {
    const rounded = Number.parseFloat(Math.abs(meters).toFixed(2))
    const sign = meters < 0 && rounded !== 0 ? '-' : ''
    return `${sign}${rounded}m`
  }

  const sign = meters < 0 ? '-' : ''
  const totalFractionUnits = Math.round(
    Math.abs(meters) * INCHES_PER_METER * IMPERIAL_FRACTION_DENOMINATOR,
  )
  const unitsPerFoot = 12 * IMPERIAL_FRACTION_DENOMINATOR
  const feet = Math.floor(totalFractionUnits / unitsPerFoot)
  const remainder = totalFractionUnits - feet * unitsPerFoot
  const inches = Math.floor(remainder / IMPERIAL_FRACTION_DENOMINATOR)
  const numerator = remainder - inches * IMPERIAL_FRACTION_DENOMINATOR
  const fraction = formatFraction(numerator, IMPERIAL_FRACTION_DENOMINATOR)
  const inchText = fraction ? `${inches} ${fraction}` : `${inches}`

  return `${sign}${feet}'-${inchText}"`
}

export function buildWallConstructionDimensions(
  wall: WallNode,
  ctx: GeometryContext,
  {
    unit,
    stroke,
    force = false,
  }: {
    unit: LinearUnit
    stroke?: string
    force?: boolean
  },
): FloorplanGeometry[] {
  if (isCurvedWall(wall)) return []

  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dz)
  if (wallLength < MIN_SEGMENT_LENGTH) return []

  const sideIsClassified = wall.frontSide !== 'unknown' || wall.backSide !== 'unknown'
  const isExterior = wall.frontSide === 'exterior' || wall.backSide === 'exterior'
  if (!force && sideIsClassified && !isExterior) return []

  const dirX = dx / wallLength
  const dirZ = dz / wallLength
  const outwardNormal = resolveOutwardNormal(wall, ctx, dirX, dirZ)
  const halfThickness = (wall.thickness ?? 0.1) / 2
  const pointAt = (along: number): FloorplanPoint => [
    wall.start[0] + dirX * along + outwardNormal[0] * halfThickness,
    wall.start[1] + dirZ * along + outwardNormal[1] * halfThickness,
  ]

  const openings = ctx.children
    .filter((child): child is OpeningNode => child.type === 'door' || child.type === 'window')
    .flatMap((opening) => {
      const halfWidth = Math.max(0, opening.width) / 2
      const start = clamp(opening.position[0] - halfWidth, 0, wallLength)
      const end = clamp(opening.position[0] + halfWidth, 0, wallLength)
      return end - start >= MIN_SEGMENT_LENGTH ? ([start, end] as const) : []
    })

  const dimensions: FloorplanGeometry[] = []
  if (openings.length > 0) {
    const breakpoints = uniqueSorted([0, wallLength, ...openings.flat()])
    for (let index = 0; index < breakpoints.length - 1; index++) {
      const start = breakpoints[index]!
      const end = breakpoints[index + 1]!
      if (end - start < MIN_SEGMENT_LENGTH) continue
      dimensions.push(
        dimension(pointAt(start), pointAt(end), outwardNormal, OPENING_CHAIN_OFFSET, unit, stroke),
      )
    }
  }

  dimensions.push(
    dimension(
      pointAt(0),
      pointAt(wallLength),
      outwardNormal,
      openings.length > 0 ? WALL_SPAN_OFFSET : OPENING_CHAIN_OFFSET,
      unit,
      stroke,
    ),
  )

  return dimensions
}

function dimension(
  start: FloorplanPoint,
  end: FloorplanPoint,
  offsetNormal: FloorplanPoint,
  offsetDistance: number,
  unit: LinearUnit,
  stroke?: string,
): FloorplanGeometry {
  return {
    kind: 'dimension',
    start,
    end,
    offsetNormal,
    offsetDistance,
    extensionOvershoot: EXTENSION_OVERSHOOT,
    text: formatConstructionLength(Math.hypot(end[0] - start[0], end[1] - start[1]), unit),
    stroke,
  }
}

function resolveOutwardNormal(
  wall: WallNode,
  ctx: GeometryContext,
  dirX: number,
  dirZ: number,
): FloorplanPoint {
  const front: FloorplanPoint = [cleanZero(-dirZ), cleanZero(dirX)]
  if (wall.frontSide === 'exterior' && wall.backSide !== 'exterior') return front
  if (wall.backSide === 'exterior' && wall.frontSide !== 'exterior') return negate(front)

  const walls = [
    wall,
    ...ctx.siblings.filter((sibling): sibling is WallNode => sibling.type === 'wall'),
  ]
  let sumX = 0
  let sumZ = 0
  for (const candidate of walls) {
    sumX += candidate.start[0] + candidate.end[0]
    sumZ += candidate.start[1] + candidate.end[1]
  }
  const centroidX = sumX / (walls.length * 2)
  const centroidZ = sumZ / (walls.length * 2)
  const midX = (wall.start[0] + wall.end[0]) / 2
  const midZ = (wall.start[1] + wall.end[1]) / 2
  return (midX - centroidX) * front[0] + (midZ - centroidZ) * front[1] >= 0 ? front : negate(front)
}

function negate(point: FloorplanPoint): FloorplanPoint {
  return [cleanZero(-point[0]), cleanZero(-point[1])]
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value
}

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]!) > 1e-6)
}

function formatFraction(numerator: number, denominator: number): string {
  if (numerator === 0) return ''
  const divisor = greatestCommonDivisor(numerator, denominator)
  return `${numerator / divisor}/${denominator / divisor}`
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a)
  let right = Math.abs(b)
  while (right !== 0) {
    const next = left % right
    left = right
    right = next
  }
  return left || 1
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
