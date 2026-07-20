import {
  type AnyNode,
  type DoorNode,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  isCurvedWall,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import {
  type ConstructionLinearUnit,
  formatConstructionLength,
} from '../shared/construction-length'

export { formatConstructionLength } from '../shared/construction-length'

const OPENING_CHAIN_OFFSET = 0.45
const WALL_SPAN_OFFSET = 0.82
const FACADE_OPENING_WIDTH_OFFSET = 0.18
const FACADE_OPENING_OFFSET = 0.45
const FACADE_PARTITION_OFFSET = 0.93
const FACADE_OVERALL_OFFSET = 1.41
const EXTENSION_OVERSHOOT = 0.12
const MIN_SEGMENT_LENGTH = 0.02
const FACADE_LINE_TOLERANCE = 0.03
const FACADE_DIRECTION_TOLERANCE = 0.001

type OpeningNode = DoorNode | WindowNode

export type ConstructionDimensionTier = 'opening-widths' | 'openings' | 'partitions' | 'overall'

export type PlannedConstructionDimension = {
  tier: ConstructionDimensionTier
  start: FloorplanPoint
  end: FloorplanPoint
  offsetNormal: FloorplanPoint
  offsetDistance: number
}

export type WallConstructionDimensionPlan = ReadonlyMap<
  string,
  readonly PlannedConstructionDimension[]
>

type FacadeMember = {
  wall: WallNode
  normal: FloorplanPoint
  tangent: FloorplanPoint
}

export function buildLevelWallConstructionDimensionPlan(
  walls: ReadonlyArray<WallNode>,
  nodes: Record<string, AnyNode>,
): WallConstructionDimensionPlan {
  const groups = new Map<string, FacadeMember[]>()

  for (const wall of walls) {
    if (isCurvedWall(wall)) continue
    const normal = exteriorNormal(wall)
    if (!normal) continue
    const tangent: FloorplanPoint = [cleanZero(normal[1]), cleanZero(-normal[0])]
    const midpoint: FloorplanPoint = [
      (wall.start[0] + wall.end[0]) / 2,
      (wall.start[1] + wall.end[1]) / 2,
    ]
    const directionKey = `${Math.round(normal[0] / FACADE_DIRECTION_TOLERANCE)},${Math.round(normal[1] / FACADE_DIRECTION_TOLERANCE)}`
    const lineKey = Math.round(dot(midpoint, normal) / FACADE_LINE_TOLERANCE)
    const key = `${directionKey}:${lineKey}`
    const members = groups.get(key)
    const member = { wall, normal, tangent }
    if (members) members.push(member)
    else groups.set(key, [member])
  }

  const dimensionsByWallId = new Map<string, PlannedConstructionDimension[]>()
  for (const groupedMembers of groups.values()) {
    for (const members of splitFacadeRuns(groupedMembers)) {
      members.sort((left, right) => String(left.wall.id).localeCompare(String(right.wall.id)))
      const representative = members[0]
      if (!representative) continue
      const { normal, tangent } = representative

      const wallProjections = members.flatMap(({ wall }) => [
        dot(wall.start, tangent),
        dot(wall.end, tangent),
      ])
      const extentStart = Math.min(...wallProjections)
      const extentEnd = Math.max(...wallProjections)
      if (extentEnd - extentStart < MIN_SEGMENT_LENGTH) continue

      const faceCoordinate = Math.max(
        ...members.map(({ wall }) => {
          const midpoint: FloorplanPoint = [
            (wall.start[0] + wall.end[0]) / 2,
            (wall.start[1] + wall.end[1]) / 2,
          ]
          return dot(midpoint, normal) + (wall.thickness ?? 0.1) / 2
        }),
      )
      const pointAt = (projection: number): FloorplanPoint => [
        tangent[0] * projection + normal[0] * faceCoordinate,
        tangent[1] * projection + normal[1] * faceCoordinate,
      ]

      const openingCenters: number[] = []
      const openingSpans: Array<readonly [number, number]> = []
      for (const { wall } of members) {
        const dx = wall.end[0] - wall.start[0]
        const dz = wall.end[1] - wall.start[1]
        const length = Math.hypot(dx, dz)
        if (length < MIN_SEGMENT_LENGTH) continue
        for (const opening of Object.values(nodes)) {
          if (opening.type !== 'door' && opening.type !== 'window') continue
          if (opening.visible === false) continue
          const hostWallId = opening.wallId ?? opening.parentId
          if (hostWallId !== wall.id) continue
          const along = clamp(opening.position[0], 0, length)
          const center: FloorplanPoint = [
            wall.start[0] + (dx / length) * along,
            wall.start[1] + (dz / length) * along,
          ]
          openingCenters.push(dot(center, tangent))
          const halfWidth = Math.max(0, opening.width) / 2
          const startAlong = clamp(along - halfWidth, 0, length)
          const endAlong = clamp(along + halfWidth, 0, length)
          const startPoint: FloorplanPoint = [
            wall.start[0] + (dx / length) * startAlong,
            wall.start[1] + (dz / length) * startAlong,
          ]
          const endPoint: FloorplanPoint = [
            wall.start[0] + (dx / length) * endAlong,
            wall.start[1] + (dz / length) * endAlong,
          ]
          const startProjection = dot(startPoint, tangent)
          const endProjection = dot(endPoint, tangent)
          if (Math.abs(endProjection - startProjection) >= MIN_SEGMENT_LENGTH) {
            openingSpans.push([
              Math.min(startProjection, endProjection),
              Math.max(startProjection, endProjection),
            ])
          }
        }
      }

      const memberIds = new Set(members.map(({ wall }) => wall.id))
      const partitionReferences: number[] = []
      for (const candidate of walls) {
        if (memberIds.has(candidate.id) || isCurvedWall(candidate)) continue
        for (const { wall } of members) {
          const intersection = facadeInsideFaceIntersection(wall, candidate, normal)
          if (!intersection) continue
          const projection = dot(intersection, tangent)
          if (
            projection > extentStart + MIN_SEGMENT_LENGTH &&
            projection < extentEnd - MIN_SEGMENT_LENGTH
          ) {
            partitionReferences.push(projection)
          }
        }
      }

      const planned: PlannedConstructionDimension[] = []
      openingSpans
        .sort((left, right) => left[0] - right[0])
        .forEach(([start, end]) => {
          planned.push({
            tier: 'opening-widths',
            start: pointAt(start),
            end: pointAt(end),
            offsetNormal: normal,
            offsetDistance: FACADE_OPENING_WIDTH_OFFSET,
          })
        })
      appendTier(
        planned,
        openingCenters,
        extentStart,
        extentEnd,
        pointAt,
        normal,
        'openings',
        FACADE_OPENING_OFFSET,
      )
      appendTier(
        planned,
        partitionReferences,
        extentStart,
        extentEnd,
        pointAt,
        normal,
        'partitions',
        FACADE_PARTITION_OFFSET,
      )
      planned.push({
        tier: 'overall',
        start: pointAt(extentStart),
        end: pointAt(extentEnd),
        offsetNormal: normal,
        offsetDistance: FACADE_OVERALL_OFFSET,
      })
      dimensionsByWallId.set(representative.wall.id, planned)
    }
  }

  return dimensionsByWallId
}

export function renderPlannedConstructionDimensions(
  planned: readonly PlannedConstructionDimension[],
  unit: ConstructionLinearUnit,
  stroke?: string,
): FloorplanGeometry[] {
  return planned.map((entry) =>
    dimension(entry.start, entry.end, entry.offsetNormal, entry.offsetDistance, unit, stroke),
  )
}

export function buildWallConstructionDimensions(
  wall: WallNode,
  ctx: GeometryContext,
  {
    unit,
    stroke,
  }: {
    unit: ConstructionLinearUnit
    stroke?: string
  },
): FloorplanGeometry[] {
  if (isCurvedWall(wall)) return []

  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dz)
  if (wallLength < MIN_SEGMENT_LENGTH) return []

  const sideIsClassified = wall.frontSide !== 'unknown' || wall.backSide !== 'unknown'
  const isExterior = wall.frontSide === 'exterior' || wall.backSide === 'exterior'
  if (sideIsClassified && !isExterior) return []

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
  unit: ConstructionLinearUnit,
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

function exteriorNormal(wall: WallNode): FloorplanPoint | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < MIN_SEGMENT_LENGTH) return null
  const front: FloorplanPoint = [cleanZero(-dz / length), cleanZero(dx / length)]
  if (wall.frontSide === 'exterior' && wall.backSide !== 'exterior') return front
  if (wall.backSide === 'exterior' && wall.frontSide !== 'exterior') return negate(front)
  return null
}

function splitFacadeRuns(members: FacadeMember[]): FacadeMember[][] {
  const tangent = members[0]?.tangent
  if (!tangent) return []
  const sorted = [...members].sort((left, right) => {
    const leftStart = Math.min(dot(left.wall.start, tangent), dot(left.wall.end, tangent))
    const rightStart = Math.min(dot(right.wall.start, tangent), dot(right.wall.end, tangent))
    return leftStart - rightStart
  })
  const runs: FacadeMember[][] = []
  let runEnd = Number.NEGATIVE_INFINITY
  for (const member of sorted) {
    const start = Math.min(dot(member.wall.start, tangent), dot(member.wall.end, tangent))
    const end = Math.max(dot(member.wall.start, tangent), dot(member.wall.end, tangent))
    const current = runs.at(-1)
    if (!current || start > runEnd + FACADE_LINE_TOLERANCE) {
      runs.push([member])
      runEnd = end
    } else {
      current.push(member)
      runEnd = Math.max(runEnd, end)
    }
  }
  return runs
}

function facadeInsideFaceIntersection(
  facade: WallNode,
  candidate: WallNode,
  outwardNormal: FloorplanPoint,
): FloorplanPoint | null {
  const halfThickness = (facade.thickness ?? 0.1) / 2
  const insideStart: FloorplanPoint = [
    facade.start[0] - outwardNormal[0] * halfThickness,
    facade.start[1] - outwardNormal[1] * halfThickness,
  ]
  const insideEnd: FloorplanPoint = [
    facade.end[0] - outwardNormal[0] * halfThickness,
    facade.end[1] - outwardNormal[1] * halfThickness,
  ]
  return segmentIntersection(insideStart, insideEnd, candidate.start, candidate.end)
}

function appendTier(
  out: PlannedConstructionDimension[],
  references: number[],
  extentStart: number,
  extentEnd: number,
  pointAt: (projection: number) => FloorplanPoint,
  offsetNormal: FloorplanPoint,
  tier: Exclude<ConstructionDimensionTier, 'overall'>,
  offsetDistance: number,
): void {
  const interiorReferences = references.filter(
    (value) => value > extentStart + MIN_SEGMENT_LENGTH && value < extentEnd - MIN_SEGMENT_LENGTH,
  )
  if (interiorReferences.length === 0) return
  appendDimensionChain(
    out,
    interiorReferences,
    extentStart,
    extentEnd,
    pointAt,
    offsetNormal,
    tier,
    offsetDistance,
  )
}

function appendDimensionChain(
  out: PlannedConstructionDimension[],
  references: number[],
  extentStart: number,
  extentEnd: number,
  pointAt: (projection: number) => FloorplanPoint,
  offsetNormal: FloorplanPoint,
  tier: Exclude<ConstructionDimensionTier, 'overall'>,
  offsetDistance: number,
): void {
  const breakpoints = uniqueSorted([extentStart, ...references, extentEnd])
  for (let index = 0; index < breakpoints.length - 1; index++) {
    const start = breakpoints[index]
    const end = breakpoints[index + 1]
    if (start === undefined || end === undefined || end - start < MIN_SEGMENT_LENGTH) continue
    out.push({
      tier,
      start: pointAt(start),
      end: pointAt(end),
      offsetNormal,
      offsetDistance,
    })
  }
}

function segmentIntersection(
  aStart: FloorplanPoint,
  aEnd: FloorplanPoint,
  bStart: FloorplanPoint,
  bEnd: FloorplanPoint,
): FloorplanPoint | null {
  const ax = aEnd[0] - aStart[0]
  const ay = aEnd[1] - aStart[1]
  const bx = bEnd[0] - bStart[0]
  const by = bEnd[1] - bStart[1]
  const denominator = ax * by - ay * bx
  if (Math.abs(denominator) < 1e-8) return null

  const qx = bStart[0] - aStart[0]
  const qy = bStart[1] - aStart[1]
  const alongA = (qx * by - qy * bx) / denominator
  const alongB = (qx * ay - qy * ax) / denominator
  if (alongA < -1e-6 || alongA > 1 + 1e-6 || alongB < -1e-6 || alongB > 1 + 1e-6) {
    return null
  }
  return [aStart[0] + ax * alongA, aStart[1] + ay * alongA]
}

function dot(left: FloorplanPoint, right: FloorplanPoint): number {
  return left[0] * right[0] + left[1] * right[1]
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
