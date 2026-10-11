import { extractRooms } from '../lib/space-detection'
import type { AnyNode } from '../schema'
import { stairFootprintAABB } from '../systems/stair/stair-footprint'
import { pointInPolygon } from './plan-geometry'
import type { SceneNodes } from './types'
import { registerSceneCheck } from './verify-scene'

/**
 * Whether people can get around a building: every apartment reached from the entrance through
 * shared circulation (corridors, landings, stairs, lifts), and no door, lift or stair opening onto
 * nothing. Victor run 11 put 30 of its 260 entry doors into a lift shaft or a stair well and turned
 * lifts to open into apartments. A guessed door's place is loose; this checks what it connects,
 * not where it stands, so any building passes that people can walk through.
 *
 * The graph: a floor's spaces are its zones (the smallest one holding a point) and its open floor;
 * a door joins the spaces on its two faces; two spaces touching along an edge with no wall join;
 * a lift joins the spaces in front of its door on each floor it serves; a stair joins the floors
 * at its foot and at its head; the ground floor's doors and open edges join the outside.
 */

type Pt = [number, number]
type Issue = { type: string; message: string }

/** How far past each face of a door's wall the other side is sampled. */
const DOOR_PROBE = 0.4
/** Samples along a zone's edges, and how far across each one looks. */
const EDGE_STEP = 0.75
const EDGE_PROBE = 0.3
/** How far in front of a lift's door, and past a stair's ends, the floor is looked for. */
const LIFT_PROBE = 0.5
const LANDING_PROBE = 0.6
/** Names listed in one issue before "and N more". */
const LISTED = 8

export type Space =
  | { kind: 'outside' }
  /** Off every slab above the ground floor: a door there is a window-like door, not a fault. */
  | { kind: 'open-air' }
  /** A stair well or another opening in the floor. */
  | { kind: 'void' }
  | { kind: 'shaft' }
  | { kind: 'zone'; key: string; area: number; apartment?: string }
  | { kind: 'floor'; key: string }

type Floor = {
  id: string
  name: string
  ground: boolean
  slabs: Pt[][]
  voids: Pt[][]
  shafts: Pt[][]
  zones: { id: string; polygon: Pt[]; area: number; apartment?: string }[]
  /** Floor closed in by walls with no zone drawn on it (a stair core): a space of its own. */
  pockets: { polygon: Pt[]; area: number }[]
  walls: [Pt, Pt][]
}

const area = (polygon: readonly Pt[]) =>
  Math.abs(
    polygon.reduce((sum, [x, z], i) => {
      const [nx, nz] = polygon[(i + 1) % polygon.length]!
      return sum + x * nz - nx * z
    }, 0),
  ) / 2

/** Level-local (x, z) of a node turned by `rotation` about Y, as the editor turns it. */
const rotate = ([x, z]: Pt, rotation: number): Pt => [
  x * Math.cos(rotation) + z * Math.sin(rotation),
  -x * Math.sin(rotation) + z * Math.cos(rotation),
]

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
/** Whether segment p–q crosses or touches a–b: touching a wall's end blocks the way too. */
const touches = (o: Pt, a: Pt, b: Pt) =>
  Math.abs(cross(a, b, o)) < 1e-9 &&
  o[0] >= Math.min(a[0], b[0]) - 1e-9 &&
  o[0] <= Math.max(a[0], b[0]) + 1e-9 &&
  o[1] >= Math.min(a[1], b[1]) - 1e-9 &&
  o[1] <= Math.max(a[1], b[1]) + 1e-9
const segmentsCross = (p: Pt, q: Pt, a: Pt, b: Pt) =>
  (cross(p, q, a) * cross(p, q, b) < 0 && cross(a, b, p) * cross(a, b, q) < 0) ||
  touches(a, p, q) ||
  touches(b, p, q) ||
  touches(p, a, b) ||
  touches(q, a, b)

const walkable = (space: Space) =>
  space.kind === 'zone' || space.kind === 'floor' || space.kind === 'outside'
const keyOf = (space: Space) =>
  space.kind === 'zone' || space.kind === 'floor' ? space.key : space.kind

function floorsOf(nodes: SceneNodes) {
  const all = Object.values(nodes) as AnyNode[]
  const levels = all
    .filter((node): node is Extract<AnyNode, { type: 'level' }> => node.type === 'level')
    .sort((a, b) => a.level - b.level)
  const apartments = all.filter(
    (node): node is Extract<AnyNode, { type: 'unit' }> =>
      node.type === 'unit' && (node.kind ?? 'apartment') === 'apartment',
  )
  const apartmentOfZone = new Map(
    apartments.flatMap((unit) =>
      unit.members.map((member) => [member as string, unit.id as string]),
    ),
  )
  const elevators = all.filter(
    (node): node is Extract<AnyNode, { type: 'elevator' }> => node.type === 'elevator',
  )
  const ground = levels.find((level) =>
    all.some((node) => node.type === 'slab' && node.parentId === level.id),
  )
  const indexOf = new Map(levels.map((level) => [level.id as string, level.level]))
  const serves = (lift: (typeof elevators)[number], levelId: string) => {
    const at = indexOf.get(levelId)
    const from = indexOf.get(lift.fromLevelId ?? '')
    const to = indexOf.get(lift.toLevelId ?? '')
    if (at === undefined || from === undefined || to === undefined) return false
    return (
      at >= Math.min(from, to) &&
      at <= Math.max(from, to) &&
      !(lift.disabledLevelIds ?? []).includes(levelId)
    )
  }
  const liftOrigin = (lift: (typeof elevators)[number]): Pt => {
    const parent = lift.parentId ? nodes[lift.parentId] : undefined
    const at = parent && 'position' in parent ? (parent.position as number[]) : [0, 0, 0]
    return [lift.position[0] + (at[0] ?? 0), lift.position[2] + (at[2] ?? 0)]
  }
  const shaftOf = (lift: (typeof elevators)[number]): Pt[] => {
    const [cx, cz] = liftOrigin(lift)
    // The shaft falls back to the cab's footprint, as the renderer does.
    const [w, d] = [(lift.shaftWidth ?? lift.width) / 2, (lift.shaftDepth ?? lift.depth) / 2]
    return (
      [
        [-w, -d],
        [w, -d],
        [w, d],
        [-w, d],
      ] as Pt[]
    ).map((corner) => {
      const [x, z] = rotate(corner, lift.rotation ?? 0)
      return [cx + x, cz + z]
    })
  }

  const floors = levels.map((level): Floor => {
    const on = all.filter((node) => node.parentId === level.id)
    const zones = on
      .filter((node): node is Extract<AnyNode, { type: 'zone' }> => node.type === 'zone')
      .filter((zone) => zone.polygon.length >= 3)
      .map((zone) => ({
        id: zone.id as string,
        polygon: zone.polygon as Pt[],
        area: area(zone.polygon as Pt[]),
        apartment: apartmentOfZone.get(zone.id),
      }))
    // A room drawn inside an apartment belongs to it.
    for (const zone of zones) {
      if (zone.apartment) continue
      const [x, z] = zone.polygon.reduce(
        ([sx, sz], [px, pz]) => [sx + px / zone.polygon.length, sz + pz / zone.polygon.length],
        [0, 0],
      )
      zone.apartment = zones.find(
        (other) =>
          other.apartment && other.area > zone.area && pointInPolygon([x, z], other.polygon, false),
      )?.apartment
    }
    return {
      id: level.id,
      name: level.name ?? `Level ${level.level}`,
      ground: level.id === ground?.id,
      slabs: on.flatMap((node) => (node.type === 'slab' ? [node.polygon as Pt[]] : [])),
      voids: on.flatMap((node) =>
        node.type === 'floor-opening' && (node.drawnOn ?? 'floor') === 'floor'
          ? [node.polygon as Pt[]]
          : [],
      ),
      shafts: elevators.filter((lift) => serves(lift, level.id)).map(shaftOf),
      zones,
      pockets: extractRooms(
        on.filter((node): node is Extract<AnyNode, { type: 'wall' }> => node.type === 'wall'),
      ).map((room) => ({
        polygon: room.referencePolygon as Pt[],
        area: area(room.referencePolygon as Pt[]),
      })),
      walls: on.flatMap((node) =>
        node.type === 'wall' && !node.curveOffset ? [[node.start as Pt, node.end as Pt]] : [],
      ),
    }
  })
  return { floors, apartments, elevators, serves, liftOrigin }
}

/** What stands at a point of a floor. */
function spaceAt(floor: Floor, point: Pt): Space {
  if (floor.shafts.some((shaft) => pointInPolygon(point, shaft, false))) return { kind: 'shaft' }
  if (floor.voids.some((hole) => pointInPolygon(point, hole, false))) return { kind: 'void' }
  if (!floor.slabs.some((slab) => pointInPolygon(point, slab))) {
    return floor.ground ? { kind: 'outside' } : { kind: 'open-air' }
  }
  let best: Floor['zones'][number] | undefined
  for (const zone of floor.zones)
    if ((!best || zone.area < best.area) && pointInPolygon(point, zone.polygon)) best = zone
  if (!best) {
    // Inside walls but on no zone: its own space, not the floor outside them.
    let pocket = -1
    floor.pockets.forEach((candidate, index) => {
      if (
        (pocket < 0 || candidate.area < floor.pockets[pocket]!.area) &&
        pointInPolygon(point, candidate.polygon)
      )
        pocket = index
    })
    if (pocket >= 0) return { kind: 'floor', key: `floor:${floor.id}:${pocket}` }
  }
  return best
    ? {
        kind: 'zone',
        key: `zone:${best.id}`,
        area: best.area,
        ...(best.apartment && { apartment: best.apartment }),
      }
    : { kind: 'floor', key: `floor:${floor.id}` }
}

const crossesWall = (floor: Floor, p: Pt, q: Pt) =>
  floor.walls.some(([a, b]) => segmentsCross(p, q, a, b))

/** What stands at a point of each floor, read once per scene. */
export function floorSpaceReader(nodes: SceneNodes) {
  const floors = new Map(floorsOf(nodes).floors.map((floor) => [floor.id, floor]))
  return (levelId: string, point: [number, number]): Space | null => {
    const floor = floors.get(levelId)
    return floor ? spaceAt(floor, point) : null
  }
}

/**
 * What lies on each face of a wall at `along` metres from its start, for a door there. Built once
 * per scene: the floors do not change when doors are added.
 */
export function wallSidesReader(nodes: SceneNodes) {
  const floors = new Map(floorsOf(nodes).floors.map((floor) => [floor.id, floor]))
  return (wall: Extract<AnyNode, { type: 'wall' }>, along: number): [Space, Space] | null => {
    const floor = floors.get(wall.parentId as string)
    return floor ? doorSides(floor, wall, along) : null
  }
}

function doorSides(
  floor: Floor,
  wall: Extract<AnyNode, { type: 'wall' }>,
  along: number,
): [Space, Space] {
  const [ax, az] = wall.start
  const [bx, bz] = wall.end
  const length = Math.hypot(bx - ax, bz - az) || 1
  const [ux, uz] = [(bx - ax) / length, (bz - az) / length]
  const centre: Pt = [ax + ux * along, az + uz * along]
  const reach = (wall.thickness ?? 0.1) / 2 + DOOR_PROBE
  return [
    spaceAt(floor, [centre[0] - uz * reach, centre[1] + ux * reach]),
    spaceAt(floor, [centre[0] + uz * reach, centre[1] - ux * reach]),
  ]
}

const listed = (names: string[]) =>
  names.length > LISTED
    ? `${names.slice(0, LISTED).join(', ')} and ${names.length - LISTED} more`
    : names.join(', ')

export function circulationIssues(nodes: SceneNodes): Issue[] {
  const { floors, apartments, elevators, serves, liftOrigin } = floorsOf(nodes)
  const floorById = new Map(floors.map((floor) => [floor.id, floor]))
  const links = new Map<string, Set<string>>()
  const apartmentOfKey = new Map<string, string>()
  const groundKeys = new Set<string>()
  const link = (a: string, b: string) => {
    if (a === b) return
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const set = links.get(from) ?? new Set<string>()
      set.add(to)
      links.set(from, set)
    }
  }
  const note = (floor: Floor, space: Space) => {
    if (space.kind === 'zone' && space.apartment) apartmentOfKey.set(space.key, space.apartment)
    if (floor.ground && (space.kind === 'zone' || space.kind === 'floor')) groundKeys.add(space.key)
  }
  const issues: Issue[] = []
  const name = (id: string) => {
    const node = nodes[id] as { name?: string } | undefined
    return node?.name ?? id
  }

  // Doors.
  const nowhere: string[] = []
  for (const door of Object.values(nodes) as AnyNode[]) {
    if (door.type !== 'door') continue
    const wall = nodes[(door.wallId ?? door.parentId) as string] as AnyNode | undefined
    if (wall?.type !== 'wall') continue
    const floor = floorById.get(wall.parentId as string)
    if (!floor) continue
    const sides = doorSides(floor, wall, door.position[0])
    const blocked = sides.find((side) => side.kind === 'shaft' || side.kind === 'void')
    if (blocked) {
      nowhere.push(
        `${name(door.id)} (${floor.name}) into ${blocked.kind === 'shaft' ? 'a lift shaft' : 'a stair well'}`,
      )
      continue
    }
    if (sides.every(walkable)) {
      for (const side of sides) note(floor, side)
      link(keyOf(sides[0]), keyOf(sides[1]))
    }
  }
  if (nowhere.length)
    issues.push({
      type: 'door_leads_nowhere',
      message: `${nowhere.length} door${nowhere.length === 1 ? ' opens' : 's open'} onto nothing: ${listed(nowhere)}. Move each to a wall whose other side is a corridor or a landing, or delete it.`,
    })

  // Open edges: two spaces touching with no wall between them are one.
  for (const floor of floors) {
    const outlines = [
      ...floor.zones.map((zone) => zone.polygon),
      ...(floor.ground ? floor.slabs : []),
    ]
    for (const polygon of outlines) {
      polygon.forEach((a, i) => {
        const b = polygon[(i + 1) % polygon.length]!
        const length = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (length < 0.5) return
        const [ux, uz] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
        const count = Math.max(1, Math.round(length / EDGE_STEP))
        for (let k = 0; k < count; k += 1) {
          const t = ((k + 0.5) / count) * length
          if (t < 0.2 || t > length - 0.2) continue
          const at: Pt = [a[0] + ux * t, a[1] + uz * t]
          const p: Pt = [at[0] - uz * EDGE_PROBE, at[1] + ux * EDGE_PROBE]
          const q: Pt = [at[0] + uz * EDGE_PROBE, at[1] - ux * EDGE_PROBE]
          const [sp, sq] = [spaceAt(floor, p), spaceAt(floor, q)]
          if (!(walkable(sp) && walkable(sq)) || keyOf(sp) === keyOf(sq)) continue
          if (crossesWall(floor, p, q)) continue
          note(floor, sp)
          note(floor, sq)
          link(keyOf(sp), keyOf(sq))
        }
      })
    }
  }

  // Lifts: the floor in front of the door, on every floor served.
  const blockedLifts: string[] = []
  for (const lift of elevators) {
    const [cx, cz] = liftOrigin(lift)
    const reach =
      (lift.shaftDepth ?? lift.depth) / 2 + (lift.shaftWallThickness ?? 0.09) + LIFT_PROBE
    const [dx, dz] = rotate([0, -reach], lift.rotation ?? 0)
    for (const floor of floors) {
      if (!serves(lift, floor.id)) continue
      const front = spaceAt(floor, [cx + dx, cz + dz])
      const liftName = name(lift.id) === lift.id ? 'Lift' : name(lift.id)
      if (!walkable(front)) blockedLifts.push(`${liftName} opens onto nothing on ${floor.name}`)
      else {
        if (front.kind === 'zone' && front.apartment)
          blockedLifts.push(`${liftName} opens into ${name(front.apartment)} on ${floor.name}`)
        note(floor, front)
        link(`lift:${lift.id}`, keyOf(front))
      }
    }
  }
  if (blockedLifts.length)
    issues.push({
      type: 'lift_door_blocked',
      message: `${listed(blockedLifts)}. Turn the lift (rotation) so its door faces the corridor or a landing on every floor it serves.`,
    })

  // Stairs: some floor to step onto at the foot and at the head, reached without crossing a wall.
  const noLanding: string[] = []
  for (const stair of Object.values(nodes) as AnyNode[]) {
    if (stair.type !== 'stair') continue
    const foot = floorById.get((stair.fromLevelId ?? stair.parentId) as string)
    const head = stair.toLevelId ? floorById.get(stair.toLevelId) : undefined
    const box = stairFootprintAABB(stair as never, nodes as never)
    if (!(foot && box)) continue
    const landings = (
      floor: Floor,
      rect: { minX: number; minZ: number; maxX: number; maxZ: number },
    ) => {
      let found = 0
      const sides: [Pt, Pt][] = []
      for (const f of [0.25, 0.5, 0.75]) {
        const x = rect.minX + (rect.maxX - rect.minX) * f
        const z = rect.minZ + (rect.maxZ - rect.minZ) * f
        sides.push([
          [x, rect.minZ],
          [x, rect.minZ - LANDING_PROBE],
        ])
        sides.push([
          [x, rect.maxZ],
          [x, rect.maxZ + LANDING_PROBE],
        ])
        sides.push([
          [rect.minX, z],
          [rect.minX - LANDING_PROBE, z],
        ])
        sides.push([
          [rect.maxX, z],
          [rect.maxX + LANDING_PROBE, z],
        ])
      }
      for (const [from, to] of sides) {
        const space = spaceAt(floor, to)
        if (!walkable(space) || space.kind === 'outside' || crossesWall(floor, from, to)) continue
        note(floor, space)
        link(`stair:${stair.id}`, keyOf(space))
        found += 1
      }
      return found
    }
    const stairName = name(stair.id) === stair.id ? 'A stair' : name(stair.id)
    if (!landings(foot, box)) noLanding.push(`${stairName} at its foot (${foot.name})`)
    if (head) {
      const wells = (Object.values(nodes) as AnyNode[]).flatMap((node) =>
        node.type === 'floor-opening' && node.ownerId === stair.id && node.parentId === head.id
          ? (node.polygon as Pt[])
          : [],
      )
      const top = wells.length
        ? {
            minX: Math.min(...wells.map(([x]) => x)),
            maxX: Math.max(...wells.map(([x]) => x)),
            minZ: Math.min(...wells.map(([, z]) => z)),
            maxZ: Math.max(...wells.map(([, z]) => z)),
          }
        : box
      if (!landings(head, top)) noLanding.push(`${stairName} at its head (${head.name})`)
    }
  }
  if (noLanding.length)
    issues.push({
      type: 'stair_has_no_landing',
      message: `No floor to step onto: ${listed(noLanding)}. A stair needs a landing joined to the corridor, not walls or a void.`,
    })

  if (!apartments.length) return issues

  // Apartments: reached from the entrance, and through shared circulation only.
  const entrance = links.has('outside')
  const ground = floors.find((floor) => floor.ground)
  if (!entrance && ground && Object.values(nodes).some((node) => (node as AnyNode).type === 'door'))
    issues.push({
      type: 'no_exterior_door',
      message: `No door leads outside on ${ground.name}: the building cannot be entered. Add the entrance in a corridor or lobby wall of the facade.`,
    })
  const starts = entrance ? ['outside'] : [...groundKeys].filter((key) => !apartmentOfKey.has(key))
  const walk = (through: (key: string) => boolean) => {
    const seen = new Set(starts)
    const queue = [...starts]
    while (queue.length) {
      const key = queue.shift()!
      if (!through(key)) continue
      for (const next of links.get(key) ?? [])
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
    }
    return seen
  }
  const everywhere = walk(() => true)
  const shared = walk((key) => !apartmentOfKey.has(key))
  const unreachable: string[] = []
  const through: string[] = []
  for (const unit of apartments) {
    const keys = floors.flatMap((floor) =>
      floor.zones.filter((zone) => zone.apartment === unit.id).map((zone) => `zone:${zone.id}`),
    )
    if (!keys.length) continue
    if (!keys.some((key) => everywhere.has(key))) unreachable.push(name(unit.id))
    else if (!keys.some((key) => shared.has(key))) through.push(name(unit.id))
  }
  if (unreachable.length)
    issues.push({
      type: 'apartment_unreachable',
      message: `${unreachable.length} apartment${unreachable.length === 1 ? '' : 's'} cannot be reached from ${entrance ? 'the entrance' : "the ground floor's corridors"}: ${listed(unreachable)}. Each needs an entry door onto a corridor or a landing.`,
    })
  if (through.length)
    issues.push({
      type: 'reached_through_apartment',
      message: `${through.length} apartment${through.length === 1 ? ' is' : 's are'} reached only by crossing another apartment: ${listed(through)}. Give each its own door onto a corridor or a landing.`,
    })
  return issues
}

// Every apartment reached from the entrance; no door, lift or stair onto nothing: a verify_scene
// check, run before the facade's.
registerSceneCheck({ name: 'circulation', order: 5, run: (nodes) => circulationIssues(nodes) })
