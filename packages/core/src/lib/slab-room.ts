import type { AnyNode, AnyNodeId, BuildingNode, LevelNode, WallNode, ZoneNode } from '../schema'
import { getLevelElevations, levelPlaneWorldY } from '../services/storey'
import {
  type BuildingFoundationType,
  buildingFoundationOf,
  inches,
  isBuildingFoundationOn,
} from './building-foundation'
import { exteriorWallLoops } from './exterior-wall-loops'
import { siteOf } from './generic-foundation'
import { groundHeightAt } from './site-ground-height'
import { levelLocalToWorldXZ } from './terrain-support-query'

type Nodes = Record<AnyNodeId, AnyNode>

/** Grade is read along a room's outline this often, metres. */
const GRADE_STEP = 0.15

/** A room named a garage: "garage" as a word, whatever its case ("Garage", "2-car garage"). */
export function isGarageName(name: string | null | undefined): boolean {
  return typeof name === 'string' && /\bgarage\b/i.test(name)
}

/** The building a room stands in, when it is one with its foundation record on. */
function buildingOfRoom(nodes: Nodes, zone: Pick<ZoneNode, 'parentId'>): BuildingNode | null {
  const buildingId = zone.parentId
    ? getLevelElevations(nodes).get(zone.parentId as AnyNodeId)?.buildingId
    : undefined
  const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
  return building?.type === 'building' && isBuildingFoundationOn(building) ? building : null
}

/**
 * What a room's floor stands on: its own choice (`floor.foundation`, made in its panel or by its
 * name), else its building's foundation type. `null` for a room in no building with its foundation
 * record on.
 */
export function roomFoundationOf(
  nodes: Nodes,
  zone: Pick<ZoneNode, 'parentId' | 'floor'>,
): BuildingFoundationType | null {
  const building = buildingOfRoom(nodes, zone)
  if (!building) return null
  return zone.floor?.foundation ?? buildingFoundationOf(nodes, building.id)?.type ?? null
}

/**
 * The floor elevation (level-local) a room on a slab of its own takes in a raised house (a garage):
 * its top `slabRoomTopAboveGradeIn` over the highest grade along the room, the slab on grade while
 * the house's floor stands over its crawl space. `null` where the room's building is no raised
 * house on its designed foundation, or the room has no outline.
 */
export function slabRoomElevation(
  nodes: Nodes,
  zone: Pick<ZoneNode, 'parentId' | 'polygon'>,
): number | null {
  const building = buildingOfRoom(nodes, zone)
  const foundation = building ? buildingFoundationOf(nodes, building.id) : null
  const plane = zone.parentId ? levelPlaneWorldY(nodes, zone.parentId) : null
  if (!(building && foundation?.type === 'raised' && plane !== null) || zone.polygon.length < 3)
    return null
  const site = siteOf(nodes, building)
  let highest = Number.NEGATIVE_INFINITY
  zone.polygon.forEach(([ax, az], index) => {
    const [bx, bz] = zone.polygon[(index + 1) % zone.polygon.length]!
    const count = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / GRADE_STEP) + 1)
    for (let k = 0; k < count; k++) {
      const t = k / (count - 1)
      const [x, z] = levelLocalToWorldXZ(building, ax + (bx - ax) * t, az + (bz - az) * t)
      highest = Math.max(highest, groundHeightAt(site, x, z))
    }
  })
  const top = highest + inches(foundation.slabRoomTopAboveGradeIn)
  return Math.round((top - plane) * 1e4) / 1e4
}

/** The visible walls standing on a level. */
function levelWallsOf(nodes: Nodes, level: LevelNode): WallNode[] {
  return level.children
    .map((id) => nodes[id as AnyNodeId])
    .filter((node): node is WallNode => node?.type === 'wall' && node.visible !== false)
}

// The last outside walls found per level, kept while its walls stand as they were: a door tool
// asks for every pointer move over a wall.
const outsideMemo = new Map<string, { walls: readonly WallNode[]; ids: ReadonlySet<string> }>()

/** The ids of a level's walls on its outline (`exteriorWallLoops`): the outside on one face. */
function outsideWallIdsOf(levelId: string, walls: readonly WallNode[]): ReadonlySet<string> {
  const hit = outsideMemo.get(levelId)
  if (hit && hit.walls.length === walls.length && hit.walls.every((wall, k) => wall === walls[k]))
    return hit.ids
  const ids = new Set(
    exteriorWallLoops([...walls]).flatMap((loop) => loop.map((face) => face.wallId as string)),
  )
  outsideMemo.set(levelId, { walls, ids })
  return ids
}

/**
 * A room's walls to the outside, by id: its bounding walls (`boundaryWallIds`, else the walls
 * along its outline) on the level's outline. A wall it shares with the house is not one.
 */
function outsideWallsOfRoom(
  zone: Pick<ZoneNode, 'polygon' | 'boundaryWallIds'>,
  walls: readonly WallNode[],
  outside: ReadonlySet<string>,
): Set<string> {
  return new Set(
    walls
      .filter((wall) =>
        zone.boundaryWallIds?.length
          ? zone.boundaryWallIds.includes(wall.id)
          : wallOnPolygon(wall, zone.polygon),
      )
      .filter((wall) => outside.has(wall.id))
      .map((wall) => wall.id as string),
  )
}

/**
 * The doors a room on a slab of its own opens to the outside through (in its walls on the house's
 * outline: a garage's overhead door, a man door), their sills moved with its floor from `from` to
 * `to` (level-local floor heights, 0 for the house's floor), so each one opens from the slab. A
 * door in a wall it shares with the house keeps its sill at the house floor, a step down from it.
 */
export function slabRoomDoorChanges(
  nodes: Nodes,
  zone: Pick<ZoneNode, 'parentId' | 'polygon' | 'boundaryWallIds'>,
  from: number,
  to: number,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const shift = to - from
  const level = zone.parentId ? nodes[zone.parentId as AnyNodeId] : undefined
  if (Math.abs(shift) < 1e-6 || level?.type !== 'level') return []
  const walls = levelWallsOf(nodes, level)
  const bounding = outsideWallsOfRoom(zone, walls, outsideWallIdsOf(level.id, walls))
  return Object.values(nodes).flatMap((node) =>
    node.type === 'door' && node.parentId && bounding.has(node.parentId)
      ? [
          {
            id: node.id as AnyNodeId,
            data: {
              position: [
                node.position[0],
                Math.round((node.position[1] + shift) * 1e4) / 1e4,
                node.position[2],
              ],
            } as Partial<AnyNode>,
          },
        ]
      : [],
  )
}

/**
 * The floor (level-local height) a door set in `wall` opens from: where the wall is one of a slab
 * room's walls to the outside (a garage's, its overhead door or a man door), that room's floor on
 * its slab, as `slabRoomDoorChanges` moves the doors it already has; else the house's floor, 0. A
 * door in the wall a slab room shares with the house opens from the house's floor, a step up from
 * the room. The door tools seat a door on it as they place or move one (`clampDoorToWall`).
 */
export function doorSillFloorOf(nodes: Nodes, wall: Pick<WallNode, 'id' | 'parentId'>): number {
  const level = wall.parentId ? nodes[wall.parentId as AnyNodeId] : undefined
  if (level?.type !== 'level') return 0
  const rooms = level.children
    .map((id) => nodes[id as AnyNodeId])
    .filter(
      (node): node is ZoneNode =>
        node?.type === 'zone' &&
        node.floor?.foundation === 'slab' &&
        Math.abs(node.floor.elevation ?? 0) > 1e-6,
    )
  if (rooms.length === 0) return 0
  const walls = levelWallsOf(nodes, level)
  const outside = outsideWallIdsOf(level.id, walls)
  if (!outside.has(wall.id)) return 0
  const room = rooms.find((zone) => outsideWallsOfRoom(zone, walls, outside).has(wall.id))
  return room?.floor?.elevation ?? 0
}

/** Whether a wall's centreline runs along a side of `polygon`, within its half thickness. */
function wallOnPolygon(wall: WallNode, polygon: ReadonlyArray<readonly [number, number]>) {
  const [mx, mz] = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
  return polygon.some(([ax, az], index) => {
    const [bx, bz] = polygon[(index + 1) % polygon.length]!
    const length2 = (bx - ax) ** 2 + (bz - az) ** 2
    if (length2 < 1e-12) return false
    const t = Math.max(0, Math.min(1, ((mx - ax) * (bx - ax) + (mz - az) * (bz - az)) / length2))
    const gap = Math.hypot(mx - (ax + (bx - ax) * t), mz - (az + (bz - az) * t))
    return gap <= (wall.thickness ?? 0.15) / 2 + 0.05
  })
}
