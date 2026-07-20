import {
  type AnyNode,
  type ColumnNode,
  type DoorNode,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  isCurvedWall,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { getColumnFloorplanFootprint } from '../column/floorplan'
import {
  type ConstructionLengthProfile,
  type ConstructionLinearUnit,
  formatConstructionLength,
} from '../shared/construction-length'

export { formatConstructionLength } from '../shared/construction-length'

const OPENING_CHAIN_OFFSET = 0.55
const WALL_SPAN_OFFSET = 1.05
const FIRST_OPENING_WIDTH_OFFSET = 0.28
const FIRST_GENERAL_TIER_OFFSET = 0.55
const TIER_SPACING = 0.62
const EXTENSION_OVERSHOOT = 0.12
const MIN_SEGMENT_LENGTH = 0.02
const FACADE_LINE_TOLERANCE = 0.03
const FACADE_DIRECTION_TOLERANCE = 0.001
const COLUMN_ROW_TOLERANCE = 0.05

type OpeningNode = DoorNode | WindowNode

export type ConstructionDimensionTier =
  | 'opening-widths'
  | 'openings'
  | 'partitions'
  | 'structure'
  | 'jogs'
  | 'overall'
  | 'structural-overall'
  | 'interior'
  | 'interior-overall'

const TIER_ORDER: readonly ConstructionDimensionTier[] = [
  'opening-widths',
  'openings',
  'partitions',
  'structure',
  'jogs',
  'overall',
  'structural-overall',
]

export type PlannedConstructionDimension = {
  tier: ConstructionDimensionTier
  start: FloorplanPoint
  end: FloorplanPoint
  dimensionStart?: FloorplanPoint
  dimensionEnd?: FloorplanPoint
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

type PendingConstructionDimension = {
  tier: ConstructionDimensionTier
  start: FloorplanPoint
  end: FloorplanPoint
  startProjection: number
  endProjection: number
}

export function buildLevelWallConstructionDimensionPlan(
  walls: ReadonlyArray<WallNode>,
  nodes: Record<string, AnyNode>,
): WallConstructionDimensionPlan {
  const dimensionsByWallId = new Map<string, PlannedConstructionDimension[]>()
  const wallNetworkById = buildWallNetworkIndex(walls)
  const exteriorMembers = walls.flatMap((wall): FacadeMember[] => {
    if (isCurvedWall(wall)) return []
    const normal = exteriorNormal(wall)
    if (!normal) return []
    const network = wallNetworkById.get(wall.id) ?? [wall]
    if (isFacadeOccluded(wall, normal, network)) return []
    return [{ wall, normal, tangent: [cleanZero(normal[1]), cleanZero(-normal[0])] }]
  })
  const columns = Object.values(nodes).filter(
    (node): node is ColumnNode => node.type === 'column' && node.visible !== false,
  )

  const components = splitConnectedFacadeComponents(exteriorMembers)
  for (const component of components) {
    const directionGroups = groupFacadeMembersByDirection(component)
    const componentColumns = columns.filter(
      (column) =>
        column.parentId === component[0]?.wall.parentId &&
        nearestFacadeComponent(column, components) === component,
    )

    for (const directionMembers of directionGroups.values()) {
      const representative = [...directionMembers].sort((left, right) =>
        String(left.wall.id).localeCompare(String(right.wall.id)),
      )[0]
      if (!representative) continue
      const { normal, tangent } = representative
      const wallProjections = directionMembers.flatMap(({ wall }) => [
        dot(wall.start, tangent),
        dot(wall.end, tangent),
      ])
      const extentStart = Math.min(...wallProjections)
      const extentEnd = Math.max(...wallProjections)
      if (extentEnd - extentStart < MIN_SEGMENT_LENGTH) continue

      const outerFaceCoordinate = Math.max(
        ...directionMembers.map(({ wall }) => exteriorFaceCoordinate(wall, normal)),
      )
      const pending: PendingConstructionDimension[] = []
      const lineGroups = groupFacadeMembersByLine(directionMembers, normal)

      for (const groupedMembers of lineGroups.values()) {
        for (const run of splitFacadeRuns(groupedMembers)) {
          appendFacadeRunDimensions(pending, run, walls, nodes, normal, tangent)
        }
      }

      if (lineGroups.size > 1) {
        const jogProjections = uniqueSorted(wallProjections)
        appendProjectedChain(pending, jogProjections, 'jogs', (projection) =>
          exteriorOriginAtProjection(directionMembers, projection, tangent, normal),
        )
      }

      const exteriorColumns = componentColumns.filter(
        (column) =>
          dot(columnPlanPoint(column), normal) + columnNormalHalfExtent(column, normal) >=
          outerFaceCoordinate - FACADE_LINE_TOLERANCE,
      )
      const structureRow = outermostColumnRow(exteriorColumns, component, normal, tangent)
      if (structureRow.length >= 2) {
        const projections = uniqueSorted(
          structureRow.map((column) => dot(columnPlanPoint(column), tangent)),
        )
        appendProjectedChain(pending, projections, 'structure', (projection) =>
          columnOriginAtProjection(structureRow, projection, tangent),
        )
      }

      pending.push({
        tier: 'overall',
        start: exteriorOriginAtProjection(directionMembers, extentStart, tangent, normal),
        end: exteriorOriginAtProjection(directionMembers, extentEnd, tangent, normal),
        startProjection: extentStart,
        endProjection: extentEnd,
      })

      const structuralProjections = structureRow.map((column) =>
        dot(columnPlanPoint(column), tangent),
      )
      const structuralStart = Math.min(extentStart, ...structuralProjections)
      const structuralEnd = Math.max(extentEnd, ...structuralProjections)
      if (
        structureRow.length >= 2 &&
        (structuralStart < extentStart - MIN_SEGMENT_LENGTH ||
          structuralEnd > extentEnd + MIN_SEGMENT_LENGTH)
      ) {
        pending.push({
          tier: 'structural-overall',
          start:
            structuralStart < extentStart - MIN_SEGMENT_LENGTH
              ? columnOriginAtProjection(structureRow, structuralStart, tangent)
              : exteriorOriginAtProjection(directionMembers, extentStart, tangent, normal),
          end:
            structuralEnd > extentEnd + MIN_SEGMENT_LENGTH
              ? columnOriginAtProjection(structureRow, structuralEnd, tangent)
              : exteriorOriginAtProjection(directionMembers, extentEnd, tangent, normal),
          startProjection: structuralStart,
          endProjection: structuralEnd,
        })
      }

      const structuralFaceCoordinate = Math.max(
        outerFaceCoordinate,
        ...structureRow.map(
          (column) => dot(columnPlanPoint(column), normal) + columnNormalHalfExtent(column, normal),
        ),
      )
      dimensionsByWallId.set(
        representative.wall.id,
        finalizeDimensionTiers(pending, tangent, normal, structuralFaceCoordinate),
      )
    }
  }

  for (const wall of walls) {
    if (isCurvedWall(wall)) continue
    const openings = hostedOpeningsForWall(wall, nodes)
    const network = wallNetworkById.get(wall.id) ?? [wall]
    if (!shouldDimensionInteriorWall(wall, walls, openings, network)) continue
    const planned = buildInteriorWallDimensions(wall, walls, openings)
    if (planned.length > 0) dimensionsByWallId.set(wall.id, planned)
  }

  return dimensionsByWallId
}

function buildInteriorWallDimensions(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
  openings: readonly OpeningNode[],
): PlannedConstructionDimension[] {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dz)
  if (wallLength < MIN_SEGMENT_LENGTH) return []

  const tangent: FloorplanPoint = [dx / wallLength, dz / wallLength]
  const [spanStart, spanEnd] = interiorWallClearSpan(wall, walls, tangent, wallLength)
  if (spanEnd - spanStart < MIN_SEGMENT_LENGTH) return []
  const normal = resolveInteriorDimensionNormal(wall, walls, tangent)
  const halfThickness = (wall.thickness ?? 0.1) / 2
  const pointAt = (along: number): FloorplanPoint => [
    wall.start[0] + tangent[0] * along + normal[0] * halfThickness,
    wall.start[1] + tangent[1] * along + normal[1] * halfThickness,
  ]
  const openingSpans = openings.flatMap((opening): Array<readonly [number, number]> => {
    const halfWidth = Math.max(0, opening.width) / 2
    const start = clamp(opening.position[0] - halfWidth, spanStart, spanEnd)
    const end = clamp(opening.position[0] + halfWidth, spanStart, spanEnd)
    return end - start >= MIN_SEGMENT_LENGTH ? [[start, end]] : []
  })

  const planned: PlannedConstructionDimension[] = []
  if (openingSpans.length > 0) {
    const breakpoints = uniqueSorted([spanStart, spanEnd, ...openingSpans.flat()])
    for (let index = 0; index < breakpoints.length - 1; index++) {
      const start = breakpoints[index]
      const end = breakpoints[index + 1]
      if (start === undefined || end === undefined || end - start < MIN_SEGMENT_LENGTH) continue
      planned.push({
        tier: 'interior',
        start: pointAt(start),
        end: pointAt(end),
        offsetNormal: normal,
        offsetDistance: OPENING_CHAIN_OFFSET,
      })
    }
  }

  planned.push({
    tier: 'interior-overall',
    start: pointAt(spanStart),
    end: pointAt(spanEnd),
    offsetNormal: normal,
    offsetDistance: openingSpans.length > 0 ? WALL_SPAN_OFFSET : OPENING_CHAIN_OFFSET,
  })
  return planned
}

function interiorWallClearSpan(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
  tangent: FloorplanPoint,
  wallLength: number,
): readonly [number, number] {
  const insetAt = (endpoint: FloorplanPoint, inward: FloorplanPoint): number => {
    let inset = 0
    for (const candidate of walls) {
      if (
        candidate.id === wall.id ||
        isCurvedWall(candidate) ||
        pointSegmentDistance(endpoint, candidate.start, candidate.end) > FACADE_LINE_TOLERANCE
      ) {
        continue
      }
      const candidateDirection = subtract(candidate.end, candidate.start)
      const candidateLength = Math.hypot(candidateDirection[0], candidateDirection[1])
      if (candidateLength < MIN_SEGMENT_LENGTH) continue
      const candidateNormal: FloorplanPoint = [
        -candidateDirection[1] / candidateLength,
        candidateDirection[0] / candidateLength,
      ]
      const crossing = Math.abs(dot(inward, candidateNormal))
      if (crossing < FACADE_DIRECTION_TOLERANCE) continue
      inset = Math.max(inset, (candidate.thickness ?? 0.1) / 2 / crossing)
    }
    return inset
  }

  const spanStart = clamp(insetAt(wall.start, tangent), 0, wallLength)
  const spanEnd = clamp(wallLength - insetAt(wall.end, negate(tangent)), spanStart, wallLength)
  return [spanStart, spanEnd]
}

export function renderPlannedConstructionDimensions(
  planned: readonly PlannedConstructionDimension[],
  unit: ConstructionLinearUnit,
  stroke?: string,
  profile: ConstructionLengthProfile = 'editor',
): FloorplanGeometry[] {
  return planned.map((entry) =>
    dimension(
      entry.start,
      entry.end,
      entry.offsetNormal,
      entry.offsetDistance,
      unit,
      stroke,
      entry.dimensionStart,
      entry.dimensionEnd,
      profile,
    ),
  )
}

export function buildWallConstructionDimensions(
  wall: WallNode,
  ctx: GeometryContext,
  {
    unit,
    stroke,
    profile = 'editor',
  }: {
    unit: ConstructionLinearUnit
    stroke?: string
    profile?: ConstructionLengthProfile
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
        dimension(
          pointAt(start),
          pointAt(end),
          outwardNormal,
          OPENING_CHAIN_OFFSET,
          unit,
          stroke,
          undefined,
          undefined,
          profile,
        ),
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
      undefined,
      undefined,
      profile,
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
  dimensionStart?: FloorplanPoint,
  dimensionEnd?: FloorplanPoint,
  profile: ConstructionLengthProfile = 'editor',
): FloorplanGeometry {
  const measurementStart = dimensionStart ?? start
  const measurementEnd = dimensionEnd ?? end
  return {
    kind: 'dimension',
    start,
    end,
    dimensionStart,
    dimensionEnd,
    offsetNormal,
    offsetDistance,
    extensionOvershoot: EXTENSION_OVERSHOOT,
    text: formatConstructionLength(
      Math.hypot(measurementEnd[0] - measurementStart[0], measurementEnd[1] - measurementStart[1]),
      unit,
      profile,
    ),
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

function isClassifiedInteriorWall(wall: WallNode): boolean {
  return wall.frontSide === 'interior' && wall.backSide === 'interior'
}

function hostedOpeningsForWall(wall: WallNode, nodes: Record<string, AnyNode>): OpeningNode[] {
  return Object.values(nodes).filter(
    (node): node is OpeningNode =>
      (node.type === 'door' || node.type === 'window') &&
      node.visible !== false &&
      (node.wallId ?? node.parentId) === wall.id,
  )
}

function shouldDimensionInteriorWall(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
  openings: readonly OpeningNode[],
  network: ReadonlyArray<WallNode>,
): boolean {
  if (isClassifiedInteriorWall(wall)) return true
  if (openings.length === 0) return false
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < MIN_SEGMENT_LENGTH) return false
  const tangent: FloorplanPoint = [dx / length, dz / length]
  const { frontClearance, backClearance } = interiorDimensionClearances(wall, walls, tangent)
  if (frontClearance === null || backClearance === null) return false

  const claimedExteriorNormal = exteriorNormal(wall)
  return claimedExteriorNormal === null || isFacadeOccluded(wall, claimedExteriorNormal, network)
}

function resolveInteriorDimensionNormal(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
  tangent: FloorplanPoint,
): FloorplanPoint {
  const front: FloorplanPoint = [cleanZero(-tangent[1]), cleanZero(tangent[0])]
  const back = negate(front)
  const { frontClearance, backClearance } = interiorDimensionClearances(wall, walls, tangent)

  if (frontClearance !== null && backClearance === null) return front
  if (backClearance !== null && frontClearance === null) return back
  if (frontClearance !== null && backClearance !== null) {
    if (Math.abs(frontClearance - backClearance) > FACADE_LINE_TOLERANCE) {
      return frontClearance > backClearance ? front : back
    }
  }

  const midpoint: FloorplanPoint = [
    (wall.start[0] + wall.end[0]) / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ]
  const centroid = wallNetworkCentroid(walls)
  return dot(subtract(centroid, midpoint), front) >= 0 ? front : back
}

function interiorDimensionClearances(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
  tangent: FloorplanPoint,
): { frontClearance: number | null; backClearance: number | null } {
  const front: FloorplanPoint = [cleanZero(-tangent[1]), cleanZero(tangent[0])]
  const back = negate(front)
  const midpoint: FloorplanPoint = [
    (wall.start[0] + wall.end[0]) / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ]
  const clearance = (normal: FloorplanPoint): number | null => {
    let nearest = Number.POSITIVE_INFINITY
    for (const candidate of walls) {
      if (candidate.id === wall.id || isCurvedWall(candidate)) continue
      const hit = raySegmentDistance(midpoint, normal, candidate.start, candidate.end)
      if (hit !== null) nearest = Math.min(nearest, hit)
    }
    return Number.isFinite(nearest) ? nearest : null
  }
  const frontClearance = clearance(front)
  const backClearance = clearance(back)
  return { frontClearance, backClearance }
}

function wallNetworkCentroid(walls: ReadonlyArray<WallNode>): FloorplanPoint {
  if (walls.length === 0) return [0, 0]
  let sumX = 0
  let sumY = 0
  for (const wall of walls) {
    sumX += wall.start[0] + wall.end[0]
    sumY += wall.start[1] + wall.end[1]
  }
  return [sumX / (walls.length * 2), sumY / (walls.length * 2)]
}

function buildWallNetworkIndex(
  walls: ReadonlyArray<WallNode>,
): Map<string, ReadonlyArray<WallNode>> {
  const straightWalls = walls.filter((wall) => !isCurvedWall(wall))
  const unvisited = new Set(straightWalls)
  const networkById = new Map<string, ReadonlyArray<WallNode>>()

  while (unvisited.size > 0) {
    const seed = unvisited.values().next().value
    if (!seed) break
    unvisited.delete(seed)
    const network = [seed]
    const queue = [seed]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      for (const candidate of unvisited) {
        if (!wallSegmentsTouch(current, candidate)) continue
        unvisited.delete(candidate)
        network.push(candidate)
        queue.push(candidate)
      }
    }
    for (const wall of network) networkById.set(wall.id, network)
  }

  return networkById
}

function wallSegmentsTouch(left: WallNode, right: WallNode): boolean {
  return (
    pointSegmentDistance(left.start, right.start, right.end) <= FACADE_LINE_TOLERANCE ||
    pointSegmentDistance(left.end, right.start, right.end) <= FACADE_LINE_TOLERANCE ||
    pointSegmentDistance(right.start, left.start, left.end) <= FACADE_LINE_TOLERANCE ||
    pointSegmentDistance(right.end, left.start, left.end) <= FACADE_LINE_TOLERANCE ||
    segmentIntersection(left.start, left.end, right.start, right.end) !== null
  )
}

function isFacadeOccluded(
  wall: WallNode,
  outwardNormal: FloorplanPoint,
  network: ReadonlyArray<WallNode>,
): boolean {
  const halfThickness = (wall.thickness ?? 0.1) / 2
  const origin = addScaled(
    [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2],
    outwardNormal,
    halfThickness + FACADE_LINE_TOLERANCE,
  )
  return network.some(
    (candidate) =>
      candidate.id !== wall.id &&
      raySegmentDistance(origin, outwardNormal, candidate.start, candidate.end) !== null,
  )
}

function raySegmentDistance(
  rayOrigin: FloorplanPoint,
  rayDirection: FloorplanPoint,
  segmentStart: FloorplanPoint,
  segmentEnd: FloorplanPoint,
): number | null {
  const segmentDirection = subtract(segmentEnd, segmentStart)
  const denominator = cross(rayDirection, segmentDirection)
  if (Math.abs(denominator) < 1e-8) return null
  const fromRay = subtract(segmentStart, rayOrigin)
  const alongRay = cross(fromRay, segmentDirection) / denominator
  const alongSegment = cross(fromRay, rayDirection) / denominator
  if (alongRay <= FACADE_LINE_TOLERANCE || alongSegment < -1e-6 || alongSegment > 1 + 1e-6) {
    return null
  }
  return alongRay
}

function splitConnectedFacadeComponents(members: FacadeMember[]): FacadeMember[][] {
  const unvisited = new Set(members)
  const components: FacadeMember[][] = []

  while (unvisited.size > 0) {
    const seed = unvisited.values().next().value
    if (!seed) break
    unvisited.delete(seed)
    const component = [seed]
    const queue = [seed]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      for (const candidate of unvisited) {
        if (!wallsTouch(current.wall, candidate.wall)) continue
        unvisited.delete(candidate)
        component.push(candidate)
        queue.push(candidate)
      }
    }
    components.push(component)
  }

  return components
}

function wallsTouch(left: WallNode, right: WallNode): boolean {
  return [left.start, left.end].some((leftPoint) =>
    [right.start, right.end].some(
      (rightPoint) => distance(leftPoint, rightPoint) <= FACADE_LINE_TOLERANCE,
    ),
  )
}

function groupFacadeMembersByDirection(
  members: readonly FacadeMember[],
): Map<string, FacadeMember[]> {
  const groups = new Map<string, FacadeMember[]>()
  for (const member of members) {
    const key = `${Math.round(member.normal[0] / FACADE_DIRECTION_TOLERANCE)},${Math.round(member.normal[1] / FACADE_DIRECTION_TOLERANCE)}`
    const group = groups.get(key)
    if (group) group.push(member)
    else groups.set(key, [member])
  }
  return groups
}

function groupFacadeMembersByLine(
  members: readonly FacadeMember[],
  normal: FloorplanPoint,
): Map<number, FacadeMember[]> {
  const groups = new Map<number, FacadeMember[]>()
  for (const member of members) {
    const midpoint: FloorplanPoint = [
      (member.wall.start[0] + member.wall.end[0]) / 2,
      (member.wall.start[1] + member.wall.end[1]) / 2,
    ]
    const key = Math.round(dot(midpoint, normal) / FACADE_LINE_TOLERANCE)
    const group = groups.get(key)
    if (group) group.push(member)
    else groups.set(key, [member])
  }
  return groups
}

function appendFacadeRunDimensions(
  pending: PendingConstructionDimension[],
  members: readonly FacadeMember[],
  walls: ReadonlyArray<WallNode>,
  nodes: Record<string, AnyNode>,
  normal: FloorplanPoint,
  tangent: FloorplanPoint,
): void {
  const wallProjections = members.flatMap(({ wall }) => [
    dot(wall.start, tangent),
    dot(wall.end, tangent),
  ])
  const extentStart = Math.min(...wallProjections)
  const extentEnd = Math.max(...wallProjections)
  if (extentEnd - extentStart < MIN_SEGMENT_LENGTH) return

  const faceCoordinate = Math.max(
    ...members.map(({ wall }) => exteriorFaceCoordinate(wall, normal)),
  )
  const pointAt = (projection: number): FloorplanPoint =>
    pointFromCoordinates(projection, faceCoordinate, tangent, normal)
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
      if ((opening.wallId ?? opening.parentId) !== wall.id) continue
      const along = clamp(opening.position[0], 0, length)
      const center: FloorplanPoint = [
        wall.start[0] + (dx / length) * along,
        wall.start[1] + (dz / length) * along,
      ]
      openingCenters.push(dot(center, tangent))
      const halfWidth = Math.max(0, opening.width) / 2
      const startProjection = dot(
        [
          wall.start[0] + (dx / length) * clamp(along - halfWidth, 0, length),
          wall.start[1] + (dz / length) * clamp(along - halfWidth, 0, length),
        ],
        tangent,
      )
      const endProjection = dot(
        [
          wall.start[0] + (dx / length) * clamp(along + halfWidth, 0, length),
          wall.start[1] + (dz / length) * clamp(along + halfWidth, 0, length),
        ],
        tangent,
      )
      if (Math.abs(endProjection - startProjection) >= MIN_SEGMENT_LENGTH) {
        openingSpans.push([
          Math.min(startProjection, endProjection),
          Math.max(startProjection, endProjection),
        ])
      }
    }
  }

  for (const [startProjection, endProjection] of openingSpans.sort(
    (left, right) => left[0] - right[0],
  )) {
    pending.push({
      tier: 'opening-widths',
      start: pointAt(startProjection),
      end: pointAt(endProjection),
      startProjection,
      endProjection,
    })
  }
  appendReferenceTier(pending, openingCenters, extentStart, extentEnd, pointAt, 'openings')

  const memberIds = new Set(members.map(({ wall }) => wall.id))
  const partitionReferences: number[] = []
  for (const candidate of walls) {
    if (
      memberIds.has(candidate.id) ||
      isCurvedWall(candidate) ||
      exteriorNormal(candidate) !== null
    ) {
      continue
    }
    for (const { wall } of members) {
      const references = facadePartitionFaceIntersections(wall, candidate, normal).map((point) =>
        dot(point, tangent),
      )
      const faceOfStud = Math.min(...references)
      if (
        Number.isFinite(faceOfStud) &&
        faceOfStud > extentStart + MIN_SEGMENT_LENGTH &&
        faceOfStud < extentEnd - MIN_SEGMENT_LENGTH
      ) {
        partitionReferences.push(faceOfStud)
      }
    }
  }
  appendReferenceTier(pending, partitionReferences, extentStart, extentEnd, pointAt, 'partitions')
}

function appendReferenceTier(
  pending: PendingConstructionDimension[],
  references: number[],
  extentStart: number,
  extentEnd: number,
  pointAt: (projection: number) => FloorplanPoint,
  tier: 'openings' | 'partitions',
): void {
  const interiorReferences = uniqueSorted(references).filter(
    (value) => value > extentStart + MIN_SEGMENT_LENGTH && value < extentEnd - MIN_SEGMENT_LENGTH,
  )
  if (interiorReferences.length === 0) return
  appendProjectedChain(pending, [extentStart, ...interiorReferences, extentEnd], tier, pointAt)
}

function appendProjectedChain(
  pending: PendingConstructionDimension[],
  projections: number[],
  tier: ConstructionDimensionTier,
  originAt: (projection: number) => FloorplanPoint,
): void {
  const breakpoints = uniqueSorted(projections)
  for (let index = 0; index < breakpoints.length - 1; index++) {
    const startProjection = breakpoints[index]
    const endProjection = breakpoints[index + 1]
    if (
      startProjection === undefined ||
      endProjection === undefined ||
      endProjection - startProjection < MIN_SEGMENT_LENGTH
    ) {
      continue
    }
    pending.push({
      tier,
      start: originAt(startProjection),
      end: originAt(endProjection),
      startProjection,
      endProjection,
    })
  }
}

function finalizeDimensionTiers(
  pending: PendingConstructionDimension[],
  tangent: FloorplanPoint,
  normal: FloorplanPoint,
  outerCoordinate: number,
): PlannedConstructionDimension[] {
  const activeTiers = TIER_ORDER.filter((tier) => pending.some((entry) => entry.tier === tier))
  const offsets = new Map<ConstructionDimensionTier, number>()
  activeTiers.forEach((tier, index) => {
    const firstOffset =
      activeTiers[0] === 'opening-widths' ? FIRST_OPENING_WIDTH_OFFSET : FIRST_GENERAL_TIER_OFFSET
    offsets.set(tier, firstOffset + index * TIER_SPACING)
  })

  return [...pending]
    .sort((left, right) => {
      const tierDelta = TIER_ORDER.indexOf(left.tier) - TIER_ORDER.indexOf(right.tier)
      return tierDelta || left.startProjection - right.startProjection
    })
    .map((entry) => {
      const offset = offsets.get(entry.tier) ?? FIRST_GENERAL_TIER_OFFSET
      const baselineCoordinate = outerCoordinate + offset
      const dimensionStart = pointFromCoordinates(
        entry.startProjection,
        baselineCoordinate,
        tangent,
        normal,
      )
      const dimensionEnd = pointFromCoordinates(
        entry.endProjection,
        baselineCoordinate,
        tangent,
        normal,
      )
      return {
        tier: entry.tier,
        start: entry.start,
        end: entry.end,
        dimensionStart,
        dimensionEnd,
        offsetNormal: normal,
        offsetDistance: Math.max(0, dot(subtract(dimensionStart, entry.start), normal)),
      }
    })
}

function exteriorFaceCoordinate(wall: WallNode, normal: FloorplanPoint): number {
  const midpoint: FloorplanPoint = [
    (wall.start[0] + wall.end[0]) / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ]
  return dot(midpoint, normal) + (wall.thickness ?? 0.1) / 2
}

function exteriorOriginAtProjection(
  members: readonly FacadeMember[],
  projection: number,
  tangent: FloorplanPoint,
  normal: FloorplanPoint,
): FloorplanPoint {
  const endpoint = members
    .flatMap(({ wall }) => [
      { point: wall.start, wall },
      { point: wall.end, wall },
    ])
    .sort((left, right) => {
      const projectionDelta =
        Math.abs(dot(left.point, tangent) - projection) -
        Math.abs(dot(right.point, tangent) - projection)
      return (
        projectionDelta ||
        exteriorFaceCoordinate(right.wall, normal) - exteriorFaceCoordinate(left.wall, normal)
      )
    })[0]
  if (!endpoint) return pointFromCoordinates(projection, 0, tangent, normal)
  return addScaled(endpoint.point, normal, (endpoint.wall.thickness ?? 0.1) / 2)
}

function outermostColumnRow(
  columns: readonly ColumnNode[],
  component: readonly FacadeMember[],
  normal: FloorplanPoint,
  tangent: FloorplanPoint,
): ColumnNode[] {
  if (columns.length < 2) return []
  const centroid = facadeCentroid(component)
  const outwardColumns = columns.filter(
    (column) => dot(subtract(columnPlanPoint(column), centroid), normal) >= -COLUMN_ROW_TOLERANCE,
  )
  const sorted = [...outwardColumns].sort(
    (left, right) => dot(columnPlanPoint(right), normal) - dot(columnPlanPoint(left), normal),
  )
  const outerCoordinate = sorted[0] ? dot(columnPlanPoint(sorted[0]), normal) : 0
  return sorted
    .filter(
      (column) =>
        Math.abs(dot(columnPlanPoint(column), normal) - outerCoordinate) <= COLUMN_ROW_TOLERANCE,
    )
    .sort(
      (left, right) => dot(columnPlanPoint(left), tangent) - dot(columnPlanPoint(right), tangent),
    )
}

function columnOriginAtProjection(
  columns: readonly ColumnNode[],
  projection: number,
  tangent: FloorplanPoint,
): FloorplanPoint {
  return columnPlanPoint(
    [...columns].sort(
      (left, right) =>
        Math.abs(dot(columnPlanPoint(left), tangent) - projection) -
        Math.abs(dot(columnPlanPoint(right), tangent) - projection),
    )[0]!,
  )
}

function columnPlanPoint(column: ColumnNode): FloorplanPoint {
  return [column.position[0], column.position[2]]
}

function columnNormalHalfExtent(column: ColumnNode, normal: FloorplanPoint): number {
  const center = columnPlanPoint(column)
  return Math.max(
    ...getColumnFloorplanFootprint(column).map((point) => dot(subtract(point, center), normal)),
  )
}

function nearestFacadeComponent(
  column: ColumnNode,
  components: readonly FacadeMember[][],
): FacadeMember[] | undefined {
  const point = columnPlanPoint(column)
  return [...components]
    .filter((component) => component[0]?.wall.parentId === column.parentId)
    .sort(
      (left, right) =>
        distanceToFacadeComponent(point, left) - distanceToFacadeComponent(point, right),
    )[0]
}

function distanceToFacadeComponent(
  point: FloorplanPoint,
  component: readonly FacadeMember[],
): number {
  return Math.min(...component.map(({ wall }) => pointSegmentDistance(point, wall.start, wall.end)))
}

function facadeCentroid(component: readonly FacadeMember[]): FloorplanPoint {
  const points = component.flatMap(({ wall }) => [wall.start, wall.end])
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ]
}

function pointFromCoordinates(
  tangentCoordinate: number,
  normalCoordinate: number,
  tangent: FloorplanPoint,
  normal: FloorplanPoint,
): FloorplanPoint {
  return [
    tangent[0] * tangentCoordinate + normal[0] * normalCoordinate,
    tangent[1] * tangentCoordinate + normal[1] * normalCoordinate,
  ]
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

function facadePartitionFaceIntersections(
  facade: WallNode,
  candidate: WallNode,
  outwardNormal: FloorplanPoint,
): FloorplanPoint[] {
  const halfThickness = (facade.thickness ?? 0.1) / 2
  const insideStart: FloorplanPoint = [
    facade.start[0] - outwardNormal[0] * halfThickness,
    facade.start[1] - outwardNormal[1] * halfThickness,
  ]
  const insideEnd: FloorplanPoint = [
    facade.end[0] - outwardNormal[0] * halfThickness,
    facade.end[1] - outwardNormal[1] * halfThickness,
  ]
  const dx = candidate.end[0] - candidate.start[0]
  const dz = candidate.end[1] - candidate.start[1]
  const length = Math.hypot(dx, dz)
  if (length < MIN_SEGMENT_LENGTH) return []
  const candidateNormal: FloorplanPoint = [-dz / length, dx / length]
  const candidateHalfThickness = (candidate.thickness ?? 0.1) / 2

  return [-1, 1].flatMap((side): FloorplanPoint[] => {
    const faceStart = addScaled(candidate.start, candidateNormal, side * candidateHalfThickness)
    const faceEnd = addScaled(candidate.end, candidateNormal, side * candidateHalfThickness)
    const intersection = segmentIntersection(insideStart, insideEnd, faceStart, faceEnd)
    return intersection ? [intersection] : []
  })
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

function pointSegmentDistance(
  point: FloorplanPoint,
  start: FloorplanPoint,
  end: FloorplanPoint,
): number {
  const segment = subtract(end, start)
  const lengthSquared = dot(segment, segment)
  if (lengthSquared < 1e-12) return distance(point, start)
  const along = clamp(dot(subtract(point, start), segment) / lengthSquared, 0, 1)
  return distance(point, addScaled(start, segment, along))
}

function distance(left: FloorplanPoint, right: FloorplanPoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1])
}

function subtract(left: FloorplanPoint, right: FloorplanPoint): FloorplanPoint {
  return [left[0] - right[0], left[1] - right[1]]
}

function addScaled(
  point: FloorplanPoint,
  direction: FloorplanPoint,
  distance: number,
): FloorplanPoint {
  return [point[0] + direction[0] * distance, point[1] + direction[1] * distance]
}

function dot(left: FloorplanPoint, right: FloorplanPoint): number {
  return left[0] * right[0] + left[1] * right[1]
}

function cross(left: FloorplanPoint, right: FloorplanPoint): number {
  return left[0] * right[1] - left[1] * right[0]
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
