import { expect, test } from 'bun:test'
import { buildBuildingFoundationChanges } from '../building/foundation'
import { clampDoorToWall, planWallOpening } from '../building/wall-openings'
import { setZoneIntent } from '../commands/structure/set-zone-intent'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  DoorNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { levelPlaneWorldY } from '../services/storey'
import { SLAB_ROOM_CURB } from './designed-foundation'
import {
  designedFoundationReport,
  foundationGradingPads,
  foundationRimSteps,
  genericFoundation,
} from './generic-foundation'
import { SLAB_ROOM_FLOOR_FINISH } from './plate-surface'
import { doorSillFloorOf, isGarageName, roomFoundationOf, slabRoomElevation } from './slab-room'

const IN = 0.0254
type Nodes = Record<AnyNodeId, AnyNode>

/**
 * A raised house 10 × 8 m, a garage 6 × 6 m off its east side sharing the wall x 10: an overhead
 * door in the garage's east wall, a man door in its south wall, a door into the house in the
 * shared wall.
 */
function raisedHouseWithGarage(): Nodes {
  const wall = (id: string, start: [number, number], end: [number, number]) =>
    WallNode.parse({ id, parentId: 'level_g', start, end, thickness: 0.15 })
  const walls = [
    wall('wall_s', [0, 0], [10, 0]),
    wall('wall_gs', [10, 0], [16, 0]),
    wall('wall_ge', [16, 0], [16, 6]),
    wall('wall_gn', [16, 6], [10, 6]),
    wall('wall_e', [10, 6], [10, 8]),
    wall('wall_n', [10, 8], [0, 8]),
    wall('wall_w', [0, 8], [0, 0]),
    wall('wall_shared', [10, 0], [10, 6]),
  ]
  const door = (id: string, parentId: string, along: number, width: number) =>
    DoorNode.parse({ id, parentId, wallId: parentId, position: [along, 1.05, 0], width })
  const doors = [
    door('door_overhead', 'wall_ge', 3, 4.8),
    door('door_man', 'wall_gs', 2, 0.9),
    door('door_house', 'wall_shared', 3, 0.9),
  ]
  const nodes: AnyNode[] = [
    SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
    BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_a',
      children: ['level_g'],
      metadata: { foundation: { enabled: true, type: 'raised' } },
    }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      children: [...walls.map((w) => w.id), 'slab_g', 'zone_house', 'zone_garage'],
    }),
    SlabNode.parse({
      id: 'slab_g',
      parentId: 'level_g',
      plateRole: 'base',
      polygon: [
        [0, 0],
        [16, 0],
        [16, 6],
        [10, 6],
        [10, 8],
        [0, 8],
      ],
      elevation: 0.05,
      thickness: 0.05,
    }),
    ZoneNode.parse({
      id: 'zone_house',
      parentId: 'level_g',
      autoFromWalls: true,
      boundaryWallIds: ['wall_s', 'wall_shared', 'wall_e', 'wall_n', 'wall_w'],
      name: 'Living',
      spaceRole: 'room',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
    }),
    ZoneNode.parse({
      id: 'zone_garage',
      parentId: 'level_g',
      autoFromWalls: true,
      boundaryWallIds: ['wall_gs', 'wall_ge', 'wall_gn', 'wall_shared'],
      name: 'Room',
      spaceRole: 'room',
      polygon: [
        [10, 0],
        [16, 0],
        [16, 6],
        [10, 6],
      ],
    }),
    ...walls.map((w) => ({
      ...w,
      children: doors.filter((d) => d.parentId === w.id).map((d) => d.id),
    })),
    ...doors,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Nodes
}

function apply(nodes: Nodes, update: Array<{ id: string; data: unknown }>): Nodes {
  const next = { ...nodes }
  for (const { id, data } of update)
    next[id as AnyNodeId] = { ...next[id as AnyNodeId], ...(data as object) } as AnyNode
  return next
}

/** The house seated on its raised floor, then `name` given to the east room through its panel. */
function seatedAndNamed(name: string): Nodes {
  let nodes = raisedHouseWithGarage()
  nodes = apply(
    nodes,
    buildBuildingFoundationChanges({ nodes, buildingId: 'building_a', patch: {} })!.update,
  )
  const plan = setZoneIntent(nodes, { zoneId: 'zone_garage', patch: { name } })
  expect(plan.conflicts ?? []).toEqual([])
  return apply(nodes, plan.changes as Array<{ id: string; data: unknown }>)
}

const zone = (nodes: Nodes, id = 'zone_garage') => nodes[id as AnyNodeId] as ZoneNode

test('a garage is "garage" as a word, whatever its case', () => {
  expect(['Garage', '2-car garage', 'GARAGE 2', 'Garage/Shop'].map(isGarageName)).toEqual([
    true,
    true,
    true,
    true,
  ])
  expect(['Garages', 'Garageband', 'Living', ''].map(isGarageName)).toEqual([
    false,
    false,
    false,
    false,
  ])
})

test('named a garage, a room of a raised house comes down onto a slab 4 in over grade; a new name leaves it there', () => {
  const nodes = seatedAndNamed('2-car garage')
  expect(zone(nodes).floor?.foundation).toBe('slab')
  expect(roomFoundationOf(nodes, zone(nodes))).toBe('slab')
  expect(roomFoundationOf(nodes, zone(nodes, 'zone_house'))).toBe('raised')
  const report = designedFoundationReport(nodes, 'building_a')!
  const plane = levelPlaneWorldY(nodes, 'level_g')!
  const top = plane + zone(nodes).floor!.elevation!
  expect(top - report.highestGradeY).toBeCloseTo(4 * IN, 3)
  expect(slabRoomElevation(nodes, zone(nodes))).toBeCloseTo(zone(nodes).floor!.elevation!, 4)
  // Renamed away from Garage it stays on its slab: the choice is kept.
  const renamed = apply(
    nodes,
    setZoneIntent(nodes, { zoneId: 'zone_garage', patch: { name: 'Workshop' } }).changes as never,
  )
  expect(zone(renamed).floor?.foundation).toBe('slab')
})

test('a room chosen raised stays raised when named a garage; chosen slab, it comes down, and back up raised', () => {
  let nodes = seatedAndNamed('Room 2')
  expect(zone(nodes).floor?.foundation).toBeUndefined()
  const choose = (foundation: 'raised' | 'slab') => {
    const plan = setZoneIntent(nodes, { zoneId: 'zone_garage', patch: { floor: { foundation } } })
    expect(plan.conflicts ?? []).toEqual([])
    nodes = apply(nodes, plan.changes as never)
  }
  choose('raised')
  nodes = apply(
    nodes,
    setZoneIntent(nodes, { zoneId: 'zone_garage', patch: { name: 'Garage' } }).changes as never,
  )
  expect(zone(nodes).floor).toMatchObject({ foundation: 'raised' })
  expect(zone(nodes).floor?.elevation).toBeUndefined()
  choose('slab')
  expect(zone(nodes).floor?.elevation).toBeLessThan(-0.3)
  choose('raised')
  expect(zone(nodes).floor?.foundation).toBe('raised')
  expect(zone(nodes).floor?.elevation).toBeUndefined()
})

test('a garage off a raised house: its slab on grade, its walls on an 8 in curb cut at its doors, the shared wall on the house’s stem', () => {
  const nodes = seatedAndNamed('Garage')
  const report = designedFoundationReport(nodes, 'building_a')!
  const plane = levelPlaneWorldY(nodes, 'level_g')!
  const slabTop = plane + zone(nodes).floor!.elevation!
  const curbTop = slabTop + SLAB_ROOM_CURB
  const members = genericFoundation(nodes)
  const stems = members.filter((member) => member.kind === 'stem')
  // The house's stems stand at its stem top; the garage's curbs 8 in over its slab.
  const curbs = stems.filter((member) => Math.abs(member.topY - curbTop) < 1e-6)
  const raised = stems.filter((member) => Math.abs(member.topY - report.stemTopY!) < 1e-6)
  expect(curbs.length).toBeGreaterThan(0)
  expect(curbs.length + raised.length).toBe(stems.length)
  expect(curbTop - slabTop).toBeCloseTo(8 * IN, 9)
  // The overhead door's 4.8 m and the man door's 0.9 m are cut out of the curbs: along x 16 the
  // curb stands only at its ends, and the slab runs out through both openings.
  const along = (x: number) =>
    curbs.filter((curb) => Math.abs(curb.from[0] - x) < 0.2 && Math.abs(curb.to[0] - x) < 0.2)
  const east = along(16 - 0.0762)
  const covered = east.reduce((sum, curb) => sum + Math.abs(curb.to[1] - curb.from[1]), 0)
  expect(covered).toBeCloseTo(6 + 0.15 - 4.8, 1)
  const gaps = members.filter(
    (member) => member.kind === 'slab' && Math.abs(member.topY - (slabTop - 0.002)) < 1e-6,
  )
  // The slab between the curbs, and one gap for each of the two garage doors.
  expect(gaps).toHaveLength(3)
  // The shared wall stands on the house's stem, whole: its door into the house cuts nothing.
  const shared = raised.filter(
    (member) => Math.abs(member.from[0] - 10) < 1e-6 && Math.abs(member.to[0] - 10) < 1e-6,
  )
  expect(shared).toHaveLength(1)
  expect(Math.abs(shared[0]!.to[1] - shared[0]!.from[1])).toBeCloseTo(6 + 0.1524, 3)
  // The garage walls' finish runs down to the curb's top.
  for (const id of ['wall_gs', 'wall_ge', 'wall_gn'])
    expect(foundationRimSteps(nodes).get(id)?.[0]?.bottom).toBeCloseTo(curbTop - plane, 6)
  // Graded: the ground held 4 in under the garage's slab; the house cut round, its crawl dug out
  // under the house alone.
  const pads = foundationGradingPads(nodes)
  const pad = pads.find((entry) => entry.kind === undefined)!
  expect(pad.y).toBeCloseTo(slabTop - 4 * IN, 6)
  const pit = pads.find((entry) => entry.kind === 'pit')!
  expect(Math.max(...pit.outline.map(([x]) => x))).toBeLessThan(10)
  expect(pads.filter((entry) => entry.kind === 'cut')).toHaveLength(1)
})

test('seating the raised house again keeps the garage on grade; a slab house takes it back onto its floor', () => {
  let nodes = seatedAndNamed('Garage')
  const before = zone(nodes).floor!.elevation!
  nodes = apply(
    nodes,
    buildBuildingFoundationChanges({
      nodes,
      buildingId: 'building_a',
      patch: { ffAboveGradeIn: 30 },
    })!.update,
  )
  expect(zone(nodes).floor!.elevation!).toBeCloseTo(before - (30 - 22.125) * IN, 4)
  nodes = apply(
    nodes,
    buildBuildingFoundationChanges({ nodes, buildingId: 'building_a', patch: { type: 'slab' } })!
      .update,
  )
  expect(zone(nodes).floor?.foundation).toBe('slab')
  expect(zone(nodes).floor?.elevation).toBeUndefined()
})

test('a slab room’s doors open from its slab; the door into the house keeps its sill at the floor', () => {
  const nodes = seatedAndNamed('Garage')
  const elevation = zone(nodes).floor!.elevation!
  const sill = (id: string) => {
    const door = nodes[id as AnyNodeId] as DoorNode
    return door.position[1] - door.height / 2
  }
  expect(sill('door_overhead')).toBeCloseTo(elevation, 4)
  expect(sill('door_man')).toBeCloseTo(elevation, 4)
  expect(sill('door_house')).toBeCloseTo(0, 6)
  // Back on the raised floor they come back up with it.
  const back = apply(
    nodes,
    setZoneIntent(nodes, { zoneId: 'zone_garage', patch: { floor: { foundation: 'raised' } } })
      .changes as never,
  )
  const door = back['door_overhead' as AnyNodeId] as DoorNode
  expect(door.position[1] - door.height / 2).toBeCloseTo(0, 6)
})

test('a door placed or moved onto a garage’s wall to the outside stands on its slab; on the shared wall or a house wall, on the house floor', () => {
  const nodes = seatedAndNamed('Garage')
  const elevation = zone(nodes).floor!.elevation!
  const wall = (id: string) => nodes[id as AnyNodeId] as WallNode
  // The rule the door tools place and move a door by (`clampDoorToWall`, given the scene).
  const sill = (id: string, height = 2.1) =>
    clampDoorToWall(wall(id), 1.5, 0.9, height, nodes).clampedY - height / 2
  for (const id of ['wall_gs', 'wall_ge', 'wall_gn']) {
    expect(doorSillFloorOf(nodes, wall(id))).toBeCloseTo(elevation, 6)
    expect(sill(id)).toBeCloseTo(elevation, 6)
  }
  expect(sill('wall_ge', 2.4)).toBeCloseTo(elevation, 6)
  // Moved back onto a house wall, or into the wall the garage shares with the house: the floor.
  for (const id of ['wall_s', 'wall_e', 'wall_n', 'wall_w', 'wall_shared'])
    expect(sill(id)).toBeCloseTo(0, 9)
  // An agent's add_door seats it the same way, unclamped.
  const added = planWallOpening(nodes, { kind: 'door', wallId: 'wall_gn', t: 0.5 })
  const door = added.node as DoorNode
  expect(door.position[1] - door.height / 2).toBeCloseTo(elevation, 6)
  expect(added.clamped).toBe(false)
  const shared = planWallOpening(nodes, { kind: 'door', wallId: 'wall_shared', t: 0.2 })
  expect((shared.node as DoorNode).position[1]).toBeCloseTo(2.1 / 2, 9)
  // A garage chosen back onto the raised floor: its doors open from the floor again.
  const back = apply(
    nodes,
    setZoneIntent(nodes, { zoneId: 'zone_garage', patch: { floor: { foundation: 'raised' } } })
      .changes as never,
  )
  expect(doorSillFloorOf(back, back['wall_ge' as AnyNodeId] as WallNode)).toBe(0)
  // A slab house's garage is on the house's floor: nothing to step down to.
  const slab = apply(
    nodes,
    buildBuildingFoundationChanges({ nodes, buildingId: 'building_a', patch: { type: 'slab' } })!
      .update,
  )
  expect(zone(slab).floor?.foundation).toBe('slab')
  expect(doorSillFloorOf(slab, slab['wall_ge' as AnyNodeId] as WallNode)).toBe(0)
})

test('a slab room is bare concrete until a finish is chosen for it', () => {
  const nodes = seatedAndNamed('Garage')
  expect(zone(nodes).floor?.finish).toBeUndefined()
  expect(SLAB_ROOM_FLOOR_FINISH).toBe('library:concrete-raw')
})
