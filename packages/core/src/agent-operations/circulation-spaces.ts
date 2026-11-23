import {
  createFloorOpeningIndex,
  type FloorOpeningIndex,
  openingsForSurface,
} from '../lib/floor-opening-intent'
import { groundLevelOf } from '../lib/ground-level'
import {
  area as clippedArea,
  difference,
  intersection,
  type MultiPolygon,
  union,
} from '../lib/polygon-boolean'
import { polygonInteriorPoint } from '../lib/polygon-label'
import { extractRooms } from '../lib/space-detection'
import type { AnyNode, AnyNodeId, ElevatorNode, LevelNode, WallNode } from '../schema'
import { getLevelElevations } from '../services/storey'
import {
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  sampleWallCenterline,
} from '../systems/wall/wall-curve'
import { getWallFaceOffsets } from '../systems/wall/wall-frame'
import type { CirculationGraph, CirculationNode } from './circulation-graph'
import { pointInPolygon } from './plan-geometry'
import { queryNodes } from './scene-queries'
import type { SceneNodes } from './types'

export type Pt = [number, number]
export type Space =
  | { kind: 'outside' }
  | { kind: 'open-air' }
  | { kind: 'void' }
  | { kind: 'shaft' }
  | { kind: 'outdoor'; key: string; area: number }
  | { kind: 'zone'; key: string; area: number; apartment?: string }
  | { kind: 'floor'; key: string }

export type Floor = {
  elevation: number
  groundElevation: number
  id: LevelNode['id']
  name: string
  ground: boolean
  /** A floor under the ground line of its building: a basement, whose doors open onto earth. */
  belowGround: boolean
  slabs: {
    id: string
    polygon: Pt[]
    holes: Pt[][]
    elevation: number
    outdoor: boolean
  }[]
  interior: MultiPolygon
  voids: Pt[][]
  shafts: Pt[][]
  zones: {
    id: string
    polygon: Pt[]
    holes: Pt[][]
    area: number
    outdoor: boolean
    elevation: number
    apartment?: string
  }[]
  pockets: { polygon: Pt[]; area: number }[]
  walls: [Pt, Pt][]
}

export const area = (polygon: readonly Pt[]) =>
  Math.abs(
    polygon.reduce((sum, [x, z], index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? sum + x * next[1] - next[0] * z : sum
    }, 0),
  ) / 2
export const rotate = ([x, z]: Pt, rotation: number): Pt => [
  x * Math.cos(rotation) + z * Math.sin(rotation),
  -x * Math.sin(rotation) + z * Math.cos(rotation),
]
const cross = (origin: Pt, start: Pt, end: Pt) =>
  (start[0] - origin[0]) * (end[1] - origin[1]) - (start[1] - origin[1]) * (end[0] - origin[0])
const touches = (point: Pt, start: Pt, end: Pt) =>
  Math.abs(cross(start, end, point)) < 1e-9 &&
  point[0] >= Math.min(start[0], end[0]) - 1e-9 &&
  point[0] <= Math.max(start[0], end[0]) + 1e-9 &&
  point[1] >= Math.min(start[1], end[1]) - 1e-9 &&
  point[1] <= Math.max(start[1], end[1]) + 1e-9
const segmentsCross = (from: Pt, to: Pt, start: Pt, end: Pt) =>
  (cross(from, to, start) * cross(from, to, end) < 0 &&
    cross(start, end, from) * cross(start, end, to) < 0) ||
  touches(start, from, to) ||
  touches(end, from, to) ||
  touches(from, start, end) ||
  touches(to, start, end)
export const walkable = (space: Space) =>
  space.kind === 'zone' ||
  space.kind === 'floor' ||
  space.kind === 'outside' ||
  space.kind === 'outdoor'
export const keyOf = (space: Space) =>
  space.kind === 'zone' || space.kind === 'floor' || space.kind === 'outdoor'
    ? space.key
    : space.kind
export const crossesWall = (floor: Floor, from: Pt, to: Pt) =>
  floor.walls.some(([start, end]) => segmentsCross(from, to, start, end))

export const liftOrigin = (lift: ElevatorNode): Pt => [lift.position[0], lift.position[2]]
function shaftOf(lift: ElevatorNode): Pt[] {
  const [cx, cz] = liftOrigin(lift)
  const [halfWidth, halfDepth] = [
    (lift.shaftWidth ?? lift.width) / 2,
    (lift.shaftDepth ?? lift.depth) / 2,
  ]
  return (
    [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth],
    ] as Pt[]
  ).map((corner) => {
    const [x, z] = rotate(corner, lift.rotation ?? 0)
    return [cx + x, cz + z]
  })
}
function liftService(nodes: SceneNodes) {
  return (lift: ElevatorNode, levelId: string) => {
    const level = nodes[levelId],
      from = nodes[lift.fromLevelId ?? ''],
      to = nodes[lift.toLevelId ?? '']
    if (level?.type !== 'level' || from?.type !== 'level' || to?.type !== 'level') return false
    if (level.parentId !== from.parentId || level.parentId !== to.parentId) return false
    return (
      level.level >= Math.min(from.level, to.level) &&
      level.level <= Math.max(from.level, to.level) &&
      !(lift.disabledLevelIds ?? []).includes(levelId)
    )
  }
}
function zonesOf(on: AnyNode[], apartmentOfZone: Map<string, string>) {
  const zones = on
    .filter((node) => node.type === 'zone' && node.polygon.length >= 3)
    .flatMap((zone) => {
      if (zone.type !== 'zone') return []
      return [
        {
          id: zone.id as string,
          polygon: zone.polygon,
          holes: zone.holes ?? [],
          area: area(zone.polygon) - (zone.holes ?? []).reduce((sum, hole) => sum + area(hole), 0),
          outdoor: false,
          elevation: 0,
          apartment: apartmentOfZone.get(zone.id),
        },
      ]
    })
  // Nested room zones inherit their enclosing apartment's membership: the apartment that holds
  // most of the room. A room beside it holds nothing of it, even where the room's vertex average
  // falls inside (an arc's samples pull it across the arc).
  const shape = (zone: Floor['zones'][number]) => ({ outer: zone.polygon, holes: zone.holes })
  for (const zone of zones) {
    if (zone.apartment) continue
    zone.apartment = zones.find(
      (other) =>
        other.apartment &&
        other.area > zone.area &&
        clippedArea(intersection(shape(zone), shape(other))) > zone.area / 2,
    )?.apartment
  }
  return zones.filter((zone) => {
    const smaller = zones.filter((other) => other.area < zone.area)
    return (
      !smaller.length ||
      difference(
        { outer: zone.polygon, holes: zone.holes },
        smaller.map((other) => ({ outer: other.polygon, holes: other.holes })),
      ).length > 0
    )
  })
}
function wallSegments(walls: WallNode[]): [Pt, Pt][] {
  return walls.flatMap((wall) => {
    const points = sampleWallCenterline(wall, isCurvedWall(wall) ? 24 : 1).map(
      ({ x, y }): Pt => [x, y],
    )
    return points.slice(1).flatMap((point, index): [Pt, Pt][] => {
      const previous = points[index]
      return previous ? [[previous, point]] : []
    })
  })
}
type FloorContext = {
  apartmentOfZone: Map<string, string>
  elevators: ElevatorNode[]
  serves: ReturnType<typeof liftService>
  openings: FloorOpeningIndex
  groundByBuilding: Map<string | null, string>
  belowGround: Set<string>
  elevations: ReturnType<typeof getLevelElevations>
}
function enclosedFootprint(on: AnyNode[], walls: WallNode[]) {
  const pockets = extractRooms(walls).map((room) => ({
    polygon: room.referencePolygon as Pt[],
    area: area(room.referencePolygon as Pt[]),
  }))
  const courts = on.filter(
    (node) => node.type === 'zone' && node.hasFloor === false && node.hasCeiling === false,
  )
  const declared = on.flatMap((node) =>
    node.type === 'zone' &&
    node.hasFloor !== false &&
    (node.enclosureStatus === 'enclosed' || (node.boundarySeparatorIds?.length ?? 0) > 0)
      ? [{ outer: node.polygon, holes: node.holes ?? [] }]
      : [],
  )
  const enclosed = pockets.length
    ? union([...pockets.map((pocket) => pocket.polygon), ...declared])
    : union(
        on.flatMap((node) =>
          node.type === 'zone' && (node.hasFloor !== false || node.hasCeiling !== false)
            ? [{ outer: node.polygon, holes: node.holes ?? [] }]
            : [],
        ),
      )
  const interior = difference(
    enclosed,
    courts.flatMap((node) =>
      node.type === 'zone' ? [{ outer: node.polygon, holes: node.holes ?? [] }] : [],
    ),
  )
  return { pockets, interior, enclosed }
}

function outdoorZone(
  nodes: SceneNodes,
  zone: ReturnType<typeof zonesOf>[number],
  slabs: Floor['slabs'],
  outside: boolean,
  groundElevation: number,
  elevation: number,
) {
  const source = nodes[zone.id]
  const outdoor =
    outside || (source?.type === 'zone' && source.hasFloor === false && source.hasCeiling === false)
  const surfaceElevation = outdoorElevation(
    slabs,
    polygonInteriorPoint(zone, true),
    groundElevation,
  )
  return {
    ...zone,
    outdoor,
    elevation: outdoor ? surfaceElevation : elevation,
  }
}

function walkingFloor(slabs: Extract<AnyNode, { type: 'slab' }>[], interior: MultiPolygon) {
  const authored = slabs.find((slab) => slab.plateRole === 'base')
  if (authored) return authored
  let best = slabs[0]
  let largest = 0
  for (const slab of slabs) {
    if (slab.support === 'open') continue
    const overlap = clippedArea(
      intersection({ outer: slab.polygon, holes: slab.holes ?? [] }, interior),
    )
    if (overlap > largest) {
      best = slab
      largest = overlap
    }
  }
  return best
}

function floorOf(nodes: SceneNodes, level: LevelNode, context: FloorContext): Floor {
  const on = queryNodes(nodes, { parentId: level.id })
  const slabs = on.filter((node) => node.type === 'slab')
  const walls = on.filter((node): node is WallNode => node.type === 'wall')
  const { pockets, interior, enclosed } = enclosedFootprint(on, walls)
  const base = walkingFloor(slabs, interior)
  const ground = level.id === context.groundByBuilding.get(level.parentId)
  const groundElevation = context.elevations.get(level.id)?.baseY ?? 0
  const elevation = groundElevation + (base?.elevation ?? 0)
  // An open-supported floor (a porch deck, a cantilevered deck, a bridge) outside the enclosed
  // footprint is outdoor walking ground at its own elevation, on any level, whether or not the
  // house is enclosed yet. The rest are outdoor only on the ground floor, outside an enclosed
  // footprint.
  const outdoor = (polygon: Pt[], holes: Pt[][], open = false) =>
    (open || (ground && enclosed.length > 0)) &&
    clippedArea(intersection({ outer: polygon, holes }, interior)) < 1e-6
  const surfaces = slabs.map((slab) => ({
    id: slab.id,
    polygon: slab.polygon,
    holes: slab.holes ?? [],
    elevation: groundElevation + slab.elevation,
    outdoor: outdoor(slab.polygon, slab.holes ?? [], slab.support === 'open'),
  }))
  const zones = zonesOf(on, context.apartmentOfZone).map((zone) =>
    ground
      ? outdoorZone(
          nodes,
          zone,
          surfaces,
          outdoor(zone.polygon, zone.holes),
          groundElevation,
          elevation,
        )
      : { ...zone, elevation },
  )
  return {
    id: level.id,
    name: level.name ?? `Level ${level.level}`,
    elevation,
    groundElevation,
    ground,
    belowGround: context.belowGround.has(level.id),
    slabs: surfaces,
    interior,
    voids: openingsForSurface(nodes, level.id, 'floor', context.openings).map(
      (opening) => opening.polygon,
    ),
    shafts: context.elevators.filter((lift) => context.serves(lift, level.id)).map(shaftOf),
    zones,
    pockets,
    walls: wallSegments(walls),
  }
}
export function floorsOf(nodes: SceneNodes) {
  const levels = queryNodes<LevelNode>(nodes, { type: 'level' }).sort(
    (left, right) => left.level - right.level,
  )
  const apartments = queryNodes(nodes, { type: 'unit' }).filter(
    (node) => node.type === 'unit' && (node.kind ?? 'apartment') === 'apartment',
  )
  const apartmentOfZone = new Map(
    apartments.flatMap((unit) =>
      unit.type === 'unit'
        ? unit.members.map((member) => [member as string, unit.id as string] as const)
        : [],
    ),
  )
  const elevators = queryNodes<ElevatorNode>(nodes, { type: 'elevator' })
  const serves = liftService(nodes)
  // The ground floor is the one the building stands at grade on, the line the underground reads:
  // a basement under it has a door onto earth, not an entrance. Without a line (a stack with every
  // floor under the ground, levels in no building) it is the lowest floor with a slab.
  const groundByBuilding = new Map<string | null, string>()
  const belowGround = new Set<string>()
  for (const level of levels) {
    const line = level.parentId
      ? groundLevelOf(nodes as Record<AnyNodeId, AnyNode>, level.parentId)
      : null
    const underLine = line !== null && level.level < line.level.level
    if (underLine) belowGround.add(level.id)
    if (groundByBuilding.has(level.parentId)) continue
    if (queryNodes(nodes, { type: 'slab', parentId: level.id }).length === 0) continue
    if (underLine) continue
    groundByBuilding.set(level.parentId, level.id)
  }
  const context = {
    apartmentOfZone,
    elevators,
    serves,
    groundByBuilding,
    belowGround,
    openings: createFloorOpeningIndex(nodes),
    elevations: getLevelElevations(nodes),
  }
  return {
    floors: levels.map((level) => floorOf(nodes, level, context)),
    apartments,
    elevators,
    serves,
    liftOrigin,
  }
}

export function spaceAt(floor: Floor, point: Pt): Space {
  if (floor.shafts.some((shaft) => pointInPolygon(point, shaft, false))) return { kind: 'shaft' }
  if (floor.voids.some((hole) => pointInPolygon(point, hole, false))) return { kind: 'void' }
  const court = floor.zones.find(
    (zone) =>
      zone.outdoor &&
      pointInPolygon(point, zone.polygon) &&
      !zone.holes.some((hole) => pointInPolygon(point, hole, false)),
  )
  if (court) return { kind: 'outdoor', key: `zone:${court.id}`, area: court.area }
  const covering = floor.slabs.filter((slab) => pointInPolygon(point, slab.polygon))
  if (
    covering.length &&
    covering.every((slab) => slab.holes.some((hole) => pointInPolygon(point, hole, false)))
  )
    return { kind: 'void' }
  if (!covering.length) return floor.ground ? { kind: 'outside' } : { kind: 'open-air' }
  const garden = covering.find(
    (slab) => slab.outdoor && !slab.holes.some((hole) => pointInPolygon(point, hole, false)),
  )
  if (garden)
    return {
      kind: 'outdoor',
      key: `outdoor:${garden.id}`,
      area: area(garden.polygon) - garden.holes.reduce((sum, hole) => sum + area(hole), 0),
    }
  let best: Floor['zones'][number] | undefined
  for (const zone of floor.zones)
    if (
      (!best || zone.area < best.area) &&
      pointInPolygon(point, zone.polygon) &&
      !zone.holes.some((hole) => pointInPolygon(point, hole, false))
    )
      best = zone
  if (best)
    return {
      kind: 'zone',
      key: `zone:${best.id}`,
      area: best.area,
      ...(best.apartment ? { apartment: best.apartment } : {}),
    }
  let pocket = -1
  floor.pockets.forEach((candidate, index) => {
    if (
      (pocket < 0 || candidate.area < (floor.pockets[pocket]?.area ?? Infinity)) &&
      pointInPolygon(point, candidate.polygon)
    )
      pocket = index
  })
  return {
    kind: 'floor',
    key: pocket >= 0 ? `floor:${floor.id}:${pocket}` : `floor:${floor.id}:${covering[0]?.id}`,
  }
}

function outdoorElevation(slabs: Floor['slabs'], point: Pt, groundElevation: number) {
  const covering = slabs.filter(
    (slab) =>
      pointInPolygon(point, slab.polygon) &&
      !slab.holes.some((hole) => pointInPolygon(point, hole, false)),
  )
  return covering.length ? Math.max(...covering.map((slab) => slab.elevation)) : groundElevation
}

export function spaceElevation(floor: Floor, space: Space, point?: Pt) {
  if (space.kind === 'outside') return floor.groundElevation
  if (space.kind !== 'outdoor') return floor.elevation
  if (point) return outdoorElevation(floor.slabs, point, floor.groundElevation)
  return (
    floor.zones.find((zone) => `zone:${zone.id}` === space.key)?.elevation ??
    floor.slabs.find((slab) => `outdoor:${slab.id}` === space.key)?.elevation ??
    floor.groundElevation
  )
}

export function floorSpaceReader(nodes: SceneNodes) {
  const floors = new Map<string, Floor>(floorsOf(nodes).floors.map((floor) => [floor.id, floor]))
  return (levelId: string, point: Pt): Space | null => {
    const floor = floors.get(levelId)
    return floor ? spaceAt(floor, point) : null
  }
}
export function wallSidesReader(nodes: SceneNodes) {
  const floors = new Map<string, Floor>(floorsOf(nodes).floors.map((floor) => [floor.id, floor]))
  return (wall: WallNode, along: number): [Space, Space] | null => {
    const floor = floors.get(wall.parentId ?? '')
    return floor ? doorSides(floor, wall, along) : null
  }
}
export function doorFrame(wall: WallNode, along: number) {
  return getWallCurveFrameAt(wall, along / (getWallCurveLength(wall) || 1))
}
export function doorSidePoints(wall: WallNode, along: number): [Pt, Pt] {
  const frame = doorFrame(wall, along)
  const offsets = getWallFaceOffsets(wall)
  const at = (offset: number): Pt => [
    frame.point.x + frame.normal.x * offset,
    frame.point.y + frame.normal.y * offset,
  ]
  return [at(offsets.a + 0.03), at(offsets.b - 0.03)]
}
function doorFaceSpace(
  floor: Floor,
  centre: Pt,
  normal: Pt,
  offset: number,
  direction: 1 | -1,
): Space {
  const probe = (distance: number): Pt => [
    centre[0] + normal[0] * (offset + direction * distance),
    centre[1] + normal[1] * (offset + direction * distance),
  ]
  const near = probe(0.03),
    far = probe(0.4)
  const nearest = spaceAt(floor, near),
    beyond = spaceAt(floor, far)
  if (crossesWall(floor, near, far)) return nearest
  // Keep the original landing-hazard check without jumping across another room's wall.
  if (beyond.kind === 'shaft' || beyond.kind === 'void') return beyond
  return nearest.kind === 'floor' ? beyond : nearest
}
export function doorSides(floor: Floor, wall: WallNode, along: number): [Space, Space] {
  const frame = doorFrame(wall, along)
  const offsets = getWallFaceOffsets(wall)
  const centre: Pt = [frame.point.x, frame.point.y],
    normal: Pt = [frame.normal.x, frame.normal.y]
  return [
    doorFaceSpace(floor, centre, normal, offsets.a, 1),
    doorFaceSpace(floor, centre, normal, offsets.b, -1),
  ]
}

export function spaceRegion(scene: SceneNodes, graph: CirculationGraph, node: CirculationNode) {
  const source = node.sourceId ? scene[node.sourceId] : undefined
  if (source?.type === 'zone' || source?.type === 'slab')
    return { outer: source.polygon, holes: source.holes ?? [] }
  if (node.kind !== 'floor') return undefined
  const floor = graph.floors.find((floor) => floor.id === node.levelId)
  const pocket = floor?.pockets.find((_, index) => node.id === `floor:${floor.id}:${index}`)
  if (pocket) return { outer: pocket.polygon, holes: [] }
  const slab = floor?.slabs.find((slab) => node.id === `floor:${floor.id}:${slab.id}`)
  return slab ? { outer: slab.polygon, holes: slab.holes } : undefined
}
