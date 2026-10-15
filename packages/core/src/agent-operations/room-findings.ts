import { area, intersection, type Polygon, type Ring, union } from '../lib/polygon-boolean'
import { polygonInteriorPoint } from '../lib/polygon-label'
import { distanceToSegment } from '../lib/room-topology-index'
import { detectSpacesForLevel } from '../lib/space-detection'
import type { AnyNode } from '../schema'
import { nodesOnLevel } from './scene-queries'
import type { SceneNodes } from './types'

/** A space the walls and separators enclose, where a finding about it places it. */
type SpacePlace = {
  levelId: string
  /** The space's floor area, m². */
  area: number
  /** A point inside the space, in plan [x, z]. */
  at: [number, number]
  wallIds: string[]
}

/**
 * A level's rooms against the spaces its walls and separators enclose (the editor's detected
 * spaces): a space no zone covers, a space several zones split, a room the walls do not close, a
 * room with no name.
 */
export type RoomFinding =
  | ({ type: 'space_no_room'; message: string } & SpacePlace)
  | ({ type: 'space_many_rooms'; message: string; zoneIds: string[] } & SpacePlace)
  | {
      type: 'room_not_enclosed'
      message: string
      /** On a zone left generic: a room still missing a wall, or a courtyard. */
      severity?: 'info'
      levelId: string
      zoneId: string
    }
  | { type: 'room_unnamed'; message: string; severity: 'info'; levelId: string; zoneId: string }

type Zone = AnyNode & { type: 'zone' }
type Wall = AnyNode & { type: 'wall' }
type Shape = { polygon: Polygon; box: [number, number, number, number]; area: number }

/** No name, or the bare word an older scene or a blank name leaves: "Room", "Zone". */
const PLACEHOLDER_NAME = /^\s*(room|zone)?\s*$/i

/** A space is covered, a room enclosed, a zone in a space, and a zone walled like a room, past half. */
const HALF = 0.5
/** How far past a wall's face its outline may run and still be walled, m. */
const ALONG_WALL = 0.1
/** The step a zone's outline is sampled at to see how much of it walls run along, m. */
const OUTLINE_STEP = 0.25
/** A wall that bounds a room stands at least this high, m; a garden wall is lower. */
const ROOM_WALL_HEIGHT = 2

const round = (value: number) => Math.round(value * 100) / 100

function shapeOf(outer: Ring, holes: Ring[] = []): Shape {
  const polygon = { outer, holes }
  const xs = outer.map(([x]) => x)
  const zs = outer.map(([, z]) => z)
  return {
    polygon,
    box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
    area: area([polygon]),
  }
}

const overlap = (a: Shape, b: Shape) =>
  a.box[0] < b.box[2] && b.box[0] < a.box[2] && a.box[1] < b.box[3] && b.box[1] < a.box[3]

/** How much of `part` the shapes cover, 0 to 1; only the shapes whose boxes meet it are joined. */
function covered(part: Shape, cover: readonly Shape[]): number {
  if (part.area <= 0) return 0
  const near = cover.filter((shape) => overlap(part, shape))
  if (near.length === 0) return 0
  const joined = near.length === 1 ? near[0]!.polygon : union(near.map((shape) => shape.polygon))
  return area(intersection(part.polygon, joined)) / part.area
}

/** How much of a zone's outline runs along a wall, 0 to 1: a zone mostly walled is meant as a room. */
function walled(zone: Zone, walls: readonly Wall[]): number {
  const ring = zone.polygon
  let along = 0
  let samples = 0
  ring.forEach((start, i) => {
    const end = ring[(i + 1) % ring.length]!
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / OUTLINE_STEP),
    )
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps
      const point: [number, number] = [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]
      samples++
      if (
        walls.some(
          (wall) =>
            distanceToSegment(point, wall.start, wall.end) <=
            (wall.thickness ?? 0.2) / 2 + ALONG_WALL,
        )
      )
        along++
    }
  })
  return samples > 0 ? along / samples : 0
}

const label = (zone: Zone) =>
  PLACEHOLDER_NAME.test(zone.name) ? zone.id : `"${zone.name}" (${zone.id})`

/**
 * A room is a zone with `spaceRole: 'room'`, or a generic one walls of a room's height bound along
 * most of its outline, which may be a room drawn before its last wall (no reconcile could adopt
 * it) or a courtyard, so what is found on it is info; a zone garden walls bound, or no walls (an
 * analysis area), is no room. Every space the walls enclose wants one zone over it (any zone: a drawn one is
 * adopted as the room on load): none, or several rooms lying in it (the reconciler's "Room N"
 * beside a zone drawn over it, a plan's rooms split by lines no wall draws), is a finding. Every
 * room wants walls or separators closing around it, and a name. A terrace closes with separators,
 * so it is enclosed; a room a person declared open (`enclosureStatus: 'open'` on a room the walls
 * never derived) needs no walls; an automatic room the reconciler opened when its walls stopped
 * closing it does.
 */
export function roomFindings(
  nodes: SceneNodes,
  levelId: string,
  levelName: string,
): { spaces: number; issues: RoomFinding[] } {
  const onLevel = nodesOnLevel(nodes, levelId)
  const walls = onLevel.filter((node): node is Wall => node.type === 'wall')
  const boundaries = onLevel.filter(
    (node): node is AnyNode & { type: 'wall' | 'separator' } =>
      node.type === 'wall' || node.type === 'separator',
  )
  const zones = onLevel.filter(
    (node): node is Zone => node.type === 'zone' && node.polygon.length >= 3,
  )
  const { spaces } = detectSpacesForLevel(levelId, boundaries)
  const spaceShapes = spaces.map((space) => shapeOf(space.polygon, space.holes))
  const zoneShapes = zones.map((zone) => shapeOf(zone.polygon, zone.holes))
  // A wall with no height of its own stands as high as its storey.
  const roomWalls = walls.filter((wall) => (wall.height ?? ROOM_WALL_HEIGHT) >= ROOM_WALL_HEIGHT)
  const rooms = zones.map((zone) => zone.spaceRole === 'room' || walled(zone, roomWalls) >= HALF)
  const issues: RoomFinding[] = []

  spaces.forEach((space, index) => {
    const shape = spaceShapes[index]!
    // A mezzanine stands over its room, and a zone no room (an analysis area) lies in it: neither
    // splits the space.
    const inside = zones.filter(
      (zone, z) =>
        rooms[z] && zone.floor?.support !== 'open' && covered(zoneShapes[z]!, [shape]) >= HALF,
    )
    const noRoom = covered(shape, zoneShapes) < HALF
    if (!noRoom && inside.length < 2) return
    const spaceArea = round(shape.area)
    const [x, z] = polygonInteriorPoint(space, true).map(round) as [number, number]
    const place = {
      levelId,
      area: spaceArea,
      at: [x, z] as [number, number],
      wallIds: space.wallIds,
    }
    const where = `On ${levelName}, walls ${space.wallIds.join(', ')} enclose a ${spaceArea.toFixed(1)} m² space at (${x.toFixed(2)}, ${z.toFixed(2)})`
    issues.push(
      noRoom
        ? { type: 'space_no_room', message: `${where} with no room over it.`, ...place }
        : {
            type: 'space_many_rooms',
            message: `${where} with ${inside.length} rooms over it and no wall between them: ${inside.map(label).join(', ')}. Keep one room per space: name the space's room (create_room over the whole space names it) and delete the others, or divide the space with a wall or separator.`,
            ...place,
            zoneIds: inside.map((zone) => zone.id),
          },
    )
  })

  zones.forEach((zone, index) => {
    if (!rooms[index]) return
    const room = zone.spaceRole === 'room'
    const unnamed = PLACEHOLDER_NAME.test(zone.name)
    const declaredOpen = zone.enclosureStatus === 'open' && !zone.autoFromWalls
    const opened = zone.enclosureStatus === 'open' && zone.autoFromWalls
    if (!declaredOpen && (opened || covered(zoneShapes[index]!, spaceShapes) < HALF))
      issues.push(
        room
          ? {
              type: 'room_not_enclosed',
              message: `Room ${label(zone)} on ${levelName}: its walls do not close around it.`,
              levelId,
              zoneId: zone.id,
            }
          : {
              type: 'room_not_enclosed',
              message: `Zone ${label(zone)} on ${levelName}: walls run along most of it and do not close around it, a room missing a wall or a courtyard.`,
              severity: 'info',
              levelId,
              zoneId: zone.id,
            },
      )
    if (unnamed)
      issues.push({
        type: 'room_unnamed',
        message: `Room ${zone.id} on ${levelName} has no name${zone.name.trim() ? ` but "${zone.name.trim()}"` : ''}.`,
        severity: 'info',
        levelId,
        zoneId: zone.id,
      })
  })

  return { spaces: spaces.length, issues }
}
