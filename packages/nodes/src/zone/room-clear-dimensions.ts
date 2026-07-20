import {
  detectSpacesForLevel,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  type SpaceBoundaryFace,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { formatConstructionLength } from '../shared/construction-length'

const LINE_TOLERANCE = 1e-4
const ANGLE_TOLERANCE = 1e-3
const MIN_CLEAR_SPAN = 0.3
const FIRST_DIMENSION_POSITION = 0.32
const SECOND_DIMENSION_POSITION = 0.68
const EXTENSION_OVERSHOOT = 0.08

type FaceLine = {
  start: FloorplanPoint
  end: FloorplanPoint
}

export function buildRoomClearDimensions(
  node: ZoneNode,
  ctx: GeometryContext,
): FloorplanGeometry[] {
  if (
    node.spaceRole !== 'room' ||
    node.clearDimensionPolicy !== 'inside-faces' ||
    node.enclosureStatus === 'open' ||
    !node.autoFromWalls ||
    !node.parentId ||
    node.boundaryWallIds.length < 3
  ) {
    return []
  }

  const walls = node.boundaryWallIds.flatMap((id) => {
    const resolved = ctx.resolve(id)
    return resolved &&
      typeof resolved === 'object' &&
      'type' in resolved &&
      resolved.type === 'wall'
      ? [resolved as WallNode]
      : []
  })
  if (walls.length !== node.boundaryWallIds.length) return []

  const boundaryIds = new Set(node.boundaryWallIds)
  const space = detectSpacesForLevel(node.parentId, walls).spaces.find(
    (candidate) =>
      candidate.wallIds.length === boundaryIds.size &&
      candidate.wallIds.every((id) => boundaryIds.has(id)),
  )
  if (!space) return []

  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const rectangle = resolveInsideFaceRectangle(space.boundaryFaces, wallsById)
  if (!rectangle) return []

  const unit = ctx.viewState?.unit ?? 'metric'
  const stroke = ctx.viewState?.palette.measurementStroke ?? '#475569'
  const first = dimensionAcrossOppositeFaces(
    rectangle[0],
    rectangle[1],
    rectangle[3],
    rectangle[2],
    FIRST_DIMENSION_POSITION,
    unit,
    stroke,
  )
  const second = dimensionAcrossOppositeFaces(
    rectangle[1],
    rectangle[2],
    rectangle[0],
    rectangle[3],
    SECOND_DIMENSION_POSITION,
    unit,
    stroke,
  )
  return first && second ? [first, second] : []
}

function resolveInsideFaceRectangle(
  boundaryFaces: readonly SpaceBoundaryFace[],
  wallsById: ReadonlyMap<string, WallNode>,
): [FloorplanPoint, FloorplanPoint, FloorplanPoint, FloorplanPoint] | null {
  const faceLines: FaceLine[] = []
  for (const boundary of boundaryFaces) {
    const wall = wallsById.get(boundary.wallId)
    if (!wall || Math.abs(wall.curveOffset ?? 0) > LINE_TOLERANCE) return null
    const line = offsetBoundaryFace(boundary, wall)
    if (!line) return null
    faceLines.push(line)
  }

  const merged = mergeCollinearFaces(faceLines)
  if (merged.length !== 4) return null

  const vertices = merged.map((line, index) => {
    const previous = merged[(index + merged.length - 1) % merged.length]!
    return intersectLines(previous, line)
  })
  if (vertices.some((vertex) => vertex === null)) return null
  const rectangle = vertices as [FloorplanPoint, FloorplanPoint, FloorplanPoint, FloorplanPoint]
  const directions = rectangle.map((start, index) =>
    normalizedDirection(start, rectangle[(index + 1) % rectangle.length]!),
  )
  if (directions.some((direction) => direction === null)) return null
  const [first, second, third, fourth] = directions as [
    FloorplanPoint,
    FloorplanPoint,
    FloorplanPoint,
    FloorplanPoint,
  ]
  if (
    Math.abs(dot(first, second)) > ANGLE_TOLERANCE ||
    Math.abs(dot(second, third)) > ANGLE_TOLERANCE ||
    Math.abs(dot(third, fourth)) > ANGLE_TOLERANCE ||
    Math.abs(dot(fourth, first)) > ANGLE_TOLERANCE ||
    dot(first, third) > -1 + ANGLE_TOLERANCE ||
    dot(second, fourth) > -1 + ANGLE_TOLERANCE
  ) {
    return null
  }
  return rectangle
}

function offsetBoundaryFace(boundary: SpaceBoundaryFace, wall: WallNode): FaceLine | null {
  const first = boundary.points[0]
  const last = boundary.points[boundary.points.length - 1]
  if (!(first && last)) return null

  const wallDirection = normalizedDirection(wall.start, wall.end)
  if (!wallDirection) return null
  const normal: FloorplanPoint = [-wallDirection[1], wallDirection[0]]
  const side = boundary.face === 'front' ? 1 : -1
  const offset = ((wall.thickness ?? 0.2) / 2) * side
  return {
    start: [first[0] + normal[0] * offset, first[1] + normal[1] * offset],
    end: [last[0] + normal[0] * offset, last[1] + normal[1] * offset],
  }
}

function mergeCollinearFaces(lines: readonly FaceLine[]): FaceLine[] {
  const merged: FaceLine[] = []
  for (const line of lines) {
    const previous = merged[merged.length - 1]
    if (previous && canMerge(previous, line)) previous.end = line.end
    else merged.push({ ...line })
  }

  while (merged.length > 1) {
    const first = merged[0]!
    const last = merged[merged.length - 1]!
    if (!canMerge(last, first)) break
    first.start = last.start
    merged.pop()
  }
  return merged
}

function canMerge(first: FaceLine, second: FaceLine): boolean {
  const firstDirection = normalizedDirection(first.start, first.end)
  const secondDirection = normalizedDirection(second.start, second.end)
  if (!(firstDirection && secondDirection)) return false
  return (
    dot(firstDirection, secondDirection) > 1 - ANGLE_TOLERANCE &&
    pointLineDistance(second.start, first) <= LINE_TOLERANCE
  )
}

function intersectLines(first: FaceLine, second: FaceLine): FloorplanPoint | null {
  const firstDirection: FloorplanPoint = [
    first.end[0] - first.start[0],
    first.end[1] - first.start[1],
  ]
  const secondDirection: FloorplanPoint = [
    second.end[0] - second.start[0],
    second.end[1] - second.start[1],
  ]
  const denominator = cross(firstDirection, secondDirection)
  if (Math.abs(denominator) <= LINE_TOLERANCE) return null
  const delta: FloorplanPoint = [second.start[0] - first.start[0], second.start[1] - first.start[1]]
  const parameter = cross(delta, secondDirection) / denominator
  return [
    first.start[0] + firstDirection[0] * parameter,
    first.start[1] + firstDirection[1] * parameter,
  ]
}

function dimensionAcrossOppositeFaces(
  firstStart: FloorplanPoint,
  firstEnd: FloorplanPoint,
  oppositeStart: FloorplanPoint,
  oppositeEnd: FloorplanPoint,
  position: number,
  unit: 'metric' | 'imperial',
  stroke: string,
): FloorplanGeometry | null {
  const start = interpolate(firstStart, firstEnd, position)
  const end = interpolate(oppositeStart, oppositeEnd, position)
  const direction = normalizedDirection(start, end)
  if (!direction) return null
  const length = distance(start, end)
  if (length < MIN_CLEAR_SPAN) return null
  return {
    kind: 'dimension',
    start,
    end,
    offsetNormal: [-direction[1], direction[0]],
    offsetDistance: 0,
    extensionOvershoot: EXTENSION_OVERSHOOT,
    text: formatConstructionLength(length, unit),
    stroke,
  }
}

function normalizedDirection(
  start: readonly [number, number],
  end: readonly [number, number],
): FloorplanPoint | null {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  return length <= LINE_TOLERANCE ? null : [dx / length, dy / length]
}

function pointLineDistance(point: FloorplanPoint, line: FaceLine): number {
  const direction = normalizedDirection(line.start, line.end)
  if (!direction) return Number.POSITIVE_INFINITY
  return Math.abs(cross(direction, [point[0] - line.start[0], point[1] - line.start[1]]))
}

function interpolate(start: FloorplanPoint, end: FloorplanPoint, t: number): FloorplanPoint {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
}

function distance(first: FloorplanPoint, second: FloorplanPoint): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1])
}

function dot(first: FloorplanPoint, second: FloorplanPoint): number {
  return first[0] * second[0] + first[1] * second[1]
}

function cross(first: FloorplanPoint, second: FloorplanPoint): number {
  return first[0] * second[1] - first[1] * second[0]
}
