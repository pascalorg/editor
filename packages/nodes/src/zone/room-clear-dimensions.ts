import {
  detectSpacesForLevel,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallAssemblyFaceOffsets,
  resolveWallAssemblyDatumReferences,
  type SpaceBoundaryFace,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { readFloorplanContext } from '@pascal-app/editor'
import {
  type ConstructionLengthProfile,
  type ConstructionMetricNotation,
  formatConstructionLength,
} from '../shared/construction-length'

const LINE_TOLERANCE = 1e-4
const ANGLE_TOLERANCE = 1e-3
const MIN_CLEAR_SPAN = 0.3
const MIN_ROOM_TO_ROOM_SPAN = 0.03
const FIRST_DIMENSION_POSITION = 0.32
const SECOND_DIMENSION_POSITION = 0.68
const EXTENSION_OVERSHOOT = 0.08

type FaceLine = {
  start: FloorplanPoint
  end: FloorplanPoint
}

type DimensionGeometry = Extract<FloorplanGeometry, { kind: 'dimension' }>

type ClearDimensionPolicy = Extract<
  ZoneNode['clearDimensionPolicy'],
  'inside-faces' | 'finish-faces'
>

export function buildRoomClearDimensions(
  node: ZoneNode,
  ctx: GeometryContext,
): FloorplanGeometry[] {
  if (
    node.spaceRole !== 'room' ||
    (node.clearDimensionPolicy !== 'inside-faces' &&
      node.clearDimensionPolicy !== 'finish-faces') ||
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
  const faceLines = resolveClearFaceLines(space.boundaryFaces, wallsById, node.clearDimensionPolicy)
  if (!faceLines) return []

  const unit = ctx.viewState?.unit ?? 'metric'
  const floorplanContext = readFloorplanContext(ctx)
  const profile: ConstructionLengthProfile =
    floorplanContext.purpose === 'document' ? 'document' : 'editor'
  const metricNotation = floorplanContext.metricNotation
  const stroke = ctx.viewState?.palette.measurementStroke ?? '#475569'
  const rectangle = resolveClearFaceRectangle(faceLines)
  const dimensions = rectangle
    ? buildRectangleClearDimensions(rectangle, unit, profile, metricNotation, stroke)
    : buildRectilinearClearDimensions(faceLines, unit, profile, metricNotation, stroke)
  if (dimensions.length === 0) return []
  return [
    ...dimensions,
    ...buildRoomToRoomClearDimensions(
      node,
      ctx,
      space.boundaryFaces,
      wallsById,
      unit,
      profile,
      metricNotation,
      stroke,
    ),
  ]
}

function resolveClearFaceLines(
  boundaryFaces: readonly SpaceBoundaryFace[],
  wallsById: ReadonlyMap<string, WallNode>,
  policy: ClearDimensionPolicy,
): FaceLine[] | null {
  const faceLines: FaceLine[] = []
  for (const boundary of boundaryFaces) {
    const wall = wallsById.get(boundary.wallId)
    if (!wall || Math.abs(wall.curveOffset ?? 0) > LINE_TOLERANCE) return null
    const line = offsetBoundaryFace(boundary, wall, policy)
    if (!line) return null
    faceLines.push(line)
  }

  const merged = mergeCollinearFaces(faceLines)
  return merged.length >= 4 ? merged : null
}

function resolveClearFaceRectangle(
  merged: readonly FaceLine[],
): [FloorplanPoint, FloorplanPoint, FloorplanPoint, FloorplanPoint] | null {
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

function buildRectangleClearDimensions(
  rectangle: [FloorplanPoint, FloorplanPoint, FloorplanPoint, FloorplanPoint],
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): FloorplanGeometry[] {
  const first = dimensionAcrossOppositeFaces(
    rectangle[0],
    rectangle[1],
    rectangle[3],
    rectangle[2],
    FIRST_DIMENSION_POSITION,
    unit,
    profile,
    metricNotation,
    stroke,
  )
  const second = dimensionAcrossOppositeFaces(
    rectangle[1],
    rectangle[2],
    rectangle[0],
    rectangle[3],
    SECOND_DIMENSION_POSITION,
    unit,
    profile,
    metricNotation,
    stroke,
  )
  return first && second ? [first, second] : []
}

function buildRectilinearClearDimensions(
  faceLines: readonly FaceLine[],
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): FloorplanGeometry[] {
  const vertices = clearFacePolygon(faceLines)
  if (!vertices || !isRectilinearPolygon(vertices)) return []

  const dimensions: FloorplanGeometry[] = []
  const seen = new Set<string>()
  for (let firstIndex = 0; firstIndex < faceLines.length; firstIndex++) {
    const first = faceLines[firstIndex]!
    const firstDirection = normalizedDirection(first.start, first.end)
    if (!firstDirection) return []

    for (let secondIndex = firstIndex + 1; secondIndex < faceLines.length; secondIndex++) {
      const second = faceLines[secondIndex]!
      const secondDirection = normalizedDirection(second.start, second.end)
      if (!secondDirection) return []
      if (Math.abs(dot(firstDirection, secondDirection)) < 1 - ANGLE_TOLERANCE) continue

      const dimension = dimensionBetweenOverlappingParallelFaces(
        first,
        second,
        firstDirection,
        vertices,
        unit,
        profile,
        metricNotation,
        stroke,
      )
      if (!dimension) continue
      const key = dimensionKey(dimension)
      if (seen.has(key)) continue
      seen.add(key)
      dimensions.push(dimension)
    }
  }
  return dimensions
}

function offsetBoundaryFace(
  boundary: SpaceBoundaryFace,
  wall: WallNode,
  policy: ClearDimensionPolicy,
): FaceLine | null {
  const first = boundary.points[0]
  const last = boundary.points[boundary.points.length - 1]
  if (!(first && last)) return null

  const wallDirection = normalizedDirection(wall.start, wall.end)
  if (!wallDirection) return null
  const normal: FloorplanPoint = [-wallDirection[1], wallDirection[0]]
  const side = boundary.face === 'front' ? 1 : -1
  const faces = getWallAssemblyFaceOffsets(wall)
  const offset =
    policy === 'finish-faces'
      ? resolveFinishFaceOffset(wall, side)
      : side > 0
        ? faces.exterior
        : faces.interior
  if (offset === null) return null
  return {
    start: [first[0] + normal[0] * offset, first[1] + normal[1] * offset],
    end: [last[0] + normal[0] * offset, last[1] + normal[1] * offset],
  }
}

function resolveFinishFaceOffset(wall: WallNode, side: 1 | -1): number | null {
  if ((wall.assemblyLayers ?? []).length === 0) return null
  const references = resolveWallAssemblyDatumReferences(wall).filter(
    (reference) => reference.datum === 'finish-face',
  )
  const matching = references
    .filter((reference) => Math.sign(reference.offset) === side)
    .map((reference) => reference.offset)
  if (matching.length === 0) return null
  return side > 0 ? Math.max(...matching) : Math.min(...matching)
}

function clearFacePolygon(faceLines: readonly FaceLine[]): FloorplanPoint[] | null {
  const vertices = faceLines.map((line, index) => {
    const previous = faceLines[(index + faceLines.length - 1) % faceLines.length]!
    return intersectLines(previous, line)
  })
  return vertices.some((vertex) => vertex === null) ? null : (vertices as FloorplanPoint[])
}

function isRectilinearPolygon(vertices: readonly FloorplanPoint[]): boolean {
  if (vertices.length < 4) return false
  const directions = vertices.map((start, index) =>
    normalizedDirection(start, vertices[(index + 1) % vertices.length]!),
  )
  if (directions.some((direction) => direction === null)) return false
  for (let index = 0; index < directions.length; index++) {
    const current = directions[index]!
    const next = directions[(index + 1) % directions.length]!
    if (Math.abs(dot(current, next)) > ANGLE_TOLERANCE) return false
  }
  return true
}

function dimensionBetweenOverlappingParallelFaces(
  first: FaceLine,
  second: FaceLine,
  direction: FloorplanPoint,
  polygon: readonly FloorplanPoint[],
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): DimensionGeometry | null {
  const firstStart = dot(first.start, direction)
  const firstEnd = dot(first.end, direction)
  const secondStart = dot(second.start, direction)
  const secondEnd = dot(second.end, direction)
  const overlapStart = Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd))
  const overlapEnd = Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd))
  if (overlapEnd - overlapStart < MIN_CLEAR_SPAN) return null

  const projection = (overlapStart + overlapEnd) / 2
  const start = projectPointToLineProjection(first, direction, projection)
  const end = projectPointToLineProjection(second, direction, projection)
  const midpoint: FloorplanPoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  if (!pointInPolygon(midpoint, polygon)) return null

  const axis = normalizedDirection(start, end)
  if (!axis) return null
  const length = distance(start, end)
  if (length < MIN_CLEAR_SPAN) return null

  return {
    kind: 'dimension',
    start,
    end,
    offsetNormal: [-axis[1], axis[0]],
    offsetDistance: 0,
    extensionOvershoot: EXTENSION_OVERSHOOT,
    text: formatConstructionLength(length, unit, profile, { metricNotation }),
    stroke,
  }
}

function pointInPolygon(point: FloorplanPoint, polygon: readonly FloorplanPoint[]): boolean {
  let inside = false
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index++
  ) {
    const current = polygon[index]!
    const previous = polygon[previousIndex]!
    const intersects =
      current[1] > point[1] !== previous[1] > point[1] &&
      point[0] <
        ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) +
          current[0]
    if (intersects) inside = !inside
  }
  return inside
}

function dimensionKey(dimension: DimensionGeometry): string {
  const first = `${roundKey(dimension.start[0])},${roundKey(dimension.start[1])}`
  const second = `${roundKey(dimension.end[0])},${roundKey(dimension.end[1])}`
  return first < second ? `${first}|${second}` : `${second}|${first}`
}

function roundKey(value: number): number {
  return Math.round(value / LINE_TOLERANCE)
}

function buildRoomToRoomClearDimensions(
  node: ZoneNode,
  ctx: GeometryContext,
  boundaryFaces: readonly SpaceBoundaryFace[],
  wallsById: ReadonlyMap<string, WallNode>,
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): FloorplanGeometry[] {
  if (node.clearDimensionPolicy !== 'finish-faces') return []

  const neighboringRooms = ctx.siblings.filter(
    (sibling): sibling is ZoneNode =>
      sibling.type === 'zone' &&
      sibling.id !== node.id &&
      String(node.id) < String(sibling.id) &&
      sibling.spaceRole === 'room' &&
      sibling.clearDimensionPolicy === 'finish-faces' &&
      sibling.enclosureStatus !== 'open' &&
      sibling.autoFromWalls &&
      sibling.parentId === node.parentId,
  )
  if (neighboringRooms.length === 0) return []

  const dimensions: FloorplanGeometry[] = []
  const currentBoundaryByWallId = new Map(
    boundaryFaces.map((boundary) => [boundary.wallId, boundary]),
  )

  for (const neighbor of neighboringRooms) {
    const sharedWallIds = neighbor.boundaryWallIds.filter((wallId) =>
      currentBoundaryByWallId.has(wallId),
    )
    if (sharedWallIds.length === 0) continue

    const neighborWalls = neighbor.boundaryWallIds.flatMap((id) => {
      const resolved = ctx.resolve(id)
      return resolved &&
        typeof resolved === 'object' &&
        'type' in resolved &&
        resolved.type === 'wall'
        ? [resolved as WallNode]
        : []
    })
    if (neighborWalls.length !== neighbor.boundaryWallIds.length) continue
    const neighborWallIds = new Set(neighbor.boundaryWallIds)
    const neighborSpace = detectSpacesForLevel(neighbor.parentId ?? '', neighborWalls).spaces.find(
      (candidate) =>
        candidate.wallIds.length === neighborWallIds.size &&
        candidate.wallIds.every((id) => neighborWallIds.has(id)),
    )
    if (!neighborSpace) continue
    const neighborBoundaryByWallId = new Map(
      neighborSpace.boundaryFaces.map((boundary) => [boundary.wallId, boundary]),
    )

    for (const wallId of sharedWallIds) {
      const wall = wallsById.get(wallId)
      const currentBoundary = currentBoundaryByWallId.get(wallId)
      const neighborBoundary = neighborBoundaryByWallId.get(wallId)
      if (!(wall && currentBoundary && neighborBoundary)) continue
      const currentLine = offsetBoundaryFace(currentBoundary, wall, 'finish-faces')
      const neighborLine = offsetBoundaryFace(neighborBoundary, wall, 'finish-faces')
      if (!(currentLine && neighborLine)) continue
      const dimension = dimensionAcrossSharedRoomWall(
        currentLine,
        neighborLine,
        unit,
        profile,
        metricNotation,
        stroke,
      )
      if (dimension) dimensions.push(dimension)
    }
  }

  return dimensions
}

function dimensionAcrossSharedRoomWall(
  currentLine: FaceLine,
  neighborLine: FaceLine,
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): DimensionGeometry | null {
  const direction = normalizedDirection(currentLine.start, currentLine.end)
  if (!direction) return null
  const neighborDirection = normalizedDirection(neighborLine.start, neighborLine.end)
  if (!neighborDirection || Math.abs(dot(direction, neighborDirection)) < 1 - ANGLE_TOLERANCE) {
    return null
  }

  const currentStart = dot(currentLine.start, direction)
  const currentEnd = dot(currentLine.end, direction)
  const neighborStart = dot(neighborLine.start, direction)
  const neighborEnd = dot(neighborLine.end, direction)
  const overlapStart = Math.max(
    Math.min(currentStart, currentEnd),
    Math.min(neighborStart, neighborEnd),
  )
  const overlapEnd = Math.min(
    Math.max(currentStart, currentEnd),
    Math.max(neighborStart, neighborEnd),
  )
  if (overlapEnd - overlapStart < MIN_CLEAR_SPAN) return null

  const projection = (overlapStart + overlapEnd) / 2
  const start = projectPointToLineProjection(currentLine, direction, projection)
  const end = projectPointToLineProjection(neighborLine, direction, projection)
  const clear = distance(start, end)
  if (clear < MIN_ROOM_TO_ROOM_SPAN) return null
  const axis = normalizedDirection(start, end)
  if (!axis) return null

  return {
    kind: 'dimension',
    start,
    end,
    offsetNormal: [-axis[1], axis[0]],
    offsetDistance: 0,
    extensionOvershoot: EXTENSION_OVERSHOOT,
    text: `R-R ${formatConstructionLength(clear, unit, profile, { metricNotation })}`,
    stroke,
  }
}

function projectPointToLineProjection(
  line: FaceLine,
  direction: FloorplanPoint,
  projection: number,
): FloorplanPoint {
  const originProjection = dot(line.start, direction)
  return [
    line.start[0] + direction[0] * (projection - originProjection),
    line.start[1] + direction[1] * (projection - originProjection),
  ]
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
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
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
    text: formatConstructionLength(length, unit, profile, { metricNotation }),
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
