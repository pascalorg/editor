import { resolveLevelId } from '../lib/node-ancestry'
import { containsPoint, difference, intersection, union } from '../lib/polygon-boolean'
import { polygonInteriorPoint } from '../lib/polygon-label'
import type { AnyNode, StairSegmentNode } from '../schema'
import { getLevelAbove } from '../services/storey'
import { stairBaseElevation } from '../systems/stair/stair-base-elevation'
import { resolveStairArcDimensions } from '../systems/stair/stair-layout'
import { resolveStairTotalRise } from '../systems/stair/stair-rise-query'
import { resolveStairWalkingPaths } from '../systems/stair/stair-walking-line'
import { circulationNonSpaces } from './circulation-non-spaces'
import {
  area,
  crossesWall,
  doorFrame,
  doorSidePoints,
  doorSides,
  type Floor,
  floorsOf,
  keyOf,
  type Pt,
  rotate,
  type Space,
  spaceAt,
  spaceElevation,
  walkable,
} from './circulation-spaces'
import { groundReader } from './ground-reader'
import type { SceneNodes } from './types'

export type CirculationNode = {
  id: string
  kind: 'room' | 'zone' | 'floor' | 'outdoor' | 'outside' | 'stair-landing' | 'lift-landing'
  levelId: string | null
  sourceId: string | null
  name: string
  areaM2: number | null
  position: [number, number, number]
  apartment?: string
}
export type CirculationEdge = {
  id: string
  from: string
  to: string
  kind: 'door' | 'opening' | 'open-edge' | 'stair' | 'lift'
  sourceId: string | null
  widthM: number | null
  position: [number, number, number]
  lengthM: number
  stepHeightM?: number
  use?: 'vehicle' | 'pedestrian'
  riseM?: number
  runM?: number
  maximumSlopePercent?: number
  maxSlopePercent?: number
  startTransitionM?: number
  endTransitionM?: number
  path?: [number, number, number][]
}
export type CirculationIssue = {
  type: string
  message: string
  nodeIds: string[]
  levelIds?: string[]
  reasonCode?: string
  spaceId?: string
}
/** A space that is not a destination: open air through a floor opening, or an outdoor slab. */
export type CirculationNonSpace = 'void' | 'outdoor-slab'
/** A door on a raised level that opens to open air with no modelled ground in reach of its sill. */
export type UnmeasuredEntrance = { doorId: string; spaceId: string; levelId: string }
export type CirculationGraph = {
  nodes: Map<string, CirculationNode>
  edges: CirculationEdge[]
  floors: Floor[]
  issues: CirculationIssue[]
  unsupportedIds: string[]
  unmeasuredEntrances: UnmeasuredEntrance[]
  /** Stairs with no destination level that are the way in from the outside ground. */
  entranceFlights: Set<string>
  nonSpaces: Map<string, CirculationNonSpace>
}
const EDGE_STEP = 0.75
const EDGE_PROBE = 0.3
const LANDING_PROBE = 0.6
const LIFT_PROBE = 0.5
const STAIR_HEIGHT_TOLERANCE_M = 0.05

export const nodeName = (nodes: SceneNodes, id: string) =>
  nodes[id]?.name ?? `Unnamed ${nodes[id]?.type ?? 'element'}`

function spaceNode(nodes: SceneNodes, floor: Floor, space: Space, point: Pt): CirculationNode {
  const id = keyOf(space)
  const zone =
    space.kind === 'zone' || space.kind === 'outdoor'
      ? floor.zones.find((candidate) => `zone:${candidate.id}` === id)
      : undefined
  const slab =
    space.kind === 'outdoor'
      ? floor.slabs.find((candidate) => `outdoor:${candidate.id}` === id)
      : undefined
  const sourceId = zone?.id ?? slab?.id ?? null
  const source = sourceId ? nodes[sourceId] : undefined
  const floorSlab =
    space.kind === 'floor'
      ? floor.slabs.find((candidate) => `floor:${floor.id}:${candidate.id}` === id)
      : undefined
  const at = zone
    ? polygonInteriorPoint(zone, true)
    : slab
      ? polygonInteriorPoint(slab, true)
      : point
  return {
    id,
    kind:
      space.kind === 'outdoor'
        ? 'outdoor'
        : space.kind === 'outside'
          ? 'outside'
          : zone
            ? source?.type === 'zone' && source.spaceRole === 'room'
              ? 'room'
              : 'zone'
            : 'floor',
    levelId: space.kind === 'outside' ? null : floor.id,
    sourceId,
    name: sourceId
      ? nodeName(nodes, sourceId)
      : space.kind === 'outside'
        ? 'Outside'
        : floorSlab
          ? nodeName(nodes, floorSlab.id)
          : `${floor.name} open floor`,
    areaM2: zone?.area ?? (space.kind === 'outdoor' ? space.area : null),
    position: [
      at[0],
      space.kind === 'outside' ? floor.elevation : spaceElevation(floor, space, at),
      at[1],
    ],
    ...(space.kind === 'zone' && space.apartment ? { apartment: space.apartment } : {}),
  }
}

function graphWriter(scene: SceneNodes, graph: CirculationGraph) {
  const note = (floor: Floor, space: Space, point: Pt) => {
    const id = keyOf(space)
    if (!graph.nodes.has(id)) graph.nodes.set(id, spaceNode(scene, floor, space, point))
    return id
  }
  const link = (
    from: string,
    to: string,
    kind: CirculationEdge['kind'],
    sourceId: string | null,
    widthM: number | null,
    position: CirculationEdge['position'],
    lengthM?: number,
    stepHeightM?: number,
    path?: CirculationEdge['path'],
  ) => {
    if (from === to) return
    if (
      kind === 'open-edge' &&
      graph.edges.some(
        (edge) =>
          edge.kind === kind &&
          ((edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)),
      )
    )
      return
    const start = graph.nodes.get(from)
    const end = graph.nodes.get(to)
    if (!start || !end) return
    const distance = (node: CirculationNode) =>
      node.kind === 'outside'
        ? 0
        : Math.hypot(
            node.position[0] - position[0],
            node.position[1] - position[1],
            node.position[2] - position[2],
          )
    graph.edges.push({
      id: `edge:${sourceId ?? kind}:${graph.edges.length}`,
      from,
      to,
      kind,
      sourceId,
      widthM,
      position,
      lengthM: lengthM ?? distance(start) + distance(end),
      ...(stepHeightM !== undefined ? { stepHeightM } : {}),
      ...(path ? { path } : {}),
    })
  }
  return { note, link }
}
export type CirculationWriter = ReturnType<typeof graphWriter>
type Writer = CirculationWriter

/**
 * What an enclosed space leaves that no zone covers is a room to reach only where a person can stand
 * in it: thinner than this on average (twice its area over its perimeter), it is the strip between a
 * zone's edge and a wall face, or a boolean's rounding, and the zones around it are the room (m).
 */
const MIN_UNZONED_THICKNESS_M = 0.3

function standable(outer: readonly Pt[], holes: readonly (readonly Pt[])[]): boolean {
  const perimeter = [outer, ...holes].reduce(
    (sum, ring) =>
      sum +
      ring.reduce((around, [x, z], i) => {
        const [nx, nz] = ring[(i + 1) % ring.length]!
        return around + Math.hypot(nx - x, nz - z)
      }, 0),
    0,
  )
  const matter = area(outer) - holes.reduce((sum, ring) => sum + area(ring), 0)
  return perimeter > 0 && (2 * matter) / perimeter >= MIN_UNZONED_THICKNESS_M
}

function seedSpaces(graph: CirculationGraph, writer: Writer) {
  for (const floor of graph.floors) {
    for (const zone of floor.zones) {
      const point = polygonInteriorPoint(zone, true)
      writer.note(
        floor,
        {
          kind: zone.outdoor ? 'outdoor' : 'zone',
          key: `zone:${zone.id}`,
          area: zone.area,
          ...(zone.apartment ? { apartment: zone.apartment } : {}),
        },
        point,
      )
    }
    const cuts = [...floor.voids, ...floor.shafts].map((outer) => ({ outer, holes: [] }))
    const walkingFloor = difference(
      union(floor.slabs.map((slab) => ({ outer: slab.polygon, holes: slab.holes }))),
      cuts,
    )
    // Unzoned enclosed rooms must exist even when nothing opens onto them.
    floor.pockets.forEach((pocket, index) => {
      const remaining = difference(
        intersection(pocket.polygon, walkingFloor),
        floor.zones.map((zone) => ({ outer: zone.polygon, holes: zone.holes })),
      )
      const part = remaining
        .filter((candidate) => standable(candidate.outer, candidate.holes))
        .sort((a, b) => area(b.outer) - area(a.outer))[0]
      if (!part) return
      const point = polygonInteriorPoint({ polygon: part.outer, holes: part.holes }, true)
      const space = spaceAt(floor, point)
      if (space.kind === 'floor' && space.key === `floor:${floor.id}:${index}`) {
        const id = writer.note(floor, space, point)
        const node = graph.nodes.get(id)
        if (node)
          graph.nodes.set(id, {
            ...node,
            name: `${floor.name} enclosed space ${index + 1}`,
            areaM2: area(pocket.polygon),
          })
      }
    })
    for (const slab of floor.slabs) {
      const parts = difference({ outer: slab.polygon, holes: slab.holes }, cuts)
      if (parts.length > 1) graph.unsupportedIds.push(slab.id)
      const part = parts[0]
      if (!part) continue
      const point = polygonInteriorPoint({ polygon: part.outer, holes: part.holes }, true)
      const space = spaceAt(floor, point)
      if (space.kind === 'floor' || space.kind === 'outdoor') writer.note(floor, space, point)
    }
  }
}

/** How far a walkway's top may stand from the terrain it lands on and still meet it (m). */
const LANDING_REACH = 0.3

type GroundAt = (point: Pt) => number | null

/**
 * A door of a raised level that opens to open air is an entrance when the terrain at its step is
 * within reach of its sill (a street door of a hillside level): the site's outside is then that
 * terrain, and the step is the difference. Where no modelled ground is within reach, the approach
 * cannot be measured and the space behind the door is unmeasured, not unreachable.
 */
function raisedEntrance(
  graph: CirculationGraph,
  writer: Writer,
  floor: Floor,
  door: Extract<AnyNode, { type: 'door' }>,
  sides: readonly [Space, Space],
  probes: readonly [Pt, Pt],
  point: Pt,
  groundAt: GroundAt,
) {
  if (floor.ground) return false
  const air = sides.findIndex((side) => side.kind === 'open-air')
  const inner = air === 0 ? sides[1] : sides[0]
  const innerProbe = air === 0 ? probes[1] : probes[0]
  if (air < 0 || !walkable(inner) || inner.kind === 'outside') return false
  const sill = spaceElevation(floor, inner, innerProbe)
  const terrain = groundAt(probes[air] ?? point)
  // A door of a basement whose sill is under the terrain opens onto earth: no way in, and nothing
  // to measure. A basement door level with the terrain (a walk-out) is an entrance like any other.
  if (floor.belowGround && terrain !== null && terrain - sill > LANDING_REACH) return true
  if (terrain !== null && Math.abs(terrain - sill) <= LANDING_REACH) {
    writer.link(
      writer.note(floor, inner, point),
      writer.note(floor, { kind: 'outside' }, point),
      door.openingKind === 'opening' ? 'opening' : 'door',
      door.id,
      door.width,
      [point[0], floor.elevation, point[1]],
      undefined,
      Math.abs(terrain - sill),
    )
    return true
  }
  graph.unmeasuredEntrances.push({
    doorId: door.id,
    spaceId: writer.note(floor, inner, point),
    levelId: floor.id,
  })
  return true
}

function doorEdges(
  scene: SceneNodes,
  graph: CirculationGraph,
  writer: Writer,
  ground: ReturnType<typeof groundReader>,
) {
  const floorById = new Map<string, Floor>(graph.floors.map((floor) => [floor.id, floor]))
  for (const door of Object.values(scene)) {
    if (door.type !== 'door') continue
    const wall = scene[door.wallId ?? door.parentId ?? '']
    if (wall?.type !== 'wall') {
      graph.unsupportedIds.push(door.id)
      continue
    }
    const floor = floorById.get(wall.parentId ?? '')
    if (!floor) continue
    const sides = doorSides(floor, wall, door.position[0])
    const sidePoints = doorSidePoints(wall, door.position[0])
    const blocked = sides.find((side) => side.kind === 'shaft' || side.kind === 'void')
    if (blocked) {
      graph.issues.push({
        type: 'door_leads_nowhere',
        message: `${nodeName(scene, door.id)} (${floor.name}) opens into ${blocked.kind === 'shaft' ? 'a lift shaft' : 'a stair well'}: no floor to step onto.`,
        nodeIds: [door.id, wall.id],
        levelIds: [floor.id],
      })
      continue
    }
    const frame = doorFrame(wall, door.position[0])
    const point: Pt = [frame.point.x, frame.point.y]
    if (
      raisedEntrance(graph, writer, floor, door, sides, sidePoints, point, (probe) =>
        ground(floor.id, probe),
      )
    )
      continue
    if (!sides.every(walkable)) continue
    writer.link(
      writer.note(floor, sides[0], point),
      writer.note(floor, sides[1], point),
      door.openingKind === 'opening' ? 'opening' : 'door',
      door.id,
      door.width,
      [point[0], floor.elevation, point[1]],
      undefined,
      sides.some((side) => side.kind === 'outside' || side.kind === 'outdoor')
        ? Math.abs(
            spaceElevation(floor, sides[0], sidePoints[0]) -
              spaceElevation(floor, sides[1], sidePoints[1]),
          )
        : undefined,
    )
  }
}

/**
 * Where an open-supported floor above the ground floor reaches the ground: a probe beside its edge
 * is open air, and the terrain there is within reach of the floor's top. That side is then the
 * site's outside, at the height of the terrain, and the step is the difference.
 */
function groundLanding(
  floor: Floor,
  sides: readonly [Space, Space],
  probes: readonly [Pt, Pt],
  elevations: readonly [number, number],
  groundAt: GroundAt,
): { index: 0 | 1; terrain: number } | null {
  if (floor.ground) return null
  for (const index of [0, 1] as const) {
    const [side, other] = index === 0 ? [sides[0], sides[1]] : [sides[1], sides[0]]
    const deckTop = index === 0 ? elevations[1] : elevations[0]
    if (side.kind !== 'open-air' || other.kind !== 'outdoor') continue
    const terrain = groundAt(probes[index])
    if (terrain !== null && Math.abs(terrain - deckTop) <= LANDING_REACH) return { index, terrain }
  }
  return null
}

function isHighDeckBoundary(floor: Floor, sides: readonly Space[], probes: readonly Pt[]) {
  return sides.some((side, index) => {
    const probe = probes[index]
    return (
      probe &&
      side.kind === 'outdoor' &&
      floor.slabs.some(
        (slab) =>
          slab.outdoor &&
          containsPoint([{ outer: slab.polygon, holes: slab.holes }], probe) &&
          slab.elevation - floor.groundElevation > LANDING_REACH,
      )
    )
  })
}

function openEdge(floor: Floor, start: Pt, end: Pt, writer: Writer, groundAt: GroundAt) {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (length < 0.5) return
  const [ux, uz] = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
  const count = Math.max(1, Math.round(length / EDGE_STEP))
  for (let sample = 0; sample < count; sample++) {
    const along = ((sample + 0.5) / count) * length
    if (along < 0.2 || along > length - 0.2) continue
    const point: Pt = [start[0] + ux * along, start[1] + uz * along]
    const left: Pt = [point[0] - uz * EDGE_PROBE, point[1] + ux * EDGE_PROBE]
    const right: Pt = [point[0] + uz * EDGE_PROBE, point[1] - ux * EDGE_PROBE]
    const bare = [spaceAt(floor, left), spaceAt(floor, right)] as const
    const bareElevations = [
      spaceElevation(floor, bare[0], left),
      spaceElevation(floor, bare[1], right),
    ] as const
    const landing = groundLanding(floor, bare, [left, right], bareElevations, groundAt)
    const sides: readonly [Space, Space] = landing
      ? landing.index === 0
        ? [{ kind: 'outside' }, bare[1]]
        : [bare[0], { kind: 'outside' }]
      : bare
    if (
      !sides.every(walkable) ||
      keyOf(sides[0]) === keyOf(sides[1]) ||
      crossesWall(floor, left, right)
    )
      continue
    const outsideFirst = sides[1].kind === 'outside'
    const elevations = landing
      ? ([
          landing.index === 0 ? landing.terrain : bareElevations[0],
          landing.index === 1 ? landing.terrain : bareElevations[1],
        ] as const)
      : bareElevations
    const outdoorOnly = sides.every((side) => side.kind === 'outside' || side.kind === 'outdoor')
    if (
      outdoorOnly &&
      isHighDeckBoundary(floor, sides, [left, right]) &&
      Math.abs(elevations[0] - elevations[1]) > LANDING_REACH
    )
      continue
    const elevation = outdoorOnly ? Math.max(...elevations) : floor.elevation
    writer.link(
      writer.note(floor, outsideFirst ? sides[1] : sides[0], outsideFirst ? right : left),
      writer.note(floor, outsideFirst ? sides[0] : sides[1], outsideFirst ? left : right),
      'open-edge',
      null,
      null,
      [point[0], elevation, point[1]],
      undefined,
      sides.some((side) => side.kind === 'outside' || side.kind === 'outdoor')
        ? Math.abs(elevations[0] - elevations[1])
        : undefined,
    )
  }
}
function openEdges(
  graph: CirculationGraph,
  writer: Writer,
  ground: ReturnType<typeof groundReader>,
) {
  for (const floor of graph.floors) {
    const groundAt: GroundAt = (point) => ground(floor.id, point)
    for (const polygon of [
      ...floor.zones.map((zone) => zone.polygon),
      ...floor.slabs.map((slab) => slab.polygon),
    ])
      polygon.forEach((start, index) => {
        const end = polygon[(index + 1) % polygon.length]
        if (end) openEdge(floor, start, end, writer, groundAt)
      })
  }
}

type StairEnd = {
  floor: Floor
  endpoint: number[]
  adjacent: number[]
  head: boolean
  width: number
}
function stairBaseY(scene: SceneNodes, floor: Floor, stair: Extract<AnyNode, { type: 'stair' }>) {
  return floor.groundElevation + stairBaseElevation(stair, scene, floor.id)
}
function stairEndPoints(
  stair: Extract<AnyNode, { type: 'stair' }>,
  endpoint: number[],
  adjacent: number[],
  probe = LANDING_PROBE,
) {
  const [localX = 0, , localZ = 0] = endpoint
  const offset = rotate([localX, localZ], stair.rotation)
  const point: Pt = [stair.position[0] + offset[0], stair.position[2] + offset[1]]
  const direction = rotate(
    [localX - (adjacent[0] ?? 0), localZ - (adjacent[2] ?? 0)],
    stair.rotation,
  )
  const length = Math.hypot(...direction)
  if (!length) return null
  const target: Pt = [
    point[0] + (direction[0] / length) * probe,
    point[1] + (direction[1] / length) * probe,
  ]
  return { point, target }
}
function stairLanding(
  scene: SceneNodes,
  graph: CirculationGraph,
  writer: Writer,
  stair: Extract<AnyNode, { type: 'stair' }>,
  end: StairEnd,
) {
  const { floor, endpoint, adjacent, head, width } = end
  const points = stairEndPoints(stair, endpoint, adjacent)
  if (!points) return null
  const { point, target } = points
  const space = spaceAt(floor, target)
  const sourceFloor = graph.floors.find(
    (candidate) => candidate.id === (stair.fromLevelId ?? resolveLevelId(stair, scene)),
  )
  const endpointY = (sourceFloor ? stairBaseY(scene, sourceFloor, stair) : 0) + (endpoint[1] ?? 0)
  if (
    !walkable(space) ||
    space.kind === 'outside' ||
    crossesWall(floor, point, target) ||
    Math.abs(endpointY - spaceElevation(floor, space, target)) > STAIR_HEIGHT_TOLERANCE_M
  ) {
    graph.issues.push({
      type: 'stair_has_no_landing',
      message: `No floor to step onto: ${nodeName(scene, stair.id)} at its ${head ? 'head' : 'foot'} (${floor.name}).`,
      nodeIds: [stair.id],
      levelIds: [floor.id],
    })
    return null
  }
  const id = `stair:${stair.id}:${floor.id}`
  graph.nodes.set(id, {
    id,
    kind: 'stair-landing',
    sourceId: stair.id,
    levelId: floor.id,
    name: `${nodeName(scene, stair.id)} ${head ? 'head' : 'foot'}`,
    areaM2: null,
    position: [point[0], endpointY, point[1]],
  })
  writer.link(id, writer.note(floor, space, target), 'open-edge', stair.id, width, [
    target[0],
    floor.elevation,
    target[1],
  ])
  return id
}
function stairWalk(scene: SceneNodes, stair: Extract<AnyNode, { type: 'stair' }>) {
  const segments = stair.children
    .map((id) => scene[id])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
  if (
    stair.stairType === 'straight' &&
    (!segments.length || segments.length !== stair.children.length)
  )
    return null
  const paths = resolveStairWalkingPaths(stair, segments, resolveStairTotalRise(stair, scene))
  const path = paths.length === 1 ? paths[0] : undefined
  const first = path?.[0],
    second = path?.[1],
    last = path?.at(-1),
    previous = path?.at(-2)
  if (!path || !first || !second || !last || !previous) return null
  const straight = stair.stairType === 'straight'
  const width = straight
    ? Math.min(...segments.map((segment) => segment.width))
    : resolveStairArcDimensions(stair, 0).width
  const length = path.slice(1).reduce((sum, point, index) => {
    const before = path[index]
    return before
      ? sum + Math.hypot(point[0] - before[0], point[1] - before[1], point[2] - before[2])
      : sum
  }, 0)
  return {
    path,
    first,
    second,
    last,
    previous,
    width,
    startWidth: straight ? (segments[0]?.width ?? width) : width,
    endWidth: straight ? (segments.at(-1)?.width ?? width) : width,
    length,
  }
}

function stairPath(
  stair: Extract<AnyNode, { type: 'stair' }>,
  walk: NonNullable<ReturnType<typeof stairWalk>>,
  baseY: number,
): [number, number, number][] {
  return walk.path.map(([x, y, z]) => {
    const offset = rotate([x, z], stair.rotation)
    return [stair.position[0] + offset[0], baseY + y, stair.position[2] + offset[1]]
  })
}

/**
 * An end of an entrance flight: a space of the level, or, above the ground floor, open air whose
 * terrain is within reach of the end's height, which is then the site's outside at that terrain.
 */
function flightEnd(floor: Floor, point: Pt, y: number, groundAt: GroundAt) {
  const space = spaceAt(floor, point)
  if (space.kind === 'open-air') {
    const terrain = groundAt(point)
    if (terrain !== null && Math.abs(terrain - y) <= LANDING_REACH)
      return { space: { kind: 'outside' } as Space, y: terrain, grade: true }
  }
  return { space, y: spaceElevation(floor, space, point), grade: false }
}

/** The distance in plan from a point to a polyline. */
function distanceToPath(point: Pt, path: readonly [number, number, number][]) {
  let best = Number.POSITIVE_INFINITY
  for (let index = 1; index < path.length; index++) {
    const [ax = 0, , az = 0] = path[index - 1] ?? []
    const [bx = 0, , bz = 0] = path[index] ?? []
    const [dx, dz] = [bx - ax, bz - az]
    const length = dx * dx + dz * dz
    const t = length
      ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - az) * dz) / length))
      : 0
    best = Math.min(best, Math.hypot(point[0] - (ax + dx * t), point[1] - (az + dz * t)))
  }
  return best
}

/**
 * The door a facade flight climbs to: a door of the level that opens to air, whose space behind it
 * is the flight's top and whose threshold is at the flight's end. Its approach is then measured by
 * the flight, so it is an entrance and no longer an unmeasured one.
 */
function doorAtTopOfFlight(
  scene: SceneNodes,
  graph: CirculationGraph,
  writer: Writer,
  floor: Floor,
  top: Space,
  topY: number,
  footY: number,
  width: number,
  path: readonly [number, number, number][],
) {
  const found = graph.unmeasuredEntrances.find((entrance) => {
    if (entrance.levelId !== floor.id || entrance.spaceId !== keyOf(top)) return false
    const door = scene[entrance.doorId]
    const wall = door?.type === 'door' ? scene[door.wallId ?? door.parentId ?? ''] : undefined
    if (wall?.type !== 'wall' || door?.type !== 'door') return false
    const frame = doorFrame(wall, door.position[0])
    return distanceToPath([frame.point.x, frame.point.y], path) <= width / 2 + LANDING_REACH
  })
  const door = found ? scene[found.doorId] : undefined
  const wall = door?.type === 'door' ? scene[door.wallId ?? door.parentId ?? ''] : undefined
  if (!found || wall?.type !== 'wall' || door?.type !== 'door') return false
  const frame = doorFrame(wall, door.position[0])
  const point: Pt = [frame.point.x, frame.point.y]
  writer.link(
    writer.note(floor, top, point),
    writer.note(floor, { kind: 'outside' }, point),
    door.openingKind === 'opening' ? 'opening' : 'door',
    door.id,
    door.width,
    [point[0], floor.elevation, point[1]],
    undefined,
    Math.abs(topY - footY),
  )
  graph.unmeasuredEntrances = graph.unmeasuredEntrances.filter((entrance) => entrance !== found)
  return true
}

/**
 * An entrance flight: a stair with no destination level whose foot (or head) stands on the outside
 * ground (the flat grade or the terrain within reach of its height) and whose other end meets a
 * walking floor of its own level. It joins Outside to that floor with a measured rise.
 */
function entranceSteps(
  scene: SceneNodes,
  graph: CirculationGraph,
  floor: Floor,
  writer: Writer,
  stair: Extract<AnyNode, { type: 'stair' }>,
  flight: NonNullable<ReturnType<typeof stairWalk>>,
  groundAt: GroundAt,
) {
  if (stair.toLevelId) return false
  // A flight that goes down from a floor is the same flight read from its low end.
  const walk =
    flight.last[1] < flight.first[1]
      ? {
          ...flight,
          path: [...flight.path].reverse(),
          first: flight.last,
          second: flight.previous,
          last: flight.first,
          previous: flight.second,
        }
      : flight
  const baseY = stairBaseY(scene, floor, stair)
  const footY = baseY + walk.first[1]
  const headY = baseY + walk.last[1]
  const path = stairPath(stair, walk, baseY)
  const outdoors = (space: Space) => space.kind === 'outside' || space.kind === 'outdoor'
  const foot = stairEndPoints(stair, walk.first, walk.second, 0.03)
  const head = stairEndPoints(stair, walk.last, walk.previous, 0.03)
  if (!foot || !head) return false
  const a = flightEnd(floor, foot.target, footY, groundAt)
  let b = flightEnd(floor, head.target, headY, groundAt)
  // A flight whose top stands at a door ends at the wall: the floor it rises to lies one step
  // beyond it.
  let facade = walkable(b.space) && crossesWall(floor, head.point, head.target)
  const lands = (end: typeof b) =>
    walkable(end.space) &&
    (end.grade ||
      end.space.kind !== 'outside' ||
      Math.abs(headY - end.y) <= STAIR_HEIGHT_TOLERANCE_M)
  if (!lands(b)) {
    const beyond = stairEndPoints(stair, walk.last, walk.previous, LANDING_REACH)
    const reached = beyond ? flightEnd(floor, beyond.target, headY, groundAt) : null
    if (
      beyond &&
      reached &&
      walkable(reached.space) &&
      reached.space.kind !== 'outside' &&
      crossesWall(floor, head.point, beyond.target)
    ) {
      b = reached
      head.target = beyond.target
      facade = true
    }
  }
  if (
    !walkable(a.space) ||
    !walkable(b.space) ||
    (!outdoors(a.space) && !outdoors(b.space)) ||
    (!a.grade && Math.abs(footY - a.y) > STAIR_HEIGHT_TOLERANCE_M) ||
    (!b.grade && Math.abs(headY - b.y) > STAIR_HEIGHT_TOLERANCE_M) ||
    crossesWall(floor, foot.point, foot.target)
  )
    return false
  if (facade || crossesWall(floor, foot.point, head.point)) {
    // A facade stair is not a second entrance through a closed wall: it is the approach of a door.
    const [outer, inner] = outdoors(a.space) ? [a, b] : [b, a]
    const joined = graph.edges.some(
      (edge) =>
        (edge.kind === 'door' || edge.kind === 'opening') &&
        ((edge.from === keyOf(a.space) && edge.to === keyOf(b.space)) ||
          (edge.from === keyOf(b.space) && edge.to === keyOf(a.space))),
    )
    const approach =
      outer.grade &&
      doorAtTopOfFlight(
        scene,
        graph,
        writer,
        floor,
        inner.space,
        inner.y,
        outer.y,
        walk.width,
        path,
      )
    if (joined || approach) graph.entranceFlights.add(stair.id)
    return joined || approach
  }
  writer.link(
    writer.note(floor, a.space, foot.target),
    writer.note(floor, b.space, head.target),
    'stair',
    stair.id,
    walk.width,
    [foot.point[0], a.y, foot.point[1]],
    walk.length,
    Math.abs(b.y - a.y),
    path,
  )
  graph.entranceFlights.add(stair.id)
  return true
}

function stairEdges(
  scene: SceneNodes,
  graph: CirculationGraph,
  writer: Writer,
  ground: ReturnType<typeof groundReader>,
) {
  const floors = new Map<string, Floor>(graph.floors.map((floor) => [floor.id, floor]))
  for (const stair of Object.values(scene)) {
    if (stair.type !== 'stair') continue
    const foot = floors.get(stair.fromLevelId ?? resolveLevelId(stair, scene) ?? '')
    const head = floors.get(
      stair.toLevelId ?? (foot ? getLevelAbove(foot.id, scene)?.id : undefined) ?? '',
    )
    const walk = stairWalk(scene, stair)
    if (!foot || !walk) {
      graph.unsupportedIds.push(stair.id)
      graph.issues.push({
        type: 'stair_has_no_landing',
        message: `${nodeName(scene, stair.id)} has no complete modeled walking path from a floor.`,
        nodeIds: [stair.id],
        levelIds: foot ? [foot.id] : [],
      })
      continue
    }
    if (entranceSteps(scene, graph, foot, writer, stair, walk, (probe) => ground(foot.id, probe)))
      continue
    const startId = stairLanding(scene, graph, writer, stair, {
      floor: foot,
      endpoint: walk.first,
      adjacent: walk.second,
      head: false,
      width: walk.startWidth,
    })
    const endId = head
      ? stairLanding(scene, graph, writer, stair, {
          floor: head,
          endpoint: walk.last,
          adjacent: walk.previous,
          head: true,
          width: walk.endWidth,
        })
      : null
    if (!head) {
      graph.unsupportedIds.push(stair.id)
      graph.issues.push({
        type: 'stair_has_no_landing',
        message: `${nodeName(scene, stair.id)} has no destination walking floor.`,
        nodeIds: [stair.id],
        levelIds: [foot.id],
      })
    }
    if (!startId || !endId) graph.unsupportedIds.push(stair.id)
    if (startId && endId)
      writer.link(
        startId,
        endId,
        'stair',
        stair.id,
        walk.width,
        graph.nodes.get(startId)?.position ?? [0, 0, 0],
        walk.length,
        undefined,
        stairPath(stair, walk, stairBaseY(scene, foot, stair)),
      )
  }
}

function liftLanding(
  scene: SceneNodes,
  graph: CirculationGraph,
  writer: Writer,
  lift: Extract<AnyNode, { type: 'elevator' }>,
  floor: Floor,
  point: Pt,
) {
  const front = spaceAt(floor, point)
  if (!walkable(front) || front.kind === 'outside') {
    graph.issues.push({
      type: 'lift_door_blocked',
      message: `${nodeName(scene, lift.id)} opens onto nothing on ${floor.name}.`,
      nodeIds: [lift.id],
      levelIds: [floor.id],
    })
    return null
  }
  if (front.kind === 'zone' && front.apartment)
    graph.issues.push({
      type: 'lift_door_blocked',
      message: `${nodeName(scene, lift.id)} opens into ${nodeName(scene, front.apartment)} on ${floor.name}, not shared circulation.`,
      nodeIds: [lift.id, front.apartment],
      levelIds: [floor.id],
    })
  const id = `lift:${lift.id}:${floor.id}`
  graph.nodes.set(id, {
    id,
    kind: 'lift-landing',
    sourceId: lift.id,
    levelId: floor.id,
    name: `${nodeName(scene, lift.id)} ${floor.name}`,
    areaM2: null,
    position: [point[0], floor.elevation, point[1]],
  })
  writer.link(id, writer.note(floor, front, point), 'open-edge', lift.id, lift.doorWidth, [
    point[0],
    floor.elevation,
    point[1],
  ])
  return id
}

function liftEdges(
  scene: SceneNodes,
  graph: CirculationGraph,
  writer: Writer,
  context: ReturnType<typeof floorsOf>,
) {
  for (const lift of context.elevators) {
    const [cx, cz] = context.liftOrigin(lift)
    const reach =
      (lift.shaftDepth ?? lift.depth) / 2 + (lift.shaftWallThickness ?? 0.09) + LIFT_PROBE
    const offset = rotate([0, -reach], lift.rotation)
    const point: Pt = [cx + offset[0], cz + offset[1]]
    let previous: string | null = null
    for (const floor of graph.floors) {
      if (!context.serves(lift, floor.id)) continue
      const id = liftLanding(scene, graph, writer, lift, floor, point)
      if (!id) continue
      if (previous)
        writer.link(
          previous,
          id,
          'lift',
          lift.id,
          lift.doorWidth,
          [cx, floor.elevation, cz],
          Math.abs(floor.elevation - (graph.nodes.get(previous)?.position[1] ?? floor.elevation)),
        )
      previous = id
    }
  }
}

export function buildCirculationGraph(scene: SceneNodes): CirculationGraph {
  const context = floorsOf(scene)
  const graph: CirculationGraph = {
    nodes: new Map(),
    edges: [],
    floors: context.floors,
    issues: [],
    unsupportedIds: [],
    unmeasuredEntrances: [],
    entranceFlights: new Set(),
    nonSpaces: new Map(),
  }
  const writer = graphWriter(scene, graph)
  seedSpaces(graph, writer)
  const ground = groundReader(scene)
  doorEdges(scene, graph, writer, ground)
  openEdges(graph, writer, ground)
  stairEdges(scene, graph, writer, ground)
  liftEdges(scene, graph, writer, context)
  graph.nonSpaces = circulationNonSpaces(scene, graph)
  return graph
}

export function circulationLinks(graph: CirculationGraph) {
  const links = new Map<string, Set<string>>()
  for (const edge of graph.edges)
    for (const [from, to] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]) {
      if (!from || !to) continue
      const neighbors = links.get(from) ?? new Set<string>()
      neighbors.add(to)
      links.set(from, neighbors)
    }
  return links
}

/** Only outdoor spaces with an actual outdoor route belong to the site's outside. */
export function exteriorSpaceIds(graph: CirculationGraph) {
  const outdoors = (id: string) => {
    const kind = graph.nodes.get(id)?.kind
    return kind === 'outside' || kind === 'outdoor'
  }
  return new Set([...reachedFrom(circulationLinks(graph), ['outside'], outdoors)].filter(outdoors))
}

export function exteriorEntranceEdges(graph: CirculationGraph) {
  const exterior = exteriorSpaceIds(graph)
  return graph.edges.filter((edge) => exterior.has(edge.from) !== exterior.has(edge.to))
}

export function reachedFrom(
  links: Map<string, Set<string>>,
  starts: string[],
  through: (id: string) => boolean = () => true,
) {
  const seen = new Set(starts)
  const queue = [...starts]
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]
    if (!id || !through(id)) continue
    for (const neighbor of links.get(id) ?? [])
      if (!seen.has(neighbor)) {
        seen.add(neighbor)
        queue.push(neighbor)
      }
  }
  return seen
}
