import { expect, test } from 'bun:test'
import { applySceneChanges } from '../agent-operations/apply-changes'
import { buildBuildingFoundationChanges } from '../building/foundation'
import { planWallOpening } from '../building/wall-openings'
import { setZoneIntent } from '../commands/structure/set-zone-intent'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  type DoorNode,
  LevelNode,
  SiteNode,
  type SlabNode,
  type WallNode,
  type ZoneNode,
} from '../schema'
import { getWallCurveLength } from '../systems/wall/wall-curve'
import { planWallInsertion } from '../systems/wall/wall-topology'
import { foundationOutlines } from './designed-foundation'
import { wallOpeningBand } from './floor-opening-footprints'
import { area, difference, intersection, type Ring, union } from './polygon-boolean'
import { reconcileSceneStructure } from './structure-reconcile'

type Nodes = Record<AnyNodeId, AnyNode>
type Point = [number, number]

const LEVEL = 'level_g' as AnyNodeId
let minted = 0
const mintId = (kind: string) => `${kind}_p${minted++}`

/**
 * One edit as the editor makes it: its changes written, then the level's rooms, ceilings and floor
 * plates reconciled against the scene before it (`applyStructureReconciliation`).
 */
function commit(nodes: Nodes, change: (nodes: Nodes) => Nodes): Nodes {
  const next = change(nodes)
  return reconcileSceneStructure({ nodes: next, previousNodes: nodes, mintId }).nodes as Nodes
}

/** A wall drawn with the wall tool: inserted (joining and splitting the walls it meets), reconciled. */
function draw(nodes: Nodes, start: Point, end: Point): Nodes {
  return commit(nodes, (scene) => {
    const result = planWallInsertion(scene, {
      levelId: LEVEL,
      start,
      end,
      joinRadius: 0.05,
      wallDefaults: { thickness: 0.18 },
    })
    if (!result.ok) throw Error(result.reason)
    return applySceneChanges(scene, result.plan.changes) as Nodes
  })
}

/** A door placed on the wall under `at` with the door tool's rule (`planWallOpening`). */
function placeDoor(nodes: Nodes, at: Point, width: number, height: number): Nodes {
  const wall = wallAt(nodes, at)
  const length = getWallCurveLength(wall)
  const t =
    ((at[0] - wall.start[0]) * (wall.end[0] - wall.start[0]) +
      (at[1] - wall.start[1]) * (wall.end[1] - wall.start[1])) /
    (length * length)
  return commit(nodes, (scene) => {
    const { node } = planWallOpening(scene, { kind: 'door', wallId: wall.id, t, width, height })
    return applySceneChanges(scene, { create: [{ node, parentId: wall.id }] }) as Nodes
  })
}

const walls = (nodes: Nodes) =>
  Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === LEVEL,
  )

/** The wall whose centreline passes through `at`. */
function wallAt(nodes: Nodes, at: Point): WallNode {
  return walls(nodes).find((wall) => {
    const [ax, az] = wall.start
    const [bx, bz] = wall.end
    const cross = (bx - ax) * (at[1] - az) - (bz - az) * (at[0] - ax)
    const dot = (at[0] - ax) * (bx - ax) + (at[1] - az) * (bz - az)
    return Math.abs(cross) < 1e-6 && dot > 0 && dot < (bx - ax) ** 2 + (bz - az) ** 2
  })!
}

const zoneAt = (nodes: Nodes, at: Point) =>
  Object.values(nodes).find(
    (node): node is ZoneNode =>
      node.type === 'zone' &&
      node.parentId === LEVEL &&
      area(intersection(node.polygon as Ring, square(at, 0.01))) > 0,
  )!

const square = ([x, z]: Point, half: number): Ring => [
  [x - half, z - half],
  [x + half, z - half],
  [x + half, z + half],
  [x - half, z + half],
]

/**
 * A raised house 12.5 × 9 m, drawn wall by wall, seated on its raised floor; then a garage 6 × 6 m
 * drawn off its east side, its north wall teeing into the house's east wall, named Garage, with an
 * overhead door and a man door to the outside and a door into the house through the wall they
 * share — each step as the editor takes it, the plates reconciled after every one.
 */
function drawnRaisedHouseWithGarage(): Nodes {
  let nodes = Object.fromEntries(
    [
      SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
      BuildingNode.parse({
        id: 'building_a',
        parentId: 'site_a',
        children: [LEVEL],
        metadata: { foundation: { enabled: true, type: 'slab' } },
      }),
      LevelNode.parse({ id: LEVEL, parentId: 'building_a', level: 0, children: [] }),
    ].map((node) => [node.id, node]),
  ) as Nodes
  const house: Point[] = [
    [0, 0],
    [12.5, 0],
    [12.5, 9],
    [0, 9],
  ]
  house.forEach((corner, index) => {
    nodes = draw(nodes, corner, house[(index + 1) % house.length]!)
  })
  nodes = commit(
    nodes,
    (scene) =>
      applySceneChanges(scene, {
        update: buildBuildingFoundationChanges({
          nodes: scene,
          buildingId: 'building_a',
          patch: { type: 'raised' },
        })!.update,
      }) as Nodes,
  )
  nodes = draw(nodes, [12.5, 0], [18.5, 0])
  nodes = draw(nodes, [18.5, 0], [18.5, 6])
  nodes = draw(nodes, [18.5, 6], [12.5, 6])
  const garage = zoneAt(nodes, [15.5, 3])
  nodes = commit(nodes, (scene) => {
    const plan = setZoneIntent(scene, {
      zoneId: garage.id,
      patch: { name: 'Garage', floor: { foundation: 'slab' } },
    })
    expect(plan.conflicts ?? []).toEqual([])
    return applySceneChanges(scene, {
      update: plan.changes.flatMap((change) =>
        change.op === 'update' ? [{ id: change.id, data: change.data }] : [],
      ),
    }) as Nodes
  })
  nodes = placeDoor(nodes, [18.5, 3], 4.8, 2.1)
  nodes = placeDoor(nodes, [15, 0], 0.9, 2.1)
  nodes = placeDoor(nodes, [12.5, 2], 0.9, 2.1)
  return nodes
}

test('a raised house’s floor plates stay inside its walls’ outer faces and never run through a door, beside a garage on its slab', () => {
  const nodes = drawnRaisedHouseWithGarage()
  const garage = zoneAt(nodes, [15.5, 3])
  const room = zoneAt(nodes, [6, 4.5])
  expect(garage.name).toBe('Garage')
  expect(garage.floor).toMatchObject({ foundation: 'slab' })
  expect(garage.floor?.elevation).toBeLessThan(-0.3)
  // The garage's north wall split the house's east wall where it met it.
  expect(wallAt(nodes, [12.5, 3]).end[1]).toBeCloseTo(6, 6)
  const plates = Object.values(nodes).filter(
    (node): node is SlabNode => node.type === 'slab' && node.parentId === LEVEL,
  )
  // The house's floor, and the garage's slab a plate of its own, set down to its floor.
  const housePlates = plates.filter((plate) => plate.zoneIds?.includes(room.id))
  expect(housePlates.length).toBeGreaterThan(0)
  const garagePlate = plates.find((plate) => !plate.zoneIds?.includes(room.id))!
  expect(garagePlate.zoneIds).toEqual([garage.id])
  expect(garagePlate.elevation).toBeCloseTo(garage.floor!.elevation!, 6)

  const all = walls(nodes)
  // The walls' outer faces: the outline the foundation is poured to.
  const outline = union(
    foundationOutlines(all).map((loop) => loop.edges.map((edge) => edge.a) as Ring),
  )
  const doors = Object.values(nodes).filter((node): node is DoorNode => node.type === 'door')
  expect(doors).toHaveLength(3)
  for (const plate of housePlates) {
    const shape = { outer: plate.polygon as Ring, holes: (plate.holes ?? []) as Ring[] }
    // Inside the walls' outer faces, nowhere past them.
    expect(area(difference(shape, outline))).toBeLessThan(1e-6)
    // Never into the garage, past the faces of the walls round it.
    expect(area(intersection(shape, garage.polygon as Ring))).toBeLessThan(1e-6)
    // Never into a doorway or through it: across each door's span, nothing of the house's floor
    // past its room.
    for (const door of doors) {
      const wall = nodes[door.parentId as AnyNodeId] as WallNode
      const length = getWallCurveLength(wall)
      const band = wallOpeningBand(
        wall,
        (door.position[0] - door.width / 2) / length,
        (door.position[0] + door.width / 2) / length,
      )
      const through = difference(intersection(shape, band), room.polygon as Ring)
      expect(area(through)).toBeLessThan(1e-6)
    }
  }
  // The garage's doors open from its slab; the door into the house from the house's floor.
  const sill = (at: Point) => {
    const door = doors.find((candidate) => candidate.parentId === wallAt(nodes, at).id)!
    return door.position[1] - door.height / 2
  }
  expect(sill([18.5, 3])).toBeCloseTo(garage.floor!.elevation!, 6)
  expect(sill([15, 0])).toBeCloseTo(garage.floor!.elevation!, 6)
  expect(sill([12.5, 2])).toBeCloseTo(0, 9)
})
